import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import ts from 'typescript';
import {evaluateModules} from '../dist/source-workbench/evaluate.js';
import {createSourceCompiler,compileProgram} from '../dist/pipelines/project.js';
const output=resolve('output/source-experiments');await mkdir(output,{recursive:true});
const sources=Object.fromEntries(await Promise.all((await readdir('src/programs')).filter(f=>f.endsWith('.ts')).map(async f=>[f,await readFile(`src/programs/${f}`,'utf8')])));
const compiler=createSourceCompiler(),runs=[],sourceSnapshots={};
async function execute(entry,label,files=sources,expectedFailure=false){
  const program=evaluateModules(ts,files,entry);let artifact,error;
  try{artifact=(await compileProgram(compiler,program,label,`programs/${entry.slice(0,-3)}`)).value;}catch(e){error=e instanceof Error?e.message:String(e);if(!expectedFailure)throw e;}
  if(expectedFailure&&!error)throw new Error('Expected source compilation to fail');
  const db=compiler.snapshot(),r=db.runs.at(-1),calls=db.invocations.filter(i=>i.runId===r.id);
  const info={entry,label,run:r.id,status:r.status,executed:calls.filter(i=>i.status==='executed').length,cached:calls.filter(i=>i.status==='cached').length,failed:calls.filter(i=>i.status==='failed').length,artifact:artifact?{id:artifact.id,kind:artifact.kind,revision:artifact.revision}:null,...(error?{error}:{})};runs.push(info);sourceSnapshots[r.id]={entry,files};
  if(artifact)await writeFile(`${output}/${r.id}-artifact.json`,JSON.stringify(artifact,null,2));
  console.log(`${label}: ${info.executed} executed, ${info.cached} reused, ${info.failed} failed`);
  return artifact;
}
const edit=(file,a,b)=>({...sources,[file]:sources[file].replace(a,b)});
const building=await execute('building.ts','Building · original');
await execute('building.ts','Building · unchanged');
await execute('building.ts','Building · appearance',edit('building.ts','#c6a574','#657789'));
await execute('building.ts','Building · quality',edit('building.ts',"'triangles', 0.006","'quality', 0.006"));
await execute('building.ts','Building · third floor',edit('building.ts','floors = 2','floors = 3'));
await execute('building.ts','Building · new chimney',edit('building.ts',".instance('roof','roof'", ".define('chimney', box(.4,.4,1), 'masonry')\n  .instance('chimney:0','chimney',[3,2,5.8])\n  .instance('roof','roof'"));
const restored=await execute('building.ts','Building · restore original');if(restored.revision!==building.revision)throw new Error('Reproduction failed');
await execute('pavilion.ts','Pavilion · same scene compiler');
await execute('bracket.ts','Bracket · original');
await execute('bracket.ts','Bracket · larger bore',edit('bracket.ts','bore = 0.012','bore = 0.016'));
await execute('bracket.ts','Bracket · unsupported hole location',edit('bracket.ts','[w/4, (d-t)/2]','[w/3, (d-t)/2]'),true);
await execute('linkage.ts','Linkage · original');
await execute('linkage.ts','Linkage · fewer samples',edit('linkage.ts',', 4, 65)',', 4, 33)'));
await execute('door.ts','Door · imported bracket and linkage');
await execute('door.ts','Door · change imported bracket',edit('bracket.ts','bore = 0.012','bore = 0.016'));
await execute('door.ts','Door · change imported motion',edit('linkage.ts',', 4, 65)',', 4, 33)'));
await writeFile(`${output}/summary.json`,JSON.stringify({runs,restoredOriginalRevision:true},null,2));
await writeFile(`${output}/trace.json`,JSON.stringify(compiler.snapshot()));
await writeFile(`${output}/source-snapshots.json`,JSON.stringify(sourceSnapshots,null,2));
