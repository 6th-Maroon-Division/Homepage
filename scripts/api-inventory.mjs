#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  // This known delegate has a migrated public GET alongside the legacy POST.
  // Require its exact file, named import, and single-return GET body; do not
  // generalize a helper-name mention into method migration certification.
  const knownPublicListGet = rel(file) === 'app/api/orbats/route.ts'
    && ast.statements.some(node => ts.isImportDeclaration(node)
      && node.moduleSpecifier.text === '@/lib/api/orbat-list'
      && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
      && node.importClause.namedBindings.elements.some(element => element.name.text === 'getPublicOrbatList' && (!element.propertyName || element.propertyName.text === 'getPublicOrbatList')))
    && ast.statements.some(node => ts.isFunctionDeclaration(node) && node.name?.text === 'GET'
      && node.body?.statements.length === 1 && ts.isReturnStatement(node.body.statements[0])
      && node.body.statements[0].expression && ts.isCallExpression(node.body.statements[0].expression)
      && node.body.statements[0].expression.expression.getText(ast) === 'getPublicOrbatList');
  const auth = [
    knownPublicListGet && 'GET: explicit anonymous access (known public delegate); POST: inspect existing checks',
    /handlePublicApiRequest\s*\(/.test(source) && 'explicit anonymous access (public handler)',
    /getServerSession|requireAuth|withAuth|handleApiRequest/.test(source) && 'session',
    /validateBotToken|authenticateDatabaseBot|handleApiRequest/.test(source) && 'bot token',
    /checkPermission|requirePermission|withPermission|handleApiRequest|canAccessApiUser/.test(source) && 'permission check',
    /NextAuth\(|openid|steamcommunity/.test(source) && 'auth flow',
  ].filter(Boolean).join(', ') || 'inspect (no direct auth marker)';
  const style = [knownPublicListGet && 'GET: data/meta and structured errors', /botError\(|apiError\(|handle(?:Public)?ApiRequest/.test(source) && 'structured error', source.includes('apiSuccess(') && 'data/meta envelope', /error:\s*['"`]/.test(source) && 'string error', /text\/event-stream|createBotEventStream/.test(source) && 'SSE', /NextResponse.redirect/.test(source) && 'redirect'].filter(Boolean).join(', ') || 'inspect';
  const migration = knownPublicListGet ? 'GET: public delegate migrated; POST: pending' : /handlePublicApiRequest\s*\(/.test(source) ? 'Shared public handler (migrated)' : /handleApiRequest\s*\(/.test(source) ? 'Shared handler (migrated)' : 'Pending migration / transport review';
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
  'Migration status is a route-level source marker: “Shared handler (migrated)” means the file calls `handleApiRequest`; “Shared public handler (migrated)” means it calls `handlePublicApiRequest`, explicitly supporting anonymous access for that operation. The known ORBAT list delegate is labeled separately as migrated public GET with pending POST. A file can contain partially migrated methods. These markers do not certify every method, permission, audit requirement, or test case; session imports do not establish that all operations require authentication. Test references are not per-method coverage. See [testing](./testing.md) for the current automated coverage scope and [public-access review](./public-access-review.md) for confirmed public flows.', '',
  '| Route and source | Methods | Migration status | Application/script references | Test references | Docs/Bruno references | Auth markers | Response markers | OpenAPI |',
  '|---|---|---|---|---|---|---|---|---|',
  ...routes.map(route => `| [\`${route.path}\`](../../${route.file}) | ${route.methods.join(', ')} | ${route.migration} | ${links(route.refs)} | ${links(route.tests)} | ${links(route.docs)} | ${route.auth} | ${route.style} | ${coverage(route)} |`), '',
  '## Missing OpenAPI operations', '', ...missing.map(operation => `- \`${operation}\``), '',
  '## OpenAPI operations without matching exported handlers', '',
  'These specification entries need review; a documentation entry alone does not prove the operation exists.', '',
  ...stale.map(operation => `- \`${operation}\``), '',
].join('\n');
writeFileSync(resolve(root, 'docs/api/inventory.md'), output);
console.log(`${routes.length} routes, ${operations} handlers, ${referenced} routes referenced by application/scripts, ${missing.length} OpenAPI gaps.`);
