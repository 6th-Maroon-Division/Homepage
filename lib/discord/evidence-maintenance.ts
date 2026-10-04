import { randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { writeApiAudit } from '@/lib/api/audit';
export const RECOVERY_MS=7*86400000;
/** Bounded scheduled work. Content and attachment bytes share the same transaction. */
export async function maintainDiscordEvidence(now=new Date()) {
  return prisma.$transaction(async tx=>{
    const context={principal:null,actorType:'scheduler' as const,correlationId:randomUUID(),method:'JOB',path:'/scheduler/discord-evidence'};
    const expired=await tx.discordEvidence.findMany({where:{indefinite:false,deletedAt:null,purgedAt:null,expiresAt:{lte:now}},select:{id:true,version:true},orderBy:{id:'asc'},take:100});
    let deleted=0,purged=0;
    for(const row of expired) {
      const r=await tx.discordEvidence.updateMany({where:{id:row.id,version:row.version,deletedAt:null},data:{deletedAt:now,recoverUntil:new Date(now.getTime()+RECOVERY_MS),version:{increment:1}}});
      if(r.count){deleted++;await writeApiAudit(tx,context,{action:'discord.evidence.expired',resource:'discord_evidence',resourceId:String(row.id),outcome:'success'});}
    }
    const due=await tx.discordEvidence.findMany({where:{purgedAt:null,recoverUntil:{lte:now},deletedAt:{not:null}},select:{id:true,version:true},orderBy:{id:'asc'},take:100});
    for(const row of due) {
      const r=await tx.discordEvidence.updateMany({where:{id:row.id,version:row.version,deletedAt:{not:null},recoverUntil:{lte:now}},data:{content:null,attachments:Prisma.DbNull,purgedAt:now,version:{increment:1}}});
      if(r.count){purged++;await writeApiAudit(tx,context,{action:'discord.evidence.purged',resource:'discord_evidence',resourceId:String(row.id),outcome:'success'});}
    }
    return {deleted,purged};
  },{isolationLevel:'Serializable'});
}
