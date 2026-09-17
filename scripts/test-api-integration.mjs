import { startPrismaDevServer } from '@prisma/dev';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let child;
let server;
let stopping = false;
let failed = false;

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  child?.kill(signal);
  await server?.close();
  process.exit(signal === 'SIGINT' ? 130 : 143);
}
process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));

function run(script, args, env) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [script, ...args], { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      child = undefined;
      if (code === 0) resolve();
      else reject(new Error(`${script} failed (${signal ?? code}).`));
    });
  });
}

try {
  console.log('Starting isolated Prisma-managed PGlite database…');
  server = await startPrismaDevServer({
    name: `orbat-api-test-${randomUUID()}`, persistenceMode: 'stateless',
    port: 0, databasePort: 0, shadowDatabasePort: 0,
  });
  const databaseUrl = server.database.prismaORMConnectionString;
  const env = {
    ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl,
    API_INTEGRATION_DATABASE_URL: databaseUrl,
    CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1',
  };
  // Only the newly created ephemeral database is passed to schema and test processes.
  await run('node_modules/prisma/build/index.js', ['db', 'push'], env);
  await run('node_modules/prisma/build/index.js', ['generate'], env);
  await run('node_modules/vitest/vitest.mjs', ['run', '--config', 'vitest.integration.config.mts'], env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  failed = true;
} finally {
  await server?.close();
}
// Prisma dev cleanup can change process.exitCode; preserve test failures after it.
if (failed) process.exitCode = 1;
