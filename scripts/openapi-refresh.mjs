#!/usr/bin/env node

import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { resolve, relative, sep } from 'path';
import YAML from 'yaml';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const repoRoot = resolve(__dirname, '..');
const apiRoot = resolve(repoRoot, 'app/api');
const openapiPath = resolve(repoRoot, 'openapi.yaml');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

const SUMMARY_OVERRIDES = {
  'GET /admin/bot-tokens': 'List managed bot tokens',
  'POST /admin/bot-tokens': 'Create a bot token',
  'GET /admin/bot-tokens/{id}': 'Get bot token metadata',
  'PUT /admin/bot-tokens/{id}': 'Update a bot token',
  'DELETE /admin/bot-tokens/{id}': 'Delete a bot token',
  'POST /admin/import/legacy-user-data': 'Import legacy user data for review',
  'PUT /admin/ranks/{rankId}/discord-role': 'Create or update a Discord rank-role mapping',
  'DELETE /admin/ranks/{rankId}/discord-role': 'Delete a Discord rank-role mapping',
  'GET /admin/ranks/discord-roles': 'List Discord rank-role mappings for a guild',
  'POST /admin/users/merge': 'Merge one user account into another',
  'PUT /attendance/{attendanceId}': 'Update an attendance record',
  'DELETE /attendance/{attendanceId}': 'Delete an attendance record',
  'GET /attendance/legacy-data': 'List legacy attendance data',
  'PUT /attendance/legacy-data': 'Update legacy attendance mappings',
  'POST /attendance/legacy-import': 'Import legacy attendance records',
  'POST /attendance/legacy-import/user-data': 'Import legacy attendance user data',
  'GET /attendance/legacy-import/user-data': 'List imported legacy attendance users',
  'PUT /attendance/legacy-import/user-data/map': 'Map a legacy attendance user',
  'POST /bot/attendance': 'Submit a bot attendance check-in or check-out',
  'POST /bot/attendance/backfill': 'Backfill pending bot attendance events',
  'GET /bot/orbats': 'List ORBATs for bot reconciliation',
  'GET /bot/orbats/{id}': 'Get an ORBAT for bot reconciliation',
  'POST /bot/training-reminders': 'Deliver due training reminders',
  'GET /bot/users': 'List users for bot reconciliation',
  'GET /bot/users/{userId}/rank-history': 'List a user’s rank history for the bot',
  'GET /bot/users/discord/{discordId}': 'Resolve a user by Discord ID',
  'GET /bot/users/steam/{steamId}': 'Resolve a user by Steam ID',
  'PUT /messaging/{id}/read': 'Mark a message as read',
  'PUT /messaging/read-all': 'Mark all messages as read',
  'GET /orbats/{id}/attendance-notes': 'List ORBAT availability notes',
  'POST /orbats/{id}/attendance-notes': 'Create or replace an ORBAT availability note',
  'PATCH /orbats/{id}/attendance-notes/{noteId}': 'Update an ORBAT availability note',
  'DELETE /orbats/{id}/attendance-notes/{noteId}': 'Delete an ORBAT availability note',
  'GET /orbats/{id}/eligibility': 'Get ORBAT slot eligibility',
  'GET /orbats/{id}/qualifications': 'List ORBAT qualification state',
  'PUT /orbats/{id}/qualifications': 'Update ORBAT qualification state',
  'POST /orbats/{id}/qualifications/assign': 'Assign an ORBAT qualification',
  'GET /orbats/{id}/signups': 'List ORBAT signups for the website',
  'GET /permissions/templates': 'List permission templates',
  'POST /permissions/templates': 'Create a permission template',
  'PUT /permissions/templates/{id}': 'Update a permission template',
  'DELETE /permissions/templates/{id}': 'Delete a permission template',
  'PUT /ranks/{id}': 'Update a rank',
  'POST /ranks/migrate/preview': 'Preview a rank migration',
  'PUT /ranks/reorder': 'Reorder ranks',
  'PATCH /signups/{id}/move': 'Move a signup to another slot',
  'POST /subslots/{id}/signup': 'Create a signup in a slot',
  'DELETE /subslots/{id}/signup': 'Remove a signup from a slot',
  'PUT /templates/{id}': 'Update an ORBAT template',
  'PUT /training-categories/{id}': 'Update a training category',
  'PUT /training-requests/{id}': 'Update a training request',
  'DELETE /training-requests/{id}': 'Cancel a training request',
  'GET /training-requests/{id}': 'Get a training request',
  'GET /training-requests/{id}/events': 'Stream training request events',
  'GET /training-requests/{id}/messages': 'List training request messages',
  'POST /training-requests/{id}/messages': 'Send a training request message',
  'PUT /training-requests/{id}/schedule': 'Schedule a training request',
  'GET /training-requests/{id}/subscription': 'Get a training chat subscription',
  'PUT /training-requests/{id}/subscription': 'Update a training chat subscription',
  'GET /training-sessions': 'List training sessions',
  'POST /training-sessions': 'Create a training session',
  'GET /training-sessions/{id}': 'Get a training session',
  'PUT /training-sessions/{id}': 'Update a training session',
  'POST /training-sessions/{id}/attendees': 'Add an attendee to a training session',
  'PUT /training-sessions/{id}/attendees/{attendeeId}': 'Update a training session attendee',
  'DELETE /training-sessions/{id}/attendees/{attendeeId}': 'Remove a training session attendee',
  'GET /training-staff': 'List eligible training staff',
  'GET /training-users': 'List users for training administration',
  'PUT /trainings/{id}': 'Update a training definition',
  'POST /trainings/{id}/requirements': 'Add a training rank requirement',
  'DELETE /trainings/{id}/requirements': 'Remove a training rank requirement',
  'POST /user-trainings': 'Create a user training record',
  'PUT /user-trainings/{id}': 'Update a user training record',
  'POST /user-trainings/bulk-status': 'Update multiple user training statuses',
  'POST /user/avatar/migrate': 'Migrate the current user’s legacy avatar',
  'POST /user/avatar/upload': 'Upload the current user’s avatar',
  'PATCH /users/{id}': 'Update a user profile',
  'PATCH /users/{id}/admin': 'Update a user’s legacy administrator state',
  'GET /users/me/notification-preferences': 'Get current-user notification preferences',
  'PATCH /users/me/notification-preferences': 'Update current-user notification preferences',
};

