import { appendBotEvent } from '@/lib/bot-events';
import { prisma } from '@/lib/prisma';
import { apiSuccess } from '@/lib/api/response';
import { writeApiAudit, type ApiAuditContext } from '@/lib/api/audit';
import { parseProfileUpdate } from '@/lib/api/user-profile';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { availability, mutateSignup, slotPage, catchFailure } from '@/lib/api/signups';
import { snowflake } from '@/lib/discord/config';
import { body, botOnly, discordApi, fail, id, int, integration, pagination, pageResult, query, transaction } from './shared';
async function linked(discordId:string) {
  if(!snowflake(discordId))fail(400,'Invalid Discord account ID.');
  const account=await prisma.authAccount.findUnique({where:{provider_providerUserId:{provider:'discord',providerUserId:discordId}},select:{user:{select:{id:true,username:true,nameRevision:true}}}});
  if(!account)fail(404,'Link this Discord account to a website account first.');return account!.user;
}
export function members(request:Request) {
  return discordApi(request,undefined,async(p,c)=>{
    botOnly(p);const {limit,cursor}=pagination(request,['discordId']);const discordId=new URL(request.url).searchParams.get('discordId');
    if(discordId!==null&&!snowflake(discordId))fail(400,'Invalid Discord account ID.');
    const rows=await prisma.authAccount.findMany({where:{provider:'discord',...(discordId?{providerUserId:discordId}:{}),...(cursor?{id:{gt:cursor}}:{})},select:{id:true,providerUserId:true,user:{select:{id:true,username:true,nameRevision:true,userRank:{select:{retired:true,currentRank:{select:{id:true,name:true,abbreviation:true}}}}}}},orderBy:{id:'asc'},take:limit+1});
    const page=pageResult(rows,limit); if(page.data.length)await writeApiAudit(prisma,c,{action:'user_data.read',resource:'discord_member',targetUserIds:page.data.map(r=>r.user.id),outcome:'success'});
    return apiSuccess(page.data.map(r=>({id:r.id,discordId:r.providerUserId,userId:r.user.id,username:r.user.username,nameRevision:r.user.nameRevision,userRank:r.user.userRank})),{meta:page.meta});
  });
}
export function memberName(request:Request,discordId:string) {
  return discordApi(request,undefined,async(p,c)=>{
    botOnly(p);query(request);const member=await linked(discordId);const b=await body(request,['nameRevision','username','actorDiscordId']);
    if(!int(b.nameRevision)||b.actorDiscordId!==undefined&&b.actorDiscordId!==null&&!snowflake(b.actorDiscordId))fail(422,'A name revision and optional actor Discord ID are required.');
    const update=parseProfileUpdate({username:b.username});if(!update?.username)fail(422,'Use a website base name of 1–50 characters.');
    const {settings}=await integration();if(!settings.nicknameSync||(settings.syncExemptUserIds as string[]).includes(discordId))fail(409,'Name synchronization is disabled for this member.');
    const result=await transaction(async tx=>{
      const changed=await tx.user.updateMany({where:{id:member.id,nameRevision:Number(b.nameRevision)},data:{username:update!.username,nameRevision:{increment:1}}});
      if(!changed.count)fail(409,'The accepted name changed. Refresh the member before syncing.');
      const saved=await tx.user.findUniqueOrThrow({where:{id:member.id},select:{id:true,username:true,nameRevision:true}});
      await appendBotEvent({type:'member.name.changed',aggregate:'member',aggregateId:member.id,payload:{userId:member.id,discordUserId:discordId,nameRevision:saved.nameRevision}},tx);
      await writeApiAudit(tx,c,{action:'discord.name.updated',resource:'user',resourceId:String(member.id),targetUserIds:[member.id],outcome:'success',before:{username:member.username},after:{username:saved.username,actorDiscordId:b.actorDiscordId??null}});return saved;
    });
    try{publishUserProfileEvent(member.id,{source:'user.updated'});}catch{/* reconciliation repairs missed delivery */}
    return apiSuccess(result);
  });
}
async function auditMemberRead(response: Response, method: string, kind: string, orbatId: number, userId: number, context: ApiAuditContext) {
  if (method !== 'GET' || !response.ok) return response;
  await writeApiAudit(prisma, context, {
    action: 'user_data.read',
    resource: kind === 'availability' ? 'orbat_availability' : 'orbat_eligibility',
    resourceId: String(orbatId), targetUserIds: [userId], outcome: 'success',
  });
  return response;
}
/** The bot authenticates the transport; domain access is constrained to the linked member. */
export function memberOrbat(request:Request,discordId:string,value:string,kind:'signup'|'availability'|'eligibility',method:'GET'|'POST'|'PATCH'|'DELETE') {
  return discordApi(request,undefined,async(p,c)=>{
    botOnly(p);const member=await linked(discordId);const orbatId=id(value);
    const {settings}=await integration();if(kind==='availability'?!settings.availabilityEnabled:!settings.signupEnabled)fail(409,'This Discord interaction is disabled.');
    const actor={kind:'user' as const,userId:member.id,permissions:{}};
    try {
      if(kind==='availability'||kind==='eligibility') {
        const response=kind==='availability'?await availability(request,actor,c,orbatId,String(member.id),method as 'GET'|'PATCH'|'DELETE'):await slotPage(request,orbatId,actor,c);
        return await auditMemberRead(response, method, kind, orbatId, member.id, c);
      }
      query(request);const b=await body(request,method==='POST'?['slotId']:method==='DELETE'?['signupId']:['slotId','signupId']);
      if(method!=='POST'&&!int(b.signupId,1))fail(422,'The existing signup ID is required for changes and cancellations.');
      if(method!=='DELETE'&&!int(b.slotId,1))fail(422,'A slot ID is required.');
      if(method!=='DELETE') {
        const slot=await prisma.slot.findUnique({where:{id:Number(b.slotId)},select:{orbatId:true}});if(slot?.orbatId!==orbatId)fail(422,'The selected slot does not belong to this operation.');
      }
      if(!request.headers.get('Idempotency-Key'))fail(422,'An interaction Idempotency-Key is required.');
      const current=method==='POST'?null:await prisma.signup.findUnique({where:{id:Number(b.signupId)},select:{userId:true,slot:{select:{orbatId:true}}}});
      if(current&&(current.userId!==member.id||current.slot.orbatId!==orbatId))fail(403,'This signup does not belong to the invoking member and operation.');
      const domainRequest=new Request(request.url,{method,headers:request.headers,body:JSON.stringify(method==='DELETE'?{}:{slotId:b.slotId})});
      return await mutateSignup(domainRequest,actor,c,method as 'POST'|'PATCH'|'DELETE',method==='POST'?undefined:Number(b.signupId),true);
    }catch(error){if(error instanceof Error)throw error;return catchFailure(error);}
  });
}
