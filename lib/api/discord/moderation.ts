import { prisma } from '@/lib/prisma';
import { apiSuccess } from '@/lib/api/response';
import { writeApiAudit } from '@/lib/api/audit';
import { hasApiPermission } from '@/lib/api/permissions';
import { classifyMember, record, snowflake } from '@/lib/discord/config';
import { body, botOnly, discordApi, fail, id, instant, int, integration, json, pagination, pageResult, query, text, transaction } from './shared';
import { enqueue, commandDto } from './commands';
export function cases(request:Request,method:'GET'|'POST') {
  return discordApi(request,undefined,async(p,c)=>{
    if(method==='GET') {
      if(!['discord:moderation_view','discord:timeout_release','discord:evidence_view'].some(k=>hasApiPermission(p.permissions,k as 'discord:moderation_view'))) fail(403,'Requires moderation review, timeout release, or evidence access.');
      const {limit,cursor}=pagination(request);const rows=await prisma.discordModerationCase.findMany({where:cursor?{id:{lt:cursor}}:{},orderBy:{id:'desc'},take:limit+1});
      const page=pageResult(rows,limit);await writeApiAudit(prisma,c,{action:'discord.cases.read',resource:'discord_case',outcome:'success'});return apiSuccess(page.data,{meta:page.meta});
    }
    botOnly(p);query(request);const b=await body(request,['triggerId','guildId','memberId','roleIds','configRevision','occurredAt']);
    if(!snowflake(b.triggerId)||!snowflake(b.guildId)||!snowflake(b.memberId)||!int(b.configRevision)||!Array.isArray(b.roleIds)||b.roleIds.length>250||!b.roleIds.every(snowflake)) fail(422,'Invalid honeypot trigger.');
    const occurredAt=instant(b.occurredAt); if(occurredAt.getTime()>Date.now()+60000) fail(422,'Trigger cannot be in the future.');
    const result=await transaction(async tx=>{
      const existing=await tx.discordModerationCase.findUnique({where:{triggerId:String(b.triggerId)}});
      if(existing){if(existing.memberId!==b.memberId||existing.guildId!==b.guildId)fail(409,'Trigger already belongs to a different case.');return existing;}
      const {settings,row}=await integration(tx);
      if(!settings.honeypotEnabled||settings.guildId!==b.guildId) fail(409,'Honeypot is not enabled for this server.');
      if(row?.revision!==b.configRevision) fail(409,'Fetch current configuration and recheck member roles.');
      const action=classifyMember(settings,String(b.memberId),b.roleIds as string[]);
      const result=await tx.discordModerationCase.create({data:{triggerId:String(b.triggerId),guildId:String(b.guildId),memberId:String(b.memberId),roleIds:json(b.roleIds),configRevision:Number(b.configRevision),configSnapshot:json(settings),occurredAt,action,status:action==='exempt'?'exempt':'pending',timeoutUntil:action==='timeout'?new Date(Date.now()+Number(settings.timeoutHours)*3600000):null}});
      if(action==='ban') await tx.discordCommand.updateMany({where:{kind:'join.retry',status:{in:['pending','running']},AND:[{payload:{path:['memberId'],equals:String(b.memberId)}},{payload:{path:['guildId'],equals:String(b.guildId)}}]},data:{status:'cancelled',errorCode:'honeypot_ban',claimToken:null,leaseUntil:null}});
      await writeApiAudit(tx,c,{action:'discord.case.created',resource:'discord_case',resourceId:String(result.id),outcome:'success',after:{decision:action,configRevision:result.configRevision}});return result;
    });return apiSuccess(result,{status:201});
  });
}
export function caseUpdate(request:Request,value:string) {
  return discordApi(request,undefined,async(p,c)=>{
    botOnly(p);query(request);const caseId=id(value);const b=await body(request,['status','cleanup','appliedAt','timeoutUntil']);
    if(b.status!==undefined&&!['applied','failed'].includes(String(b.status)))fail(422,'Status must be applied or failed.');
    if(b.status===undefined&&(b.cleanup===undefined||b.appliedAt!==undefined||b.timeoutUntil!==undefined))fail(422,'A cleanup-only update requires cleanup and cannot change punishment timestamps.');
    if(b.cleanup!==undefined&&(!record(b.cleanup)||Object.keys(b.cleanup).some(k=>!['scanned','deleted','failed','evidenceFailed','messages'].includes(k))||Object.entries(b.cleanup).some(([k,v])=>k==='messages'?(!Array.isArray(v)||v.length>500||v.some(m=>!record(m)||Object.keys(m).some(f=>!['messageId','status','errorCode'].includes(f))||!snowflake(m.messageId)||!['captured','deleted','inaccessible','failed'].includes(String(m.status))||m.errorCode!==undefined&&(!text(m.errorCode,80)||!/^[-a-z_0-9]+$/.test(String(m.errorCode))))):!int(v))))fail(422,'Cleanup contains non-negative counts only.');
    const result=await transaction(async tx=>{
      const mc=await tx.discordModerationCase.findUnique({where:{id:caseId}});if(!mc)fail(404,'Case not found.');
      if(mc!.action==='exempt'||b.status!==undefined&&mc!.releasedAt)fail(409,'This case cannot be punished.');
      if(mc!.status==='applied'&&b.status==='failed')fail(409,'A confirmed punishment cannot become failed.');
      let timeoutUntil=mc!.timeoutUntil;
      if(b.status==='applied'&&mc!.action==='timeout') {
        const appliedAt=instant(b.appliedAt); timeoutUntil=instant(b.timeoutUntil);
        const configuredHours=Number((mc!.configSnapshot as Record<string,unknown>).timeoutHours);
        if(appliedAt.getTime()>Date.now()+60000||appliedAt<mc!.occurredAt||timeoutUntil.getTime()<appliedAt.getTime()+Math.max(24,configuredHours)*3600000)fail(422,'Confirmed timeout must last at least the configured duration from execution.');
      }
      const row=await tx.discordModerationCase.update({where:{id:caseId},data:{...(b.status!==undefined?{status:String(b.status),timeoutUntil}:{}),...(b.cleanup?{cleanup:json(b.cleanup)}:{})}});
      await writeApiAudit(tx,c,{action:'discord.case.updated',resource:'discord_case',resourceId:value,outcome:'success',after:{status:row.status}});return row;
    });return apiSuccess(result);
  });
}
export function release(request:Request,value:string) {
  return discordApi(request,'discord:timeout_release',async(p,c)=>{
    query(request);const caseId=id(value);const b=await body(request,['requestKey','reason']);
    if(b.reason!==undefined&&(!text(b.reason,500)||!String(b.reason).trim())) fail(422,'Use a nonempty release reason of at most 500 characters.');
    const result=await transaction(async tx=>{
      const mc=await tx.discordModerationCase.findUnique({where:{id:caseId}});if(!mc)fail(404,'Case not found.');
      if(mc!.action!=='timeout'||mc!.releasedAt||!mc!.timeoutUntil||mc!.timeoutUntil<=new Date())fail(409,'No active timeout to release.');
      const pending=await tx.discordCommand.findFirst({where:{kind:'timeout.release',status:{in:['pending','running']},payload:{path:['caseId'],equals:caseId}}});
      if(pending&&pending.requestKey!==b.requestKey)fail(409,'Release is already pending.');
      return enqueue(tx,p,c,b.requestKey,'timeout.release',{caseId,memberId:mc!.memberId,guildId:mc!.guildId,...(b.reason!==undefined?{reason:b.reason}:{})});
    });return apiSuccess(commandDto(result),{status:202});
  });
}

export function caseDetail(request: Request, value: string) {
  return discordApi(request, undefined, async (principal, audit) => {
    if (!['discord:moderation_view', 'discord:timeout_release', 'discord:evidence_view'].some(key => hasApiPermission(principal.permissions, key as 'discord:moderation_view'))) fail(403, 'Requires moderation review, timeout release, or evidence access.');
    query(request);
    const row = await prisma.discordModerationCase.findUnique({where: {id: id(value)}});
    if (!row) return fail(404, 'Case not found.');
    await writeApiAudit(prisma, audit, {action: 'discord.cases.read', resource: 'discord_case', resourceId: value, outcome: 'success'});
    return apiSuccess(row);
  });
}
