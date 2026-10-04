import { isDeepStrictEqual } from 'node:util';
import { guardBulkCommand, completeBulkCommand } from './bulk-roles';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { Prisma, DiscordCommand } from '@/generated/prisma/client';
import type { ApiPrincipal } from '@/lib/api/principal';
import type { ApiAuditContext } from '@/lib/api/audit';
import type { PermissionKey } from '@/lib/permissions';
import { apiSuccess } from '@/lib/api/response';
import { hasApiPermission, parsePermissionGrants } from '@/lib/api/permissions';
import { writeApiAudit } from '@/lib/api/audit';
import { record, snowflake } from '@/lib/discord/config';
import { anyDiscord, body, botOnly, demand, DiscordError, discordApi, fail, id, int, integration, json, pagination, pageResult, query, text, transaction } from './shared';
export const commandPermissions:Record<string,PermissionKey>={'join.retry':'discord:configure','bulk.preview':'discord:configure','bulk.execute':'discord:configure','menu.publish':'discord:configure','welcome.test':'discord:configure','sync.all':'discord:configure','announcement.publish':'discord:announce','announcement.refresh':'discord:announce','announcement.reping':'discord:announce','announcement.repost':'discord:announce','timeout.release':'discord:timeout_release'};
export function authorizeCommand(p:ApiPrincipal,kind:string) {
  const permission=commandPermissions[kind]; if(!permission) fail(422,'Unsupported Discord action.'); demand(p,permission);
  if(kind.startsWith('announcement.')) demand(p,'orbat:edit');
  if(kind==='join.retry') demand(p,'discord:retry');
}
export function commandDto(row:DiscordCommand, includePayload=false) {
  return {id:row.id,kind:row.kind,status:row.status,generation:row.generation,errorCode:row.errorCode,result:row.result,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),...(includePayload?{payload:row.payload,requestKey:row.requestKey,claimToken:row.claimToken,leaseUntil:row.leaseUntil?.toISOString()}: {})};
}
export async function enqueue(tx:Prisma.TransactionClient,p:ApiPrincipal,c:ApiAuditContext,requestKey:unknown,kind:string,payload:Record<string,unknown>) {
  authorizeCommand(p,kind);
  if(!text(requestKey,100)||!/^[-a-zA-Z0-9_]{8,100}$/.test(String(requestKey))) fail(422,'A stable requestKey (8–100 letters, digits, underscores or hyphens) is required.');
  const existing=await tx.discordCommand.findUnique({where:{requestKey:String(requestKey)}});
  if(existing) {
    if(existing.kind!==kind||!isDeepStrictEqual(existing.payload,payload)||existing.requestedBy!==(p.kind==='user'?p.userId:null)) fail(409,'This request key already represents a different action.');
    return existing;
  }
  const row=await tx.discordCommand.create({data:{requestKey:String(requestKey),kind,payload:json(payload),permission:commandPermissions[kind],requestedBy:p.kind==='user'?p.userId:null}});
  await writeApiAudit(tx,c,{action:'discord.command.queued',resource:'discord_command',resourceId:String(row.id),outcome:'success',after:{kind}});
  return row;
}
export function commands(request:Request,method:'GET'|'POST') {
  return discordApi(request,undefined,async(p,c)=>{
    anyDiscord(p);
    if(method==='GET') {
      const {limit,cursor}=pagination(request);
      const allowed=Object.entries(commandPermissions).filter(([,permission])=>hasApiPermission(p.permissions,permission)).filter(([kind])=>!kind.startsWith('announcement.')||hasApiPermission(p.permissions,'orbat:edit')).filter(([kind])=>kind!=='join.retry'||hasApiPermission(p.permissions,'discord:retry')).map(([kind])=>kind);
      const rows=await prisma.discordCommand.findMany({where:{kind:{in:allowed},...(cursor?{id:{lt:cursor}}:{})},orderBy:{id:'desc'},take:limit+1});
      const page=pageResult(rows,limit);return apiSuccess(page.data.map(r=>commandDto(r)),{meta:page.meta});
    }
    query(request); const b=await body(request,['requestKey','kind','payload']);
    if(!['menu.publish','welcome.test','sync.all'].includes(String(b.kind))||!record(b.payload)) fail(422,'Unsupported action or payload.');
    authorizeCommand(p,String(b.kind));
    const payload=b.payload as Record<string,unknown>;
    if(Object.keys(payload).some(k=>b.kind==='menu.publish'?k!=='menuId':true)) fail(422,'Unknown action payload field.');
    const row=await transaction(async tx=>{
      const {settings}=await integration(tx);
      if(!settings.guildId) fail(409,'Configure the Discord server first.');
      if(b.kind==='menu.publish'&&!settings.menus.some(m=>m.id===payload.menuId)) fail(404,'Role menu not found.');
      if(b.kind==='welcome.test'&&!settings.welcomeChannelId) fail(409,'Configure a welcome channel first.');
      if(b.kind==='sync.all'&&!settings.nicknameSync&&!settings.rankRoleSync) fail(409,'Enable name or rank synchronization first.');
      return enqueue(tx,p,c,b.requestKey,String(b.kind),payload);
    });return apiSuccess(commandDto(row),{status:202});
  });
}
export function retryCommand(request:Request,value:string) {
  return discordApi(request,'discord:retry',async(p,c)=>{
    query(request);await body(request,[]);const commandId=id(value);
    const row=await transaction(async tx=>{
      const existing=await tx.discordCommand.findUnique({where:{id:commandId}});if(!existing) fail(404,'Action not found.');
      authorizeCommand(p,existing!.kind);
      if(existing!.status!=='failed') fail(409,'Only failed actions can be retried.');
      if(existing!.kind==='join.retry') fail(409,'Request a new join-role retry from the failed operation.');
      if(existing!.kind.startsWith('bulk.')) fail(409,'Bulk changes require a new reviewed preview after a failure.');
      if(existing!.kind.startsWith('announcement.')) {
        const newer=await tx.discordCommand.findFirst({where:{id:{gt:commandId},kind:{startsWith:'announcement.'},status:{not:'cancelled'},payload:{path:['orbatId'],equals:(existing!.payload as {orbatId:number}).orbatId}}});
        if(newer) fail(409,'A newer announcement supersedes this action. Refresh the current announcement instead.');
      }
      if(existing!.kind==='timeout.release') {
        const payload=existing!.payload as {caseId:number}; const mc=await tx.discordModerationCase.findUnique({where:{id:payload.caseId}});
        if(!mc||mc.releasedAt) fail(409,'This timeout is no longer pending release.');
      }
      const result=await tx.discordCommand.update({where:{id:commandId},data:{status:'pending',generation:{increment:1},claimedBy:null,claimToken:null,leaseUntil:null,errorCode:null,requestedBy:p.kind==='user'?p.userId:null}});
      await writeApiAudit(tx,c,{action:'discord.command.retried',resource:'discord_command',resourceId:value,outcome:'success'});return result;
    });return apiSuccess(commandDto(row),{status:202});
  });
}
export function claim(request:Request) {
  return discordApi(request,undefined,async(p)=>{
    botOnly(p);query(request);await body(request,[]);
    const command=await transaction(async tx=>{
      const now=new Date();
      const row=await tx.discordCommand.findFirst({where:{OR:[{status:'pending'},{status:'running',leaseUntil:{lte:now}}]},orderBy:{id:'asc'}});
      if(!row) return null;
      if(row.requestedBy!==null) {
        const user=await tx.user.findUnique({where:{id:row.requestedBy},select:{userPermissions:{select:{value:true,permission:{select:{key:true}}}}}});
        const grants=parsePermissionGrants(Object.fromEntries(user?.userPermissions.map(g=>[g.permission.key,g.value])??[]))??{};
        if(!user||!hasApiPermission(grants,row.permission as PermissionKey)||row.kind.startsWith('announcement.')&&!hasApiPermission(grants,'orbat:edit')||row.kind==='join.retry'&&!hasApiPermission(grants,'discord:retry')) {
          await tx.discordCommand.update({where:{id:row.id},data:{status:'cancelled',errorCode:'permission_revoked',claimToken:null,leaseUntil:null}});return null;
        }
      }
      if(row.kind==='timeout.release') {
        const mc=await tx.discordModerationCase.findUnique({where:{id:(row.payload as {caseId:number}).caseId}});
        if(!mc||mc.releasedAt) {await tx.discordCommand.update({where:{id:row.id},data:{status:'cancelled',errorCode:'already_released'}});return null;}
      }
      if(row.kind==='join.retry') {
        const payload=row.payload as {guildId:string;memberId:string;configRevision:number};
        const {row:config,settings}=await integration(tx);
        const banned=await tx.discordModerationCase.findFirst({where:{guildId:payload.guildId,memberId:payload.memberId,action:'ban'}});
        const errorCode=banned?'honeypot_ban':config?.revision!==payload.configRevision||settings.guildId!==payload.guildId?'configuration_changed':null;
        if(errorCode) {await tx.discordCommand.update({where:{id:row.id},data:{status:'cancelled',errorCode,claimToken:null,leaseUntil:null}});return null;}
      }
      if(row.kind.startsWith('bulk.')) {
        try { await guardBulkCommand(tx,row); } catch (error) {
          if (!(error instanceof DiscordError)) throw error;
          await tx.discordCommand.update({where:{id:row.id},data:{status:'cancelled',errorCode:'bulk_preview_stale',claimToken:null,leaseUntil:null}}); return null;
        }
      }
      return tx.discordCommand.update({where:{id:row.id},data:{status:'running',claimToken:randomUUID(),claimedBy:p.tokenId,leaseUntil:new Date(now.getTime()+300000)}});
    });return apiSuccess(command?commandDto(command,true):null);
  });
}
export function complete(request:Request,value:string) {
  return discordApi(request,undefined,async(p,c)=>{
    botOnly(p);query(request);const commandId=id(value);const b=await body(request,['claimToken','generation','success','errorCode','result']);
    if(!text(b.claimToken,100)||!int(b.generation,1)||typeof b.success!=='boolean'||!record(b.result)||Object.keys(b.result).some(k=>!['messageId','channelId'].includes(k))||Object.values(b.result).some(v=>!snowflake(v))||b.errorCode!==undefined&&(!text(b.errorCode,80)||!/^[-a-z_0-9]+$/.test(String(b.errorCode)))) fail(422,'Invalid action acknowledgement.');
    const result=await transaction(async tx=>{
      const row=await tx.discordCommand.findUnique({where:{id:commandId}}); if(!row) fail(404,'Action not found.');
      if(row!.claimToken!==b.claimToken||row!.generation!==b.generation||row!.claimedBy!==(p.tokenId)) fail(409,'This claim has been superseded.');
      if(row!.status==='succeeded'||row!.status==='failed') {
        if((row!.status==='succeeded')!==b.success||!isDeepStrictEqual(row!.result,b.result)||row!.errorCode!==(b.success?null:String(b.errorCode??'discord_action_failed'))) fail(409,'Action already has a different result.'); return row!;
      }
      if(row!.status!=='running'||!row!.leaseUntil||row!.leaseUntil<new Date()) fail(409,'Claim expired; reconcile before claiming again.');
      if(row!.kind.startsWith('bulk.')) await completeBulkCommand(tx,row!,Boolean(b.success));
      if(b.success&&row!.kind.startsWith('announcement.')) {
        const payload=row!.payload as {orbatId:number;channelId:string};const result=b.result as Record<string,string>;
        if(!result.messageId||result.channelId!==payload.channelId) fail(422,'Announcement confirmation requires the expected channel and message IDs.');
        const announcement=await tx.discordAnnouncement.findUnique({where:{orbatId:payload.orbatId}});
        if(['announcement.refresh','announcement.reping'].includes(row!.kind)&&announcement?.messageId!==result.messageId) fail(409,'Refresh and re-ping must update the existing message.');
        if(row!.kind==='announcement.repost'&&!announcement?.missingAt) fail(409,'Only a missing announcement may be reposted.');
        await tx.discordAnnouncement.update({where:{orbatId:payload.orbatId},data:{messageId:result.messageId,missingAt:null,renderedRevision:null,lastRenderedAt:null}});
      }
      if(b.success&&row!.kind==='menu.publish') {
        const menuId=(row!.payload as {menuId:string}).menuId;
        const result=b.result as Record<string,string>;
        const {settings}=await integration(tx);
        const menu=settings.menus.find(menu=>menu.id===menuId);
        if(!menu||!result.messageId||result.channelId!==menu.channelId) fail(422,'Role menu confirmation requires the configured channel and message IDs.');
        const key={menuId,channelId:result.channelId};
        const previous=await tx.discordRoleMenuMessage.findUnique({where:{menuId_channelId:key}});
        if(!previous||previous.lastCommandId<=row!.id) await tx.discordRoleMenuMessage.upsert({where:{menuId_channelId:key},create:{...key,messageId:result.messageId,lastCommandId:row!.id},update:{messageId:result.messageId,lastCommandId:row!.id}});
      }
      if(b.success&&row!.kind==='timeout.release') await tx.discordModerationCase.update({where:{id:(row!.payload as {caseId:number}).caseId},data:{releasedAt:new Date(),status:'released'}});
      const updated=await tx.discordCommand.update({where:{id:commandId},data:{status:b.success?'succeeded':'failed',result:json(b.result),errorCode:b.success?null:String(b.errorCode??'discord_action_failed'),leaseUntil:null}});
      await writeApiAudit(tx,c,{action:'discord.command.completed',resource:'discord_command',resourceId:value,outcome:'success',after:{status:updated.status}});return updated;
    });return apiSuccess(commandDto(result));
  });
}

export function renewLease(request:Request,value:string) {
  return discordApi(request,undefined,async(p)=>{
    botOnly(p);query(request);const commandId=id(value);const b=await body(request,['claimToken','generation']);
    if(!text(b.claimToken,100)||!int(b.generation,1))fail(422,'Claim token and generation are required.');
    const now=new Date(),leaseUntil=new Date(now.getTime()+300000);
    const updated=await prisma.discordCommand.updateMany({where:{id:commandId,status:'running',claimToken:String(b.claimToken),generation:Number(b.generation),claimedBy:p.tokenId,leaseUntil:{gt:now}},data:{leaseUntil}});
    if(!updated.count)fail(409,'Claim expired or was superseded.');return apiSuccess({leaseUntil:leaseUntil.toISOString()});
  });
}