function inferTags(path) {
  const segments = path.split('/').filter(Boolean);
  const tags = [];
  if (segments[0] === 'admin') tags.push('Admin');
  if (segments[0] === 'bot') tags.push('Bot');

  const joined = segments.join('/');
  if (joined.includes('attendance')) tags.push('Attendance');
  else if (joined.includes('orbat') || joined.includes('signup') || joined.includes('subslot')) tags.push(joined.includes('signup') || joined.includes('subslot') ? 'Signups' : 'ORBATs');
  else if (joined.includes('training')) tags.push('Training');
  else if (joined.includes('rank')) tags.push('Ranks');
  else if (joined.includes('messaging') || joined.includes('notification')) tags.push('Messaging');
  else if (joined.includes('permission')) tags.push('Admin');
  else if (joined.includes('template')) tags.push('Templates');
  else if (joined.includes('user')) tags.push('Users');

  return [...new Set(tags.length ? tags : ['Admin'])];
}

function humanizePath(path) {
  return path
    .split('/')
    .filter((part) => part && part !== 'admin' && part !== 'bot')
    .map((part) => part.startsWith('{') ? part : part.replace(/-/g, ' '))
    .join(' ');
}

function inferSummary(path, method) {
  const key = `${method.toUpperCase()} ${path}`;
  if (SUMMARY_OVERRIDES[key]) return SUMMARY_OVERRIDES[key];
  const action = { get: 'Get', post: 'Create or execute', put: 'Update', patch: 'Update', delete: 'Delete', options: 'Inspect', head: 'Inspect' }[method] ?? 'Use';
  return `${action} ${humanizePath(path)}`;
}

