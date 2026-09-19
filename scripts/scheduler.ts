import { loadEnvConfig } from '@next/env';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run scheduler -- [--once]\nRuns due jobs every 30 seconds. --once discovers and drains up to 100 due jobs, then exits.');
    return;
  }
  if (args.some(arg => arg !== '--once')) throw new Error('Unknown scheduler argument');
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { prisma } = await import('../lib/prisma');
  const { discoverJobs, runNextJob } = await import('../lib/scheduler/worker');
  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = () => { stopping = true; wake?.(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    do {
      try {
        await discoverJobs();
        for (let count = 0; count < 100 && !stopping; count++) if (!await runNextJob()) break;
      } catch {
        console.error(JSON.stringify({ event: 'scheduler.tick_failed', timestamp: new Date().toISOString() }));
        if (args.includes('--once')) process.exitCode = 1;
      }
      if (args.includes('--once') || stopping) break;
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { wake = undefined; resolve(); }, 30000);
        wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
      });
    } while (!stopping);
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Scheduler startup failed'); process.exitCode = 1; });
