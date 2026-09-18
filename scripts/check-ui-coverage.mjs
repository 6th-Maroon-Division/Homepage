import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}
const pages = (await files(resolve(root, 'app'))).filter(path => /[/\\]page\.(tsx?|jsx?)$/.test(path)).map(path => {
  const parts = relative(resolve(root, 'app'), path).split(sep).slice(0, -1).filter(part => !part.startsWith('(') && !part.startsWith('@'));
  return `/${parts.join('/')}`;
});
const declarations = new Map();
for (const path of (await files(resolve(root, 'tests/ui'))).filter(path => path.endsWith('.spec.ts'))) {
  const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(source) !== 'coveredPages' || !declaration.initializer) continue;
      const array = ts.isAsExpression(declaration.initializer) ? declaration.initializer.expression : declaration.initializer;
      if (!ts.isArrayLiteralExpression(array) || array.elements.some(element => !ts.isStringLiteral(element))) throw new Error(`${path}: coveredPages must contain literal route patterns.`);
      for (const element of array.elements) declarations.set(element.text, relative(root, path));
    }
  }
}
const missing = pages.filter(page => !declarations.has(page));
const stale = [...declarations.keys()].filter(page => !pages.includes(page));
if (missing.length || stale.length) {
  if (missing.length) console.error(`Pages missing browser coverage declarations: ${missing.join(', ')}`);
  if (stale.length) console.error(`Stale browser page declarations: ${stale.join(', ')}`);
  process.exitCode = 1;
} else console.log(`${pages.length} page routes have browser coverage declarations. Behavioral coverage is verified by test:ui; this is not a code-coverage percentage.`);