function describeOperation(path, method, summary) {
  const auth = path.startsWith('/bot/')
    ? 'Requires an active database-backed bot bearer token.'
    : 'Uses the current website session and the route’s permission checks unless documented otherwise.';
  return `${summary}. ${auth} This description reflects the currently implemented route; broader response and error standardization is deferred.`;
}

function baselineOperation(path, method) {
  const summary = inferSummary(path, method);
  const operation = {
    tags: inferTags(path),
    summary,
    description: describeOperation(path, method, summary),
    responses: {
      '200': { description: 'Successful response from the current implementation.' },
    },
  };
  if (path.startsWith('/bot/')) operation.security = [{ apiKey: [] }];
  return operation;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (st.isFile() && entry === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

function toOpenApiPath(routeFile) {
  const rel = relative(apiRoot, routeFile);
  const routeRel = rel.split(sep).join('/').replace(/\/route\.ts$/, '');

  const segments = routeRel.split('/').map((part) => {
    if (part.startsWith('[...') && part.endsWith(']')) {
      return `{...${part.slice(4, -1)}}`;
    }
    if (part.startsWith('[') && part.endsWith(']')) {
      return `{${part.slice(1, -1)}}`;
    }
    return part;
  });

  return `/${segments.join('/')}`;
}

function getExportedMethods(routeFile) {
  const src = readFileSync(routeFile, 'utf8');
  const methodSet = new Set();
  const regex = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(/g;

  let match;
  while ((match = regex.exec(src)) !== null) {
    methodSet.add(match[1].toLowerCase());
  }

  return [...methodSet];
}

function ensurePathAndMethod(spec, path, method) {
  if (!spec.paths[path]) {
    spec.paths[path] = {};
  }

  if (!spec.paths[path][method]) {
    spec.paths[path][method] = baselineOperation(path, method);
    return 'added';
  }

  const operation = spec.paths[path][method];
  const isPlaceholder = operation?.tags?.includes('TODO') || String(operation?.summary ?? '').startsWith('TODO document');
  if (isPlaceholder) {
    const baseline = baselineOperation(path, method);
    spec.paths[path][method] = { ...operation, ...baseline, responses: operation.responses ?? baseline.responses };
    return 'documented';
  }

  return null;
}

function sortObjectKeys(obj) {
  return Object.keys(obj)
    .sort((a, b) => a.localeCompare(b))
    .reduce((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});
}

function main() {
  const routeFiles = walk(apiRoot);
  const spec = YAML.parse(readFileSync(openapiPath, 'utf8'));

  if (!spec.paths || typeof spec.paths !== 'object') {
    spec.paths = {};
  }

  let addedMethods = 0;
  let documentedMethods = 0;
  let discoveredRoutes = 0;

  for (const routeFile of routeFiles) {
    const path = toOpenApiPath(routeFile);
    const methods = getExportedMethods(routeFile);

    if (methods.length === 0) {
      continue;
    }

    discoveredRoutes++;

    for (const method of methods) {
      const result = ensurePathAndMethod(spec, path, method);
      if (result === 'added') addedMethods++;
      if (result === 'documented') documentedMethods++;
    }
  }

  spec.paths = sortObjectKeys(spec.paths);

  const nextYaml = YAML.stringify(spec, {
    indent: 2,
    lineWidth: 0,
  });

  writeFileSync(openapiPath, nextYaml, 'utf8');

  console.log(`Scanned ${routeFiles.length} route files (${discoveredRoutes} with handlers).`);
  console.log(`Added ${addedMethods} missing OpenAPI method stubs.`);
  console.log(`Replaced ${documentedMethods} TODO operation placeholders.`);
  console.log(`Updated ${openapiPath}`);
}

main();
