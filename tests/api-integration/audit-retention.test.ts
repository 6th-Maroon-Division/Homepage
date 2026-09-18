import {afterAll,expect,test} from 'vitest';
import {prisma} from '@/lib/prisma';
import {pruneExpiredApiAudits} from '@/lib/audit-retention';
afterAll(async()=>{await prisma.$disconnect()});
test('365-day UTC retention is dry-run by default and deletes only expired audit rows',async()=>{
 const now=new Date('2026-09-18T12:00:00Z'),cutoff=new Date(now.getTime()-365*86400000);
 const base={correlationId:'retention-integration',actorType:'anonymous',method:'GET',path:'/api/example',action:'user_data.read',resource:'user',outcome:'success',targetUserIds:[]};
 const old=await prisma.apiAuditLog.create({data:{...base,occurredAt:new Date(cutoff.getTime()-1)}});
 const boundary=await prisma.apiAuditLog.create({data:{...base,occurredAt:cutoff}});
 const recent=await prisma.apiAuditLog.create({data:{...base,occurredAt:now}});
 const dry=await pruneExpiredApiAudits(prisma,{now});expect(dry).toMatchObject({applied:false,cutoff:cutoff.toISOString(),deletedCount:0});expect(dry.eligibleCount).toBeGreaterThanOrEqual(1);expect(await prisma.apiAuditLog.findUnique({where:{id:old.id}})).not.toBeNull();
 const result=await pruneExpiredApiAudits(prisma,{now,apply:true});expect(result.deletedCount).toBe(dry.eligibleCount);expect(await prisma.apiAuditLog.findUnique({where:{id:old.id}})).toBeNull();expect(await prisma.apiAuditLog.count({where:{id:{in:[boundary.id,recent.id]}}})).toBe(2);
 expect((await pruneExpiredApiAudits(prisma,{now,apply:true})).deletedCount).toBe(0);
 await expect(pruneExpiredApiAudits(prisma,{now:new Date(NaN)})).rejects.toThrow('valid clock');
});
