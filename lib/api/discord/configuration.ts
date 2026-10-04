import { parseDiagnostics, inventoryError } from '@/lib/discord/diagnostics';
import { appendBotEvent } from '@/lib/bot-events';
import { apiSuccess } from '@/lib/api/response';
import { hasApiPermission } from '@/lib/api/permissions';
import { writeApiAudit } from '@/lib/api/audit';
import { parseSettings, parseRetention, record, snowflake } from '@/lib/discord/config';
import { anyDiscord, body, botOnly, discordApi, fail, integration, instant, int, json, query, text, transaction } from './shared';
export function configuration(request:Request, method:'GET'|'PUT'|'PATCH') {
  return discordApi(request,method==='PUT'?'discord:configure':method==='PATCH'?'discord:evidence_retention':undefined,async(p,c)=>{
    query(request); anyDiscord(p);
    if(method==='GET') {
      const {row,settings,retention}=await integration();
      return apiSuccess({revision:row?.revision??0,appliedRevision:row?.appliedRevision??0,settings,schemaVersion:1,
        ...(hasApiPermission(p.permissions,'discord:evidence_retention')||hasApiPermission(p.permissions,'discord:evidence_view')?{retention}:{}),
        updatedAt:row?.updatedAt?.toISOString()??null,metadataObservedAt:row?.metadataObservedAt?.toISOString()??null,diagnostics:row?.diagnostics??null,diagnosticsReportedAt:row?.diagnosticsReportedAt?.toISOString()??null,metadata:row?.metadata??null,lastSeenAt:row?.lastSeenAt?.toISOString()??null,health:row?.health??'not_connected',botVersion:row?.botVersion??null});
    }
    const b=await body(request,['revision',method==='PUT'?'settings':'retention']);
    if(!int(b.revision)) fail(422,'Expected configuration revision is required.');
    const parsed=method==='PUT'?parseSettings(b.settings):null;
    if(parsed?.error) fail(422,parsed.error);
    const nextRetention=method==='PATCH'?parseRetention(b.retention):null;
    if(method==='PATCH'&&!nextRetention) fail(422,'Retention must be at least 7 days or indefinite.');
    const result=await transaction(async tx=>{
      const old=await integration(tx); if((old.row?.revision??0)!==b.revision) fail(409,'Configuration was changed by another administrator. Refresh first.');
      const settings=parsed?.data??old.settings,retention=nextRetention??old.retention;
      if(old.settings.guildId && settings.guildId!==old.settings.guildId) fail(409,'Changing the configured server requires a separate migration; create a separate deployment instead.');
      if(parsed?.data) {
        const error=inventoryError(settings,old.row?.metadata,old.row?.metadataObservedAt); if(error) fail(422,error);
        const rankRoles=await tx.rankDiscordRole.findMany({where:{guildId:String(settings.guildId),isActive:true},select:{discordRoleId:true}});
        if(settings.menus.some(m=>m.entries.some(e=>rankRoles.some(r=>r.discordRoleId===e.roleId)))) fail(422,'Managed rank roles cannot be self-assigned through a menu.');
      }
      const result=await tx.discordIntegration.upsert({where:{id:1},create:{id:1,revision:1,settings:json({settings,retention})},update:{revision:{increment:1},settings:json({settings,retention})}});
      if(old.row && old.row.revision>0) await tx.discordConfigurationRevision.upsert({where:{revision:old.row.revision},create:{revision:old.row.revision,settings:json(old.settings)},update:{}});
      await tx.discordConfigurationRevision.create({data:{revision:result.revision,settings:json(settings)}});
      if(nextRetention) {
        if(retention.mode==='indefinite') await tx.discordEvidence.updateMany({where:{deletedAt:null,purgedAt:null},data:{indefinite:true,expiresAt:null,version:{increment:1}}});
        else if(old.retention.mode==='days' && retention.days!>old.retention.days!) {
          let cursor=0;
          for(;;) {
            const items=await tx.discordEvidence.findMany({where:{id:{gt:cursor},deletedAt:null,purgedAt:null,indefinite:false},orderBy:{id:'asc'},take:100});
            if(!items.length) break;
            for(const item of items) {
              const expiresAt=new Date(item.capturedAt.getTime()+retention.days!*86400000);
              if(item.expiresAt && expiresAt>item.expiresAt) await tx.discordEvidence.update({where:{id:item.id},data:{expiresAt,version:{increment:1}}});
            }
            cursor=items.at(-1)!.id;
          }
        }
      }
      await appendBotEvent({type:'discord.configuration.changed',aggregate:'discord',aggregateId:1,payload:{revision:result.revision}},tx);
      await writeApiAudit(tx,c,{action:method==='PUT'?'discord.configuration.updated':'discord.retention.updated',resource:'discord_configuration',resourceId:'1',outcome:'success',after:{revision:result.revision}});
      return {revision:result.revision,appliedRevision:result.appliedRevision};
    });
    return apiSuccess(result);
  });
}
export function heartbeat(request:Request) {
  return discordApi(request,undefined,async(p)=>{
    botOnly(p); query(request);
    const b=await body(request,['guildId','appliedRevision','botVersion','health','metadata','metadataObservedAt','diagnostics']);
    if(!snowflake(b.guildId)||!int(b.appliedRevision)||!text(b.botVersion,100)||!['healthy','degraded','configuration_failed'].includes(String(b.health))) fail(422,'Invalid heartbeat.');
    if(b.metadata!==undefined) {
      if(!record(b.metadata)||Object.keys(b.metadata).some(k=>!['roles','channels'].includes(k))) fail(422,'Invalid server metadata.');
      for(const key of ['roles','channels']) {
        const entries=(b.metadata as Record<string,unknown>)[key];
        if(!Array.isArray(entries)||entries.length>1000||entries.some(e=>!record(e)||Object.keys(e).some(k=>!['id','name','manageable'].includes(k))||!snowflake(e.id)||!text(e.name,100)||typeof e.manageable!=='boolean')) fail(422,'Invalid channel/role metadata.');
      }
    }
    const diagnostics=b.diagnostics===undefined?null:parseDiagnostics(b.diagnostics);
    if(b.diagnostics!==undefined&&!diagnostics) fail(422,'Invalid structured diagnostics.');
    if(b.metadataObservedAt!==undefined&&b.metadata===undefined) fail(422,'Inventory observation time requires metadata.');
    const metadataObservedAt=b.metadata===undefined?null:b.metadataObservedAt===undefined?new Date():instant(b.metadataObservedAt);
    if(metadataObservedAt&&metadataObservedAt.getTime()>Date.now()+60000) fail(422,'Inventory observation time cannot be in the future.');
    const result=await transaction(async tx=>{
      const {row,settings}=await integration(tx); if(!row||settings.guildId!==b.guildId) fail(409,'Server does not match the website configuration.');
      if(Number(b.appliedRevision)>row!.revision) fail(422,'Cannot acknowledge a future revision.');
      if(diagnostics&&diagnostics.configRevision>row!.revision) fail(422,'Diagnostics cannot reference a future revision.');
      if(metadataObservedAt&&row!.metadataObservedAt&&metadataObservedAt<row!.metadataObservedAt) fail(409,'A newer inventory was already received.');
      const updated=await tx.discordIntegration.update({where:{id:1},data:{lastSeenAt:new Date(),appliedRevision:Number(b.appliedRevision),botVersion:String(b.botVersion),health:String(b.health),...(b.metadata?{metadata:json(b.metadata),metadataObservedAt}:{}),...(diagnostics?{diagnostics:json(diagnostics),diagnosticsReportedAt:new Date()}: {})}});
      return {revision:updated.revision,appliedRevision:updated.appliedRevision};
    });
    return apiSuccess(result);
  });
}
