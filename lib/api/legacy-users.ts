import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { appendBotEvent } from '@/lib/bot-events';
import type { ApiPrincipal } from './principal';
import { writeApiAudit, type ApiAuditContext } from './audit';
import { apiSuccess } from './response';
import { readJsonBody } from './request';
import { parseCursorPagination } from './validation';
import { hasApiPermission } from './permissions';
import { isDateOnly } from './utc';
import { rejectAttendance as fail } from './attendance';
import { parseLegacyCsv } from './legacy-csv';
const include = { mappedUser: { select: { id: true, username: true } } } as const;
type Row = Prisma.LegacyUserDataGetPayload<{ include: typeof include }>;
function query(request: Request, allowed: string[]) { const params = new URL(request.url).searchParams; for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) fail(400, 'Unknown or repeated query argument.'); return params; }
function object(value: unknown, allowed: string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(422, 'Invalid payload fields.'); return value as Record<string, unknown>; }
function id(value: unknown): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647) fail(422, 'IDs must be positive 32-bit integers.'); return value; }
export function legacyJoinedDate(value: string | null): string | null {
  if (!value?.trim()) return null;
  const text = value.trim(); const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (isDateOnly(text)) return text;
  if (!match) fail(422, 'Date Joined must be YYYY-MM-DD or DD/MM/YYYY.');
  const date = `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`; if (!isDateOnly(date)) fail(422, 'Invalid Date Joined.'); return date;
}
function dto(row: Row) { let dateJoined: string | null = null; try { dateJoined = legacyJoinedDate(row.dateJoined); } catch { /* Unsupported historic date strings are never exposed as timezone-ambiguous API dates. Apply rejects them. */ } return { ...row, dateJoined, importedAt: row.importedAt.toISOString() }; }
async function readAudit(database: Prisma.TransactionClient, principal: ApiPrincipal, audit: ApiAuditContext, rows: { mappedUserId: number | null }[]) {
  const targets = [...new Set(rows.flatMap(row => row.mappedUserId !== null && (principal.kind === 'bot' || row.mappedUserId !== principal.userId) ? [row.mappedUserId] : []))];
  if (targets.length || rows.some(row => row.mappedUserId === null)) await writeApiAudit(database, audit, { action: 'user_data.read', resource: 'legacy_user', targetUserIds: targets, outcome: 'success' });
}
export async function listLegacyUsers(request: Request, principal: ApiPrincipal, audit: ApiAuditContext) {
  const params = query(request, ['cursor','limit','search','isMapped','isApplied']); const page = parseCursorPagination(params, { defaultLimit:50,maxLimit:100 }); if (page.error !== undefined) fail(400,page.error); const {cursor,limit}=page.data; if(cursor&&cursor>2147483647) fail(400,'Invalid cursor.');
  for (const key of ['isMapped','isApplied']) if(params.has(key)&&!['true','false'].includes(params.get(key)!)) fail(400,`${key} must be true or false.`);
  const search=params.get('search')?.trim();if(search&&search.length>200)fail(400,'search must be at most 200 characters.');
  const where:Prisma.LegacyUserDataWhereInput={...(cursor?{id:{gt:cursor}}:{}),...(search?{OR:[{discordUsername:{contains:search,mode:'insensitive'}},{legacyId:{contains:search,mode:'insensitive'}}]}:{}),...(params.has('isMapped')?{isMapped:params.get('isMapped')==='true'}:{}),...(params.has('isApplied')?{isApplied:params.get('isApplied')==='true'}:{})};
  const rows=await prisma.legacyUserData.findMany({where,include,orderBy:{id:'asc'},take:limit+1});const returned=rows.slice(0,limit);await readAudit(prisma,principal,audit,returned);return apiSuccess(returned.map(dto),{meta:{limit,nextCursor:rows.length>limit?String(returned.at(-1)!.id):null}});
}
export function parseLegacyUsers(csvData: unknown) {
  const rows=parseLegacyCsv(csvData);if(rows.length<2)fail(422,'A CSV header and data rows are required.');
  const expected=['id','name','rank','date joined','tig since last promo','total tig','old data'];const headers=rows[0].map(cell=>cell.toLowerCase());if(headers.length!==7||expected.some(key=>headers.filter(header=>header===key).length!==1))fail(422,'Expected ID,NAME,Rank,Date Joined,TIG Since Last Promo,TOTAL TIG,Old Data headers.');
  if(rows.length>1001)fail(422,'Import at most 1000 rows at a time.');const seen=new Set<string>();
  return rows.slice(1).map(row=>{if(row.length!==7)fail(422,'Every CSV row must contain seven cells.');const cell=(key:string)=>row[headers.indexOf(key)];const legacyId=cell('id'),discordUsername=cell('name'),rankName=cell('rank');if(!legacyId||!discordUsername||!rankName)fail(422,'ID, NAME and Rank must be nonempty.');if(seen.has(legacyId))fail(422,'Legacy IDs must be unique within the CSV.');seen.add(legacyId);
    const number=(key:string)=>{const raw=cell(key)||'0';if(!/^\d+$/.test(raw)||Number(raw)>2147483647)fail(422,'Attendance counts must be nonnegative 32-bit integers.');return Number(raw);};
    return {legacyId,discordUsername,rankName,dateJoined:legacyJoinedDate(cell('date joined')),tigSinceLastPromo:number('tig since last promo'),totalTig:number('total tig'),oldData:number('old data')};
  });
}
export async function importLegacyUsers(request:Request,principal:ApiPrincipal,audit:ApiAuditContext){
  query(request,[]);const body=object(await readJsonBody(request),['csvData','previewOnly','autoMap']);for(const key of ['previewOnly','autoMap'])if(body[key]!==undefined&&typeof body[key]!=='boolean')fail(422,`${key} must be boolean.`);if(body.autoMap&&!hasApiPermission(principal.permissions,'system:super_admin'))fail(403,'Automatic mapping requires system:super_admin.');const records=parseLegacyUsers(body.csvData);
  const result=await prisma.$transaction(async tx=>{
    const ranks=await tx.rank.findMany({select:{abbreviation:true}});const rankNames=new Set(ranks.map(rank=>rank.abbreviation.toLowerCase()));
    const existing=await tx.legacyUserData.findMany({where:{legacyId:{in:records.map(row=>row.legacyId)}},select:{legacyId:true}});const existingIds=new Set(existing.map(row=>row.legacyId));const pending=records.filter(row=>!existingIds.has(row.legacyId));const candidates=[];
    for(const row of pending){let mappedUserId:number|null=null;if(body.autoMap){const matches=await tx.user.findMany({where:{username:{equals:row.discordUsername,mode:'insensitive'}},select:{id:true},take:2});if(matches.length===1)mappedUserId=matches[0].id;}candidates.push({...row,mappedUserId,isMapped:mappedUserId!==null,notes:rankNames.has(row.rankName.toLowerCase())?null:`Invalid rank: ${row.rankName}`});}
    const result={imported:candidates.length,autoMapped:candidates.filter(row=>row.isMapped).length,skipped:records.length-candidates.length,preview:body.previewOnly?candidates:[]};
    if(body.previewOnly){if(body.autoMap)await readAudit(tx,principal,audit,candidates.filter(row=>row.mappedUserId!==null));return result;}
    if(candidates.length){const created=await tx.legacyUserData.createManyAndReturn({data:candidates,select:{id:true,mappedUserId:true}});await writeApiAudit(tx,audit,{action:'legacy_user.imported',resource:'legacy_user',targetUserIds:created.flatMap(row=>row.mappedUserId===null?[]:[row.mappedUserId]),outcome:'success',before:{},after:{recordIds:created.map(row=>row.id),importedCount:created.length,autoMappedCount:result.autoMapped}});}
    return result;
  },{isolationLevel:'Serializable',timeout:30000});return apiSuccess(result);
}
export async function mapLegacyUsers(request:Request,_principal:ApiPrincipal,audit:ApiAuditContext){
  query(request,[]);const body=object(await readJsonBody(request),['updates']);if(!Array.isArray(body.updates)||body.updates.length<1||body.updates.length>100)fail(422,'updates must contain 1–100 entries.');const seen=new Set<number>();const updates=body.updates.map(raw=>{const row=object(raw,['id','mappedUserId']);const recordId=id(row.id);if(seen.has(recordId))fail(422,'Duplicate record ID.');seen.add(recordId);return{id:recordId,mappedUserId:row.mappedUserId===null?null:id(row.mappedUserId)};});
  const result=await prisma.$transaction(async tx=>{const plans=[];for(const update of updates){const before=await tx.legacyUserData.findUnique({where:{id:update.id}});if(!before)fail(404,'Legacy record not found.');if(before.isApplied&&before.mappedUserId!==update.mappedUserId)fail(409,'An applied legacy record cannot be remapped.');if(update.mappedUserId!==null&&!await tx.user.findUnique({where:{id:update.mappedUserId},select:{id:true}}))fail(404,'User not found.');plans.push({update,before});}
    const rows=[];for(const {update,before} of plans){const after=await tx.legacyUserData.update({where:{id:update.id},data:{mappedUserId:update.mappedUserId,isMapped:update.mappedUserId!==null},include});await writeApiAudit(tx,audit,{action:'legacy_user.mapping_updated',resource:'legacy_user',resourceId:String(update.id),targetUserIds:[before.mappedUserId,after.mappedUserId].filter((value):value is number=>value!==null),outcome:'success',before:{mappedUserId:before.mappedUserId,isMapped:before.isMapped},after:{mappedUserId:after.mappedUserId,isMapped:after.isMapped}});rows.push(dto(after));}return rows;
  },{isolationLevel:'Serializable',timeout:30000});return apiSuccess(result);
}
export async function applyLegacyUsers(request:Request,principal:ApiPrincipal,audit:ApiAuditContext){
  query(request,[]);const body=object(await readJsonBody(request),['ids']);if(!Array.isArray(body.ids)||body.ids.length<1||body.ids.length>100)fail(422,'ids must contain 1–100 records.');const ids=body.ids.map(id);if(new Set(ids).size!==ids.length)fail(422,'Duplicate record ID.');
  const result=await prisma.$transaction(async tx=>{
    const plans=[];const targetIds=new Set<number>();let skipped=0;
    for(const recordId of ids){const row=await tx.legacyUserData.findUnique({where:{id:recordId}});if(!row)fail(404,'Legacy record not found.');if(row.isApplied){skipped++;continue;}if(!row.isMapped||row.mappedUserId===null)fail(409,'Every record must be mapped before applying.');if(targetIds.has(row.mappedUserId))fail(409,'Only one legacy record may be applied per user.');targetIds.add(row.mappedUserId);
      if(!await tx.user.findUnique({where:{id:row.mappedUserId},select:{id:true}}))fail(404,'Mapped user not found.');if(await tx.legacyUserData.findFirst({where:{mappedUserId:row.mappedUserId,isApplied:true},select:{id:true}}))fail(409,'Legacy data has already been applied to this user.');
      if([row.tigSinceLastPromo,row.totalTig,row.oldData].some(value=>!Number.isInteger(value)||value<0))fail(422,'Legacy attendance counts must be nonnegative integers.');const ranks=await tx.rank.findMany({where:{abbreviation:{equals:row.rankName,mode:'insensitive'}},select:{id:true,name:true},take:2});if(!ranks.length)fail(404,'Legacy rank not found.');if(ranks.length!==1)fail(409,'Legacy rank is ambiguous.');const joined=legacyJoinedDate(row.dateJoined);const before=await tx.userRank.findUnique({where:{userId:row.mappedUserId},include:{currentRank:{select:{name:true}}}});plans.push({row,rank:ranks[0],joined,before});
    }
    for(const {row,rank,joined,before} of plans){const userId=row.mappedUserId!;const lastRankedUpAt=joined?new Date(`${joined}T00:00:00Z`):before?.lastRankedUpAt??new Date();const after=await tx.userRank.upsert({where:{userId},create:{userId,currentRankId:rank.id,attendanceSinceLastRank:row.tigSinceLastPromo,lastRankedUpAt},update:{currentRankId:rank.id,attendanceSinceLastRank:row.tigSinceLastPromo,lastRankedUpAt}});
      const history=await tx.rankHistory.create({data:{userId,previousRankName:before?.currentRank?.name??null,newRankName:rank.name,attendanceTotalAtChange:row.oldData,attendanceDeltaSinceLastRank:row.tigSinceLastPromo,triggeredBy:'import',triggeredByUserId:principal.kind==='user'?principal.userId:null,triggeredByDiscordId:null,outcome:'approved',declineReason:null,note:`Legacy import: Date Joined ${joined??'Unknown'}`}});
      const discord=await tx.authAccount.findFirst({where:{userId,provider:'discord'},select:{providerUserId:true},orderBy:{id:'asc'}});await appendBotEvent({type:'user.rank_changed',aggregate:'rank',aggregateId:history.id,payload:{rankHistoryId:history.id,userId,discordUserId:discord?.providerUserId??null,oldRankId:before?.currentRankId??null,newRankId:rank.id,changeType:'correction',source:'legacy_import'}},tx);await tx.legacyUserData.update({where:{id:row.id},data:{isApplied:true}});
      await writeApiAudit(tx,audit,{action:'legacy_user.applied',resource:'legacy_user',resourceId:String(row.id),targetUserIds:[userId],outcome:'success',before:{currentRankId:before?.currentRankId??null,attendanceSinceLastRank:before?.attendanceSinceLastRank??null,lastRankedUpAt:before?.lastRankedUpAt.toISOString()??null,isApplied:false},after:{currentRankId:after.currentRankId,attendanceSinceLastRank:after.attendanceSinceLastRank,lastRankedUpAt:after.lastRankedUpAt.toISOString(),rankHistoryId:history.id,isApplied:true}});
    }
    return{applied:plans.length,skipped};
  },{isolationLevel:'Serializable',timeout:30000});return apiSuccess(result);
}
