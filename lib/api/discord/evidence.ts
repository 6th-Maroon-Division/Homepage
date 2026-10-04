import { isDeepStrictEqual } from 'node:util';
import { prisma } from '@/lib/prisma';
import { apiSuccess } from '@/lib/api/response';
import { writeApiAudit } from '@/lib/api/audit';
import { record, snowflake } from '@/lib/discord/config';
import { RECOVERY_MS } from '@/lib/discord/evidence-maintenance';
import { body, botOnly, demand, discordApi, fail, id, instant, int, integration, json, pagination, pageResult, query, text, transaction } from './shared';
const evidenceSelect={id:true,caseId:true,messageId:true,channelId:true,authorId:true,sentAt:true,content:true,attachments:true,capturedAt:true,expiresAt:true,indefinite:true,deletedAt:true,recoverUntil:true,version:true} as const;
export function evidence(request:Request,method:'GET'|'POST') {
  return discordApi(request,method==='GET'?'discord:evidence_view':undefined,async(p,c)=>{
    if(method==='GET') {
      const {limit,cursor}=pagination(request,['state','caseId']);const params=new URL(request.url).searchParams;const state=params.get('state')??'active';
      if(!['active','deleted'].includes(state))fail(400,'state must be active or deleted.');
      const caseId=params.has('caseId')?id(params.get('caseId')!):undefined;
      const rows=await prisma.discordEvidence.findMany({where:{caseId,purgedAt:null,...(state==='active'?{deletedAt:null}:{deletedAt:{not:null},recoverUntil:{gt:new Date()}}),...(cursor?{id:{lt:cursor}}:{})},select:evidenceSelect,orderBy:{id:'desc'},take:limit+1});
      const page=pageResult(rows,limit);await writeApiAudit(prisma,c,{action:'discord.evidence.read',resource:'discord_evidence',outcome:'success',after:{ids:page.data.map(r=>r.id)}});
      const response=apiSuccess(page.data,{meta:page.meta});response.headers.set('Cache-Control','private, no-store');return response;
    }
    botOnly(p);query(request);const b=await body(request,['caseId','messageId','channelId','authorId','sentAt','content','attachments'],12000000);
    if(!int(b.caseId,1)||!snowflake(b.messageId)||!snowflake(b.channelId)||!snowflake(b.authorId)||!text(b.content,20000)||!Array.isArray(b.attachments)||b.attachments.length>10)fail(422,'Invalid evidence.');
    let bytes=0;
    for(const attachment of b.attachments as unknown[]) {
      if(!record(attachment)||Object.keys(attachment).some(k=>!['name','contentType','dataBase64'].includes(k))||!text(attachment.name,200)||!attachment.name||!text(attachment.contentType,100)||!/^[-\w.+]+\/[-\w.+]+$/.test(String(attachment.contentType))||!text(attachment.dataBase64,11200000)||(String(attachment.dataBase64).length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(String(attachment.dataBase64))))fail(422,'Attachments require a name, media type, and base64 file bytes.');
      bytes+=Buffer.from(String((attachment as Record<string,unknown>).dataBase64),'base64').length;
    }
    if(bytes>8*1024*1024)fail(413,'Attachments exceed the 8 MiB evidence limit. Record an evidence-capture failure rather than deleting uncaptured files.');
    const sentAt=instant(b.sentAt);
    const result=await transaction(async tx=>{
      const mc=await tx.discordModerationCase.findUnique({where:{id:Number(b.caseId)}});if(!mc)fail(404,'Case not found.');
      if(b.authorId!==mc!.memberId||sentAt>mc!.occurredAt||sentAt.getTime()<mc!.occurredAt.getTime()-30*60000)fail(422,'Evidence must belong to the triggering member within the cleanup window.');
      const old=await tx.discordEvidence.findUnique({where:{caseId_messageId:{caseId:mc!.id,messageId:String(b.messageId)}}});
      if(old) {
        if(old.purgedAt||old.deletedAt)fail(409,'Evidence was deleted; uploads cannot resurrect it.');
        if(old.content!==b.content||old.channelId!==b.channelId||!isDeepStrictEqual(old.attachments,b.attachments))fail(409,'Evidence is immutable; this message was already captured with different content.');
        return {id:old.id,version:old.version,capturedAt:old.capturedAt};
      }
      const {retention}=await integration(tx);const now=new Date();
      const created=await tx.discordEvidence.create({data:{caseId:mc!.id,messageId:String(b.messageId),channelId:String(b.channelId),authorId:String(b.authorId),sentAt,content:String(b.content),attachments:json(b.attachments),capturedAt:now,indefinite:retention.mode==='indefinite',expiresAt:retention.mode==='days'?new Date(now.getTime()+retention.days!*86400000):null}});
      await writeApiAudit(tx,c,{action:'discord.evidence.captured',resource:'discord_evidence',resourceId:String(created.id),outcome:'success'});return {id:created.id,version:created.version,capturedAt:created.capturedAt};
    });return apiSuccess(result,{status:201});
  });
}
export function evidenceAction(request:Request,value:string) {
  return discordApi(request,'discord:evidence_view',async(p,c)=>{
    query(request);const evidenceId=id(value);const b=await body(request,['version','action']);
    if(!int(b.version,1)||!['delete','restore','indefinite'].includes(String(b.action)))fail(422,'Expected version and valid evidence action required.');
    demand(p,b.action==='delete'?'discord:evidence_delete':b.action==='restore'?'discord:evidence_restore':'discord:evidence_retention');
    const result=await transaction(async tx=>{
      const row=await tx.discordEvidence.findUnique({where:{id:evidenceId}});if(!row)fail(404,'Evidence not found.');
      if(row!.version!==b.version)fail(409,'Evidence changed. Refresh before acting.');
      if(row!.purgedAt)fail(409,'Evidence was permanently purged.');
      const now=new Date();let data;
      if(b.action==='delete') {
        if(row!.deletedAt)fail(409,'Already deleted; the recovery deadline cannot be reset.');
        data={deletedAt:now,recoverUntil:new Date(now.getTime()+RECOVERY_MS)};
      } else if(b.action==='restore') {
        if(!row!.deletedAt||!row!.recoverUntil||row!.recoverUntil<=now)fail(409,'The evidence is not recoverable.');
        data={deletedAt:null,recoverUntil:null,expiresAt:row!.indefinite?null:new Date(Math.max(row!.expiresAt?.getTime()??0,now.getTime()+RECOVERY_MS))};
      } else {
        if(row!.deletedAt)fail(409,'Restore deleted evidence before retaining it indefinitely.');
        data={indefinite:true,expiresAt:null};
      }
      const updated=await tx.discordEvidence.update({where:{id:evidenceId},data:{...data,version:{increment:1}},select:evidenceSelect});
      await writeApiAudit(tx,c,{action:`discord.evidence.${b.action}`,resource:'discord_evidence',resourceId:value,outcome:'success'});return updated;
    });const response=apiSuccess(result);response.headers.set('Cache-Control','private, no-store');return response;
  });
}
