import { startDBServer } from '@prisma/dev/internal/db';
import { ServerState } from '@prisma/dev/internal/state';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('..', import.meta.url));
const runId = randomUUID();
const lockDir = new URL('../.ui-test-lock/', import.meta.url);
let ownsLock = false;
const distDir = `.next-ui-test-${runId}`;
const tsconfigFile = `.tsconfig-ui-test-${runId}.json`;
const clientDir = new URL(`../.prisma-ui-test-${runId}/`, import.meta.url);
const children = new Set();
let database;
let state;
let interrupted = false;
let interruptionCode;
let failure = false;

function launch(script, args, env) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root, env, stdio: 'inherit', detached: process.platform !== 'win32',
  });
  children.add(child);
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      children.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`${script} failed (${signal ?? code}).`));
    });
  });
  // The server can exit while schema setup or browser startup is in progress.
  // Its result is inspected by waitForServer and during the browser run.
  void completion.catch(() => {});
  return { child, completion };
}

function signalChild(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function closeChildren() {
  const running = [...children];
  for (const child of running) signalChild(child, 'SIGTERM');
  const deadline = Date.now() + 10_000;
  while (running.some(child => child.exitCode === null && child.signalCode === null) && Date.now() < deadline) {
    await delay(100);
  }
  for (const child of running) signalChild(child, 'SIGKILL');
}

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error('UI tests interrupted.');
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('UI test web server exited before it was ready.');
    try {
      const response = await fetch(`${baseUrl}/api/auth/session`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
    } catch { /* The server is still compiling or starting its listener. */ }
    await delay(250);
  }
  throw new Error('UI test web server did not become ready within 120 seconds.');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interrupted = true;
    interruptionCode = signal === 'SIGINT' ? 130 : 143;
    for (const child of children) signalChild(child, signal);
  });
}

try {
  try { await mkdir(lockDir); ownsLock = true; }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another UI test run owns .ui-test-lock. Run one suite at a time; remove the lock only if a previous run was forcibly killed.');
    throw error;
  }
  console.log('Starting UI tests with an isolated Prisma-managed PGlite database…');
  // Use the same pinned Prisma database service as the backend integration
  // suite, without its Streams/WAL sidecar sharing the emulated session.
  state = await ServerState.createExclusively({
    name: `orbat-ui-test-${runId}`, persistenceMode: 'stateless',
    port: 0, databasePort: 0, shadowDatabasePort: 0,
  });
  database = await startDBServer('database', state);
  if (interrupted) throw new Error('UI tests interrupted.');
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: database.prismaORMConnectionString,
    UI_TEST_DATABASE_URL: database.prismaORMConnectionString,
    UI_TEST_MODE: '1',
    UI_TEST_BASE_URL: baseUrl,
    UI_TEST_DIST_DIR: distDir,
    UI_TEST_TSCONFIG: tsconfigFile,
    UI_TEST_PRISMA_CLIENT: new URL('client.ts', clientDir).href,
    NEXTAUTH_URL: baseUrl,
    NEXTAUTH_SECRET: `ui-tests-only-${runId}`,
    // Never inherit real provider credentials from the shell or .env files.
    DISCORD_CLIENT_ID: 'ui-tests-only',
    DISCORD_CLIENT_SECRET: 'ui-tests-only',
    DISCORD_BOT_TOKEN: '',
    STEAM_API_KEY: '',
    CHECKPOINT_DISABLE: '1',
    PRISMA_HIDE_UPDATE_MESSAGE: '1',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  await launch('node_modules/prisma/build/index.js', ['db', 'push'], env).completion;
  await launch('node_modules/prisma/build/index.js', ['generate'], env).completion;
  if (interrupted) throw new Error('UI tests interrupted.');
  // Playwright follows package module boundaries when loading TypeScript. The
  // generated Prisma client is ESM, while the application package is CommonJS.
  // Give only the browser fixture's private copy an ESM boundary; never edit
  // the shared generated client that the running development app uses.
  await cp(new URL('../generated/prisma/', import.meta.url), clientDir, { recursive: true });
  await writeFile(new URL('package.json', clientDir), JSON.stringify({ type: 'module' }));
  // Next adds generated route types to its tsconfig; keep that update isolated
  // from the developer's tracked configuration and other concurrent runs.
  await copyFile(new URL('../tsconfig.json', import.meta.url), new URL(`../${tsconfigFile}`, import.meta.url));
  const web = launch('node_modules/next/dist/bin/next', ['dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    ...env, NODE_ENV: 'development',
  });
  await waitForServer(baseUrl, web.child);
  const browser = launch('node_modules/@playwright/test/cli.js', ['test', ...process.argv.slice(2)], env);
  await Promise.race([
    browser.completion,
    web.completion.then(() => { throw new Error('UI test web server stopped during the browser tests.'); }),
  ]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  failure = true;
} finally {
  await closeChildren();
  try { await database?.close(); }
  finally { await state?.close(); }
  await rm(new URL(`../${distDir}`, import.meta.url), { recursive: true, force: true });
  await rm(new URL(`../${tsconfigFile}`, import.meta.url), { force: true });
  await rm(clientDir, { recursive: true, force: true });
  if (ownsLock) await rm(lockDir, { recursive: true, force: true });
}
// Prisma's cleanup can set exitCode; preserve the test or interruption result.
if (interrupted) process.exitCode = interruptionCode;
else if (failure) process.exitCode = 1;
