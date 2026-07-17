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
    spec.paths[path][method] = {
      tags: ['TODO'],
      summary: `TODO document ${method.toUpperCase()} ${path}`,
      responses: {
        '200': {
          description: 'Success',
        },
      },
    };
    return true;
  }

  return false;
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
  let discoveredRoutes = 0;

  for (const routeFile of routeFiles) {
    const path = toOpenApiPath(routeFile);
    const methods = getExportedMethods(routeFile);

    if (methods.length === 0) {
      continue;
    }

    discoveredRoutes++;

    for (const method of methods) {
      const added = ensurePathAndMethod(spec, path, method);
      if (added) {
        addedMethods++;
      }
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
  console.log(`Updated ${openapiPath}`);
}

main();
