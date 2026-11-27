import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]))).flat();
}

test('stdlib does not depend on framework or language domains', async () => {
  const root = path.resolve('src');
  for (const file of await files(path.join(root, 'stdlib'))) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      let specifier;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) specifier = node.moduleSpecifier;
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) specifier = node.moduleReference.expression;
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) specifier = node.arguments[0];
      if (specifier && ts.isStringLiteralLike(specifier)) {
        const target = specifier.text.startsWith('.') ? path.resolve(path.dirname(file), specifier.text) : path.resolve(root, specifier.text.replace(/^src\//, ''));
        for (const forbidden of ['framework', 'typed', 'tensor']) {
          const dir = path.join(root, forbidden);
          assert.ok(target !== dir && !target.startsWith(dir + path.sep), `${file} imports ${specifier.text}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});
