#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import YAML from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(resolve(dir, entry.name)) : [resolve(dir, entry.name)]);
const rel = file => relative(root, file).replaceAll('\\', '/');
const spec = YAML.parse(readFileSync(resolve(root, 'openapi.yaml'), 'utf8'));
// Follow named local calls to a shared wrapper. These are per-method source
// markers, not proof of authorization, branch reachability, or test coverage.
const moduleCache = new Map();
function moduleInfo(file) {
  if (moduleCache.has(file)) return moduleCache.get(file);
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const imports = new Map(); const functions = new Map();
  for (const node of ast.statements) {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const entry of node.importClause.namedBindings.elements) imports.set(entry.name.text, [node.moduleSpecifier.text, entry.propertyName?.text ?? entry.name.text]);
    }
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
    if (ts.isVariableStatement(node)) for (const entry of node.declarationList.declarations) if (entry.initializer) functions.set(entry.name.getText(ast), entry.initializer);
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) for (const entry of node.exportClause.elements) {
      if (node.moduleSpecifier) imports.set(entry.name.text, [node.moduleSpecifier.text, entry.propertyName?.text ?? entry.name.text]);
      else functions.set(entry.name.text, entry.propertyName ?? entry.name);
    }
  }
  const result = { imports, functions }; moduleCache.set(file, result); return result;
}
function handlerKinds(file, name, visited = new Set()) {
  const key = file + ':' + name; if (visited.has(key)) return new Set(); visited.add(key);
  const { imports, functions } = moduleInfo(file); const result = new Set();
  const imported = imports.get(name);
  if (imported) {
    const [path, original] = imported;
    const target = path.startsWith('@/') ? resolve(root, path.slice(2)) : path.startsWith('.') ? resolve(dirname(file), path) : null;
    if (!target) return result;
    if (target === resolve(root, 'lib/api/handler')) {
      if (original === 'handleApiRequest') result.add('protected');
      if (original === 'handlePublicApiRequest') result.add('public');
      return result;
    }
    const resolved = [target + '.ts', target + '.tsx', resolve(target, 'index.ts')].find(existsSync);
    return resolved ? handlerKinds(resolved, original, visited) : result;
  }
  const body = functions.get(name); if (!body) return result;
  const add = called => { for (const kind of handlerKinds(file, called, visited)) result.add(kind); };
  if (ts.isIdentifier(body)) add(body.text);
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) add(node.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(body); return result;
}
const routes = walk(resolve(root, 'app/api')).filter(file => file.endsWith('/route.ts')).sort().map(file => {
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const exported = new Set();
  for (const node of ast.statements) {
    if (ts.isFunctionDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && methods.has(node.name?.text)) exported.add(node.name.text);
    if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) if (methods.has(declaration.name.getText(ast))) exported.add(declaration.name.getText(ast));
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) if (methods.has(element.name.text)) exported.add(element.name.text);
    }
  }
  const path = '/' + rel(file).replace(/^app\//, '').replace(/\/route.ts$/, '').replace(/\[([^\]]+)\]/g, '{$1}');
  const pattern = '^' + path.split('/').map(part => part.startsWith('{...') ? '.+' : part.startsWith('{') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/') + '$';
  const authProtocol = ['/api/auth/{...nextauth}', '/api/auth/steam-login', '/api/auth/steam-callback'].includes(path);
  const methodKinds = [...exported].sort().map(method => [method, handlerKinds(file, method)]);
  const auth = methodKinds.map(([method, kinds]) => `${method}: ${authProtocol ? 'browser authentication protocol' : kinds.has('public') ? 'explicit anonymous/session/bot' : kinds.has('protected') ? 'session/bot with permission review' : 'inspect transport/legacy auth'}`).join('; ');
  const style = [/botError\(|apiError\(|handle(?:Public)?ApiRequest/.test(source) && 'structured error', source.includes('apiSuccess(') && 'data/meta envelope', /error:\s*['"`]/.test(source) && 'string error', /text\/event-stream|createBotEventStream/.test(source) && 'SSE', /NextResponse.redirect/.test(source) && 'redirect'].filter(Boolean).join(', ') || 'inspect delegate';
  const migration = methodKinds.map(([method, kinds]) => `${method}: ${authProtocol ? 'authentication protocol exception (see auth tests)' : kinds.size ? [...kinds].sort().join('/') + ' shared handler' : 'pending migration / transport review'}`).join('; ');
  return { file: rel(file), path, regex: new RegExp(pattern), methods: [...exported].sort(), auth, style, migration, refs: new Set(), docs: new Set(), tests: new Set() };
});

function record(value, file, line, kind) {
  // Template interpolations stand for a single path segment. Dynamic suffixes
  // and URLs assembled from variables require manual review.
  const urls = value.match(/\/api\/[^\s'"`<>)]*/g) ?? [];
  for (const url of urls) {
    const path = url.split(/[?#]/)[0].replace(/\/route$/, '').replace(/\/$/, '');
    const matches = routes.filter(route => route.regex.test(path));
    const exact = matches.find(route => route.path === path);
    for (const route of exact ? [exact] : matches) route[kind].add(`${rel(file)}:${line}`);
  }
}
for (const folder of ['app', 'lib', 'tests', 'scripts']) {
  for (const file of walk(resolve(root, folder)).filter(file => /\.(tsx?|mjs|js)$/.test(file))) {
    if (rel(file).startsWith('app/api/') || file === fileURLToPath(import.meta.url)) continue;
    const source = readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = node => {
      // Module specifiers are code dependencies, not calls. Tests importing a
      // handler remain useful evidence and are deliberately retained.
      if (folder !== 'tests' && (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))) return;
      let value;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) value = node.text;
      if (ts.isTemplateExpression(node)) value = node.head.text + node.templateSpans.map(span => '__dynamic__' + span.literal.text).join('');
      if (value) record(value, file, ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, folder === 'tests' ? 'tests' : 'refs');
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
}
for (const folder of ['docs', 'bruno']) {
  for (const file of walk(resolve(root, folder)).filter(file => /\.(md|bru)$/.test(file) && !rel(file).startsWith('docs/api/'))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => record(line.replace(/\{\{[^}]+\}\}/g, '__variable__'), file, index + 1, 'docs'));
  }
}
const links = values => [...values].sort().map(value => {
  const [file, line] = value.split(':');
  return `[${file}:${line}](../../${file}#L${line})`;
}).join('<br>') || '—';
const coverage = route => route.methods.map(method => {
  const operation = spec.paths?.[route.path.replace(/^\/api/, '')]?.[method.toLowerCase()];
  return `${method}: ${!operation ? 'missing' : /TODO/i.test(operation.summary ?? '') || operation.tags?.includes('TODO') ? 'stub' : 'documented'}`;
}).join('<br>');
const referenced = routes.filter(route => route.refs.size).length;
const operations = routes.reduce((total, route) => total + route.methods.length, 0);
const missing = routes.flatMap(route => route.methods.filter(method => !spec.paths?.[route.path.replace(/^\/api/, '')]?.[method.toLowerCase()]).map(method => `${method} ${route.path}`));
const stale = Object.entries(spec.paths ?? {}).flatMap(([path, operations]) =>
  Object.keys(operations).filter(method => methods.has(method.toUpperCase()) &&
    !routes.some(route => route.path === `/api${path}` && route.methods.includes(method.toUpperCase())))
    .map(method => `${method.toUpperCase()} /api${path}`));
const output = [
  '# API route inventory', '',
  'Generated by `npm run api:inventory`. Do not edit the table by hand.', '',
  `${routes.length} route files; ${operations} exported HTTP handlers; ${referenced} routes with application/script URL references; ${routes.length - referenced} without such references. ${missing.length} handlers missing from OpenAPI.`, '',
  'This is static evidence, not production traffic. URL references are route-level candidates, not proof that every method is called. They include fetch URLs, EventSource URLs, and URLs assigned to variables. Framework-generated auth calls, dynamic URL fragments, external clients, relative documentation paths, and indirect calls can be missed. Dynamic segments can match more than one route. Documentation/test references are not live consumers. Auth/error columns are source markers, not security certification. “Documented” means an operation entry exists without a TODO marker, not that its schema is complete or correct. Do not delete routes based on this report.', '',
  'Migration status follows each exported HTTP method through named local calls to the shared protected/public wrappers. These are static source markers, not certification of every branch, permission, audit requirement, or test case. Public and protected methods on one URL are reported separately. Test references are not per-method coverage. See [testing](./testing.md) and [public-access review](./public-access-review.md).', '',
  '| Route and source | Methods | Migration status | Application/script references | Test references | Docs/Bruno references | Auth markers | Response markers | OpenAPI |',
  '|---|---|---|---|---|---|---|---|---|',
  ...routes.map(route => `| [\`${route.path}\`](../../${route.file}) | ${route.methods.join(', ')} | ${route.migration} | ${links(route.refs)} | ${links(route.tests)} | ${links(route.docs)} | ${route.auth} | ${route.style} | ${coverage(route)} |`), '',
  '## Missing OpenAPI operations', '', ...(missing.length ? missing.map(operation => `- \`${operation}\``) : ['None.']), '',
  '## OpenAPI operations without matching exported handlers', '',
  'These specification entries need review; a documentation entry alone does not prove the operation exists.', '',
  ...(stale.length ? stale.map(operation => `- \`${operation}\``) : ['None.']), '',
].join('\n');
writeFileSync(resolve(root, 'docs/api/inventory.md'), output.trimEnd() + '\n');
console.log(`${routes.length} routes, ${operations} handlers, ${referenced} routes referenced by application/scripts, ${missing.length} OpenAPI gaps.`);
