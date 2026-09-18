import type { MessageType, Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from './handler';
import { apiError, apiSuccess } from './response';
import { readJsonBody } from './request';
import { parseCursorPagination, parsePositiveId } from './validation';
import { hasApiPermission } from './permissions';
import { writeApiAudit } from './audit';
import { publishInboxEvents } from '@/lib/realtime/inbox-events';
const types = ['orbat','training','rankup','general','alert'];
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function validMessageUrl(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 2000 || /[\s\\]/.test(value)) return false;
  if (value.startsWith('/')) return !value.startsWith('//');
  try { const url=new URL(value);return ['http:','https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
export function sendMessage(request: Request) {
  return handleApiRequest(request, 'system:super_admin', async (principal, context) => {
    if (new URL(request.url).searchParams.size) return apiError(400,'invalid_request','Query parameters are not supported.');
    const input=await readJsonBody(request);
    if (!object(input) || Object.keys(input).some(key=>!['title','body','type','actionUrl','audience'].includes(key)) || typeof input.title!=='string' || !input.title.trim() || input.title.trim().length>200 || typeof input.body!=='string' || !input.body.trim() || input.body.trim().length>10000 || (input.type!==undefined && (typeof input.type!=='string'||!types.includes(input.type))) || !validMessageUrl(input.actionUrl??null)) return apiError(422,'validation_failed','Use title (1–200), body (1–10000), supported type, safe actionUrl and audience.');
    const audience=input.audience;
    if (!object(audience) || typeof audience.type !== 'string' || !['all','admin','users'].includes(audience.type) || Object.keys(audience).some(key=>!['type','userIds'].includes(key)) || (audience.type==='users' ? !Array.isArray(audience.userIds)||!audience.userIds.length||audience.userIds.length>1000||!audience.userIds.every(positiveId)||new Set(audience.userIds).size!==audience.userIds.length : 'userIds' in audience)) return apiError(422,'validation_failed','audience is {type:all|admin} or {type:users,userIds:[unique numeric IDs]} (maximum1000).');
    try {
      const result=await prisma.$transaction(async tx=>{
        const recipients=await tx.user.findMany({where:audience.type==='users'?{id:{in:audience.userIds as number[]}}:audience.type==='admin'?{userPermissions:{some:{permission:{key:'system:super_admin'},value:{gt:0}}}}:{},select:{id:true},orderBy:{id:'asc'}});
        if (audience.type==='users' && recipients.length!==(audience.userIds as number[]).length) return {error:apiError(404,'not_found','A recipient does not exist.')};
        if (!recipients.length) return {error:apiError(422,'validation_failed','Audience has no recipients.')};
        const created=await tx.message.create({data:{title:(input.title as string).trim(),body:(input.body as string).trim(),type:(input.type??'general') as MessageType,actionUrl:(input.actionUrl??null) as string|null,createdById:principal.kind==='user'?principal.userId:null},select:{id:true,createdAt:true}});
        const userIds=recipients.map(row=>row.id);
        await tx.messageRecipient.createMany({data:userIds.map(userId=>({messageId:created.id,userId,audienceType:audience.type==='users'?'user' as const:audience.type as 'all'|'admin',channel:'web' as const}))});
        await writeApiAudit(tx,context,{action:'message.sent',resource:'message',resourceId:String(created.id),targetUserIds:userIds,outcome:'success',after:{type:input.type??'general',recipientCount:userIds.length}});
        return {data:{id:created.id,createdAt:created.createdAt.toISOString(),recipientCount:userIds.length},userIds};
      },{isolationLevel:'Serializable'});
      if(result.error)return result.error;
      try{publishInboxEvents(result.userIds!)}catch{/* Committed delivery remains successful. */}
      return apiSuccess(result.data,{status:201});
    } catch(error){if(object(error)&&['P2003','P2034'].includes(String(error.code)))return apiError(409,'conflict','Recipients changed; retry the request.');throw error;}
  });
}
export function userMessages(request:Request,idValue:string,method:'GET'|'PATCH',recipientValue?:string){
 return handleApiRequest(request,undefined,async(principal,context)=>{
  const id=idValue==='me'&&principal.kind==='user'?principal.userId:parsePositiveId(idValue);
  const recipientId=recipientValue===undefined?undefined:parsePositiveId(recipientValue);
  if(!id||id>2147483647||recipientValue!==undefined&&(!recipientId||recipientId>2147483647))return apiError(400,'invalid_request','Use positive Int32 IDs; me requires a user session.');
  if(!(principal.kind==='user'&&principal.userId===id)&&!hasApiPermission(principal.permissions,'system:super_admin'))return apiError(403,'forbidden','Only the owner or a superadmin can access an inbox.');
  const params=new URL(request.url).searchParams;
  if(method==='PATCH'&&params.size||[...params.keys()].some(key=>!['limit','cursor','type','unread'].includes(key)||params.getAll(key).length!==1))return apiError(400,'invalid_request','Unknown or repeated query parameter.');
  if(method==='PATCH'){
   const body=await readJsonBody(request);if(!object(body)||Object.keys(body).length!==1||body.isRead!==true)return apiError(422,'validation_failed','Use {isRead:true}.');
   try{
    const result=await prisma.$transaction(async tx=>{
     if(!await tx.user.findUnique({where:{id},select:{id:true}}))return {error:apiError(404,'not_found','User not found.')};
     if(recipientId&&!await tx.messageRecipient.findFirst({where:{id:recipientId,userId:id},select:{id:true}}))return {error:apiError(404,'not_found','Inbox message not found.')};
     const result=await tx.messageRecipient.updateMany({where:{userId:id,isRead:false,...(recipientId?{id:recipientId}:{})},data:{isRead:true,readAt:new Date()}});
     if(result.count)await writeApiAudit(tx,context,{action:'messages.read_state_changed',resource:'message_recipient',...(recipientId?{resourceId:String(recipientId)}:{}),targetUserIds:[id],outcome:'success',after:{isRead:true,updatedCount:result.count}});
     return {count:result.count};
    },{isolationLevel:'Serializable'});
    if(result.error)return result.error;
    if(result.count)try{publishInboxEvents([id])}catch{/* Commit already succeeded. */}
    return apiSuccess({updatedCount:result.count});
   }catch(error){if(object(error)&&error.code==='P2034')return apiError(409,'conflict','Inbox changed; retry the request.');throw error;}
  }
  const paging=parseCursorPagination(params,{defaultLimit:50,maxLimit:100});if(paging.error!==undefined)return apiError(400,'invalid_request',paging.error);
  const type=params.get('type'),unread=params.get('unread');if(type!==null&&!types.includes(type)||unread!==null&&!['true','false'].includes(unread))return apiError(400,'invalid_request','Invalid message type or unread boolean.');
  const {limit,cursor}=paging.data;
  return prisma.$transaction(async tx=>{
   if(!await tx.user.findUnique({where:{id},select:{id:true}}))return apiError(404,'not_found','User not found.');
   const where:Prisma.MessageRecipientWhereInput={userId:id,...(cursor?{id:{lt:cursor}}:{}),...(unread==='true'?{isRead:false}:{}),...(type?{message:{type:type as MessageType}}:{})};
   const rows=await tx.messageRecipient.findMany({where,orderBy:{id:'desc'},take:limit+1,select:{id:true,isRead:true,readAt:true,deliveredAt:true,message:{select:{id:true,title:true,body:true,type:true,actionUrl:true,createdAt:true,createdBy:{select:{id:true,username:true}}}}}});
   const data=rows.slice(0,limit).map(row=>({id:row.id,messageId:row.message.id,title:row.message.title,body:row.message.body,type:row.message.type,actionUrl:row.message.actionUrl,isRead:row.isRead,readAt:row.readAt?.toISOString()??null,deliveredAt:row.deliveredAt.toISOString(),createdAt:row.message.createdAt.toISOString(),createdBy:row.message.createdBy}));
   const unreadCount=await tx.messageRecipient.count({where:{userId:id,isRead:false}});
   const targetUserIds=[...new Set([id,...data.flatMap(row=>row.createdBy?[row.createdBy.id]:[])])].filter(value=>principal.kind!=='user'||value!==principal.userId);
   if(targetUserIds.length)await writeApiAudit(tx,context,{action:'user_data.read',resource:'user_messages',targetUserIds,outcome:'success'});
   return apiSuccess(data,{meta:{limit,nextCursor:rows.length>limit?String(data.at(-1)!.id):null,unreadCount}});
  });
 });
}
