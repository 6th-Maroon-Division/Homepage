import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import ts from 'typescript';
import YAML from 'yaml';
const root = process.cwd();
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(resolve(directory, entry.name)) : [resolve(directory, entry.name)]);
const verbs = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);
const imports = new Map();
for (const file of walk(resolve(root,'tests')).filter(file => /\.[cm]?tsx?$/.test(file))) {
  const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  for(const node of ast.statements)if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)) {
    const source=node.moduleSpecifier.text;
    const target=source.startsWith('@/')?resolve(root,source.slice(2)):source.startsWith('.')?resolve(dirname(file),source):null;
    if(!target)continue;
    const key=target.replace(/\.tsx?$/,''); const names=imports.get(key)??new Set();
    const bindings=node.importClause?.namedBindings;
    if(bindings&&ts.isNamedImports(bindings))for(const item of bindings.elements)names.add(item.propertyName?.text??item.name.text);
    if(bindings&&ts.isNamespaceImport(bindings))names.add('*');
    imports.set(key,names);
  }
}
const routes=new Map(); const errors=[];
for(const file of walk(resolve(root,'app/api')).filter(file=>file.endsWith('/route.ts'))) {
  const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);const methods=new Set();
  for(const node of ast.statements){
    if(ts.isFunctionDeclaration(node)&&node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)&&verbs.has(node.name?.text))methods.add(node.name.text);
    if(ts.isVariableStatement(node)&&node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))for(const item of node.declarationList.declarations)if(verbs.has(item.name.getText(ast)))methods.add(item.name.getText(ast));
    if(ts.isExportDeclaration(node)&&node.exportClause&&ts.isNamedExports(node.exportClause))for(const item of node.exportClause.elements)if(verbs.has(item.name.text))methods.add(item.name.text);
  }
  const path='/'+relative(resolve(root,'app/api'),file).replaceAll('\\','/').replace(/\/route.ts$/,'').replace(/\[([^\]]+)\]/g,'{$1}');routes.set(path,methods);
  const evidence=imports.get(file.replace(/\.ts$/,''));
  for(const method of methods)if(!evidence?.has(method)&&!evidence?.has('*'))errors.push(`No direct test import for ${method} ${path}`);
}
const spec=YAML.parse(readFileSync(resolve(root,'openapi.yaml'),'utf8'));
for(const [path,methods] of routes)for(const method of methods){
 const operation=spec.paths?.[path]?.[method.toLowerCase()];
 if(!operation)errors.push(`Missing contract: ${method} ${path}`);
 else if(/TODO/i.test(operation.summary??'')||operation.tags?.includes('TODO'))errors.push(`Unfinished contract: ${method} ${path}`);
}
for(const [path,operations]of Object.entries(spec.paths??{}))for(const method of Object.keys(operations))if(verbs.has(method.toUpperCase())&&!routes.get(path)?.has(method.toUpperCase()))errors.push(`Stale contract: ${method.toUpperCase()} ${path}`);
function refs(value){if(!value||typeof value!=='object')return;if(value.$ref?.startsWith('#/')){let target=spec;for(const key of value.$ref.slice(2).split('/'))target=target?.[key.replaceAll('~1','/').replaceAll('~0','~')];if(target===undefined)errors.push(`Unresolved reference: ${value.$ref}`)}for(const child of Object.values(value))refs(child)}refs(spec);
if(errors.length){console.error([...new Set(errors)].join('\n'));process.exitCode=1}else console.log(`${routes.size} routes and ${[...routes.values()].reduce((n,methods)=>n+methods.size,0)} methods match OpenAPI and have direct test imports. This static check supplements behavioral tests.`);
