import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

export interface SourceFileRecord { path: string; text: string }
export interface SourceLocation { path: string; line: number; endLine: number }
export interface DefinitionLocation extends SourceLocation { id:string;version:string;kind:string }
export interface SourceCatalog {
  files: SourceFileRecord[];
  passes: Record<string, SourceLocation>;
  /** Definition keys include their category and exact version. No guessed code locations. */
  definitions?: Record<string, DefinitionLocation>;
}

/** Build-time index of the actual TypeScript sources, not emitted JS or Function.toString(). */
export async function collectSources(root: string): Promise<SourceCatalog> {
  const files: SourceFileRecord[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of (await readdir(resolve(root, dir), { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.(ts|mjs|md)$/.test(entry.name)) files.push({ path, text: await readFile(resolve(root,path),'utf8') });
    }
  }
  await walk('src');
  await walk('tests');
  const passes: Record<string,SourceLocation> = Object.create(null);
  const definitions: Record<string,DefinitionLocation> = Object.create(null);
  function ids(expression: ts.Expression): string[] {
    if (ts.isStringLiteralLike(expression)) return [expression.text];
    // The physics backend registers both solvers from a single conditional descriptor.
    if (ts.isConditionalExpression(expression)) return [...ids(expression.whenTrue),...ids(expression.whenFalse)];
    return [];
  }
  for (const file of files.filter(f=>f.path.startsWith('src/')&&f.path.endsWith('.ts'))) {
    const tree=ts.createSourceFile(file.path,file.text,ts.ScriptTarget.Latest,true);
    function visit(node: ts.Node): void {
      if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&/^(define(IR|Type|Property|Analysis|Transformation|Invariant|Objective|Effect|Adapter)|rewrite)$/.test(node.expression.text)) {
        const arg=node.arguments[0];
        if(arg&&ts.isObjectLiteralExpression(arg)) {
          const literal=(name:string)=>{
            const prop=arg.properties.find((p):p is ts.PropertyAssignment=>ts.isPropertyAssignment(p)&&(ts.isIdentifier(p.name)||ts.isStringLiteralLike(p.name))&&p.name.text===name);
            return prop&&ts.isStringLiteralLike(prop.initializer)?prop.initializer.text:undefined;
          };
          const id=literal('id'),version=literal('version'),kind=node.expression.text==='rewrite'?'rewrite':node.expression.text.slice(6).toLowerCase();
          if(id&&version){
            const key=`${kind}:${id}@${version}`;
            // Test fixtures are not indexed; definitions remain actual source declarations.
            if(definitions[key])throw new Error(`Ambiguous source definition for ${key}`);
            definitions[key]={id,version,kind,path:file.path,line:tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1,endLine:tree.getLineAndCharacterOfPosition(node.getEnd()-1).line+1};
          }
        }
      }
      if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='register') {
        const arg=node.arguments[0];
        if(arg&&ts.isObjectLiteralExpression(arg)) {
          const prop=arg.properties.find((p):p is ts.PropertyAssignment=>ts.isPropertyAssignment(p)&&(ts.isIdentifier(p.name)||ts.isStringLiteralLike(p.name))&&p.name.text==='id');
          if(prop)for(const id of ids(prop.initializer)) {
            if(passes[id])throw new Error(`Ambiguous source registration for ${id}`);
            passes[id]={path:file.path,line:tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1,endLine:tree.getLineAndCharacterOfPosition(node.getEnd()-1).line+1};
          }
        }
      }
      ts.forEachChild(node,visit);
    }
    visit(tree);
  }
  return {files,passes,definitions};
}
