import { prisma } from '@/lib/prisma';
import type { PermissionKey } from '@/lib/permissions';
import type { ApiPrincipal } from './principal';
import { handleApiRequest, handlePublicApiRequest } from './handler';
import { authenticateApi, canAccessApiUser, createApiPrincipalRevalidator } from './auth';
import { hasApiPermission } from './permissions';
import { apiError } from './response';
import { parsePositiveId } from './validation';
import { writeApiAudit } from './audit';
import { eventStream } from './event-stream';
import { subscribeOrbatEvents, type OrbatEvent } from '@/lib/realtime/orbat-events';
import { subscribeUserProfileEvents, subscribeAdminUserProfileEvents, type UserProfileEvent } from '@/lib/realtime/user-events';
import { subscribeInboxEvents, type InboxEvent } from '@/lib/realtime/inbox-events';
import { subscribeAdminCatalogEvents } from '@/lib/realtime/admin-catalog-events';
import { subscribePromotionEvents } from '@/lib/realtime/promotion-events';
import { subscribeTrainingChatEvents, type TrainingChatEvent } from '@/lib/realtime/training-chat-events';
const userPermissions:PermissionKey[]=['user:manage','user:manage_permissions','training:mark','rank:manage_promotions'];
const catalogPermissions:PermissionKey[]=['orbat:create','orbat:edit','orbat:delete','template:create','template:edit','template:delete','subslot:create','subslot:edit','subslot:delete'];
const some=(principal:ApiPrincipal,keys:PermissionKey[])=>keys.some(key=>hasApiPermission(principal.permissions,key));
const idValue=(value:string)=>{const id=parsePositiveId(value);return id&&id<=2147483647?id:null};
const eventBase=(event:{id:string;type:string;occurredAt:string})=>({id:event.id,type:event.type,occurredAt:new Date(event.occurredAt).toISOString()});
async function accessUser(principal:ApiPrincipal,id:number){
 if(principal.kind==='user'&&principal.userId===id)return true;
 for(const key of userPermissions)if(hasApiPermission(principal.permissions,key)&&await canAccessApiUser(principal,id,key))return true;
 return false;
}
export function publicOrbatEvents(request:Request,value?:string){
 return handlePublicApiRequest(request,async(_principal,context)=>{
  const id=value===undefined?undefined:idValue(value);
  if(new URL(request.url).searchParams.size||id===null)return apiError(400,'invalid_request','Use a positive Int32 operation ID without query parameters.');
  if(id&&!await prisma.orbat.findUnique({where:{id},select:{id:true}}))return apiError(404,'not_found','Operation not found.');
  return eventStream<OrbatEvent>(request,{
   subscribe:listener=>id?subscribeOrbatEvents(id,listener):subscribeOrbatEvents(listener),
   validate:async()=>{
    if(!request.headers.has('authorization'))return true;
    const current=await authenticateApi(request);context.principal=current;
    if(current)return true;
    await writeApiAudit(prisma,context,{action:'access.denied',resource:'event_stream',outcome:'denied'});return false;
   },
   project:async event=>{
    if(event.visibility!=='public')return null;
    // Only calendar fields are delivered; never forward arbitrary event payloads.
    const source=event.payload??{};const payload:Record<string,unknown>={};
    for(const key of ['id','name','description','startsAtUtc','endsAtUtc','eventDate','isSideOp'])if(key in source)payload[key]=source[key];
    return {...eventBase(event),orbatId:event.orbatId,payload:event.type==='orbat.created'?payload:null};
   },
  });
 });
}
export function protectedEvents(request:Request,kind:'user'|'users'|'inbox'|'catalog'|'promotions'|'training',value?:string){
 return handleApiRequest(request,undefined,async(initial,context)=>{
  const scoped=['user','inbox','training'].includes(kind);
  const id=scoped?(value==='me'&&kind!=='training'&&initial.kind==='user'?initial.userId:idValue(value??'')):undefined;
  if(new URL(request.url).searchParams.size||scoped&&!id)return apiError(400,'invalid_request','Use a positive Int32 ID without query parameters; me requires a session.');
  let principal=initial;let targetUserId:number|undefined;
  const revalidatePrincipal = await createApiPrincipalRevalidator(initial);
  const allowed=async(p:ApiPrincipal)=>{
   if(kind==='catalog')return some(p,catalogPermissions);
   if(kind==='promotions')return hasApiPermission(p.permissions,'rank:manage_promotions');
   if(kind==='users')return some(p,userPermissions);
   if(kind==='training'){
    const row=await prisma.trainingRequest.findUnique({where:{id:id!},select:{userId:true}});if(!row)return false;targetUserId=row.userId;
    return p.kind==='user'&&p.userId===row.userId||some(p,['training:mark','training:approve_request']);
   }
   if(!await prisma.user.findUnique({where:{id:id!},select:{id:true}}))return false;
   targetUserId=id!;
   return kind==='inbox'?(p.kind==='user'&&p.userId===id||hasApiPermission(p.permissions,'system:super_admin')):accessUser(p,id!);
  };
  if(!await allowed(principal))return apiError(403,'forbidden','You cannot access this event stream.');
  const audit=async(userId:number)=>{
   if(principal.kind!=='user'||principal.userId!==userId)await writeApiAudit(prisma,context,{action:'user_data.read',resource:'event_stream',targetUserIds:[userId],outcome:'success'});
  };
  // The handshake only emits connection metadata; target data is audited when delivered.
  const validate=async()=>{
   const current=await revalidatePrincipal();context.principal=current;
   if(!current||!await allowed(current)){
    await writeApiAudit(prisma,context,{action:'access.denied',resource:'event_stream',outcome:'denied'});return false;
   }
   principal=current;return true;
  };
  if(kind==='user'||kind==='users')return eventStream<UserProfileEvent>(request,{
   subscribe:listener=>kind==='user'?subscribeUserProfileEvents(id!,listener):subscribeAdminUserProfileEvents(listener),validate,
   project:async event=>{if(!await accessUser(principal,event.userId))return null;await audit(event.userId);return {...eventBase(event),userId:event.userId}},
  });
  if(kind==='inbox')return eventStream<InboxEvent>(request,{subscribe:listener=>subscribeInboxEvents(id!,listener),validate,project:async event=>{await audit(id!);return {...eventBase(event),userId:id!}}});
  if(kind==='training')return eventStream<TrainingChatEvent>(request,{subscribe:listener=>subscribeTrainingChatEvents(id!,listener),validate,project:async event=>{await audit(targetUserId!);return {...eventBase(event),requestId:id!}}});
  if(kind==='promotions')return eventStream(request,{subscribe:subscribePromotionEvents,validate,project:async event=>eventBase(event)});
  return eventStream(request,{subscribe:subscribeAdminCatalogEvents,validate,project:async event=>{
   const prefix=event.type==='orbat.changed'?'orbat:':event.type==='template.changed'?'template:':'subslot:';
   return some(principal,catalogPermissions.filter(key=>key.startsWith(prefix)))?eventBase(event):null;
  }});
 });
}
