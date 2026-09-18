import { prisma } from '../lib/prisma';
import { pruneExpiredApiAudits } from '../lib/audit-retention';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply', '--help'].includes(arg)) || new Set(args).size !== args.length) throw new Error('Usage: npm run audit:prune -- [--apply]');
  if (args.includes('--help')) { console.log('Dry run by default. --apply deletes only API audit records older than 365 days, in bounded Prisma batches.'); return; }
  const result = await pruneExpiredApiAudits(prisma, { apply: args.includes('--apply') });
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...result }));
}
main().catch(() => { console.error('Audit retention maintenance failed.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
