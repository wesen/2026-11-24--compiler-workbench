// Normalize IR manipulation implementation source using the already installed TypeScript parser.
// This is a development utility; compilation never depends on running it.
import {readdir,readFile,writeFile} from 'node:fs/promises';
import ts from 'typescript';

for(const directory of ['src/ir','src/ir-examples']) {
  for(const name of (await readdir(directory)).sort()) {
    if(!name.endsWith('.ts'))continue;
    const path=`${directory}/${name}`,source=await readFile(path,'utf8');
    const tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
    if(tree.parseDiagnostics.length)throw new Error(`Refusing to format malformed source: ${path}`);
    const result=ts.transform(tree,[context=>{
      const preserve=(next,original)=>ts.setTextRange(ts.setOriginalNode(next,original),original);
      const visit=node=>{
        const changed=ts.visitEachChild(node,visit,context);
        if(ts.isBlock(changed))return preserve(ts.factory.createBlock(changed.statements,true),node);
        if(ts.isObjectLiteralExpression(changed)&&changed.properties.length>1)
          return preserve(ts.factory.createObjectLiteralExpression(changed.properties,true),node);
        return changed;
      };
      return node=>ts.visitNode(node,visit);
    }]);
    let output=ts.createPrinter({newLine:ts.NewLineKind.LineFeed,removeComments:false}).printFile(result.transformed[0]);
    output=output.replace(/^import (type )?\{ ([^\n]+) \} from ([^\n]+);$/gm,(line,type,names,module)=>
      line.length>150?`import ${type??''}{\n${names.split(', ').map(n=>`    ${n}`).join(',\n')}\n} from ${module};`:line);
    result.dispose();
    await writeFile(path,output);
  }
}
