import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createProject,compileProject,defaultInputs,projectTasks,type ProjectArtifacts} from './project.js';
import {collectSources} from '../workbench/source-catalog.js';
import {renderWorkbenchHtml} from '../workbench/shell.js';
import type {DatabaseSnapshot} from '../core/records.js';
import type {CompilationRun} from '../core/runtime.js';
import type {Artifact} from '../core/types.js';
import type {Mesh} from '../geometry/mesh.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
interface Scenario {label:string;purpose:string;changes?:Record<string,unknown>;expectedFailure?:boolean;evict?:string}
const scenarios:Scenario[]=[
  {label:'Baseline - cold build',purpose:'Execute all four examples through their actual IR chains.'},
  {label:'Unchanged - warm cache',purpose:'Verify dependency manifests and reuse every task.'},
  {label:'CAD - enlarge mounting holes',purpose:'Change bore geometry while keeping sketch, uncut features and mechanism attachment coordinates.',changes:{'cad.holeDiameter':.016}},
  {label:'CAD - refine tessellation',purpose:'Change only the approximation level; retain analytic geometry and mechanisms.',changes:{'cad.segments':64}},
  {label:'Game - prefer geometric quality',purpose:'Reconsider cached LOD alternatives under a different optimization objective.',changes:{'game.objective':'quality'}},
  {label:'Game - change material',purpose:'Update appearance without rebuilding geometry or LOD candidates.',changes:{'game.material':'slate'}},
  {label:'Physics - change numerical seed',purpose:'Invalidate numerical continuation while retaining the independent closed-form solver.',changes:{'physics.initial':{bx:.72,by:.66}}},
  {label:'Door - move support origin',purpose:'Propagate a port-connected assembly edit into constraints, motion and asset transforms.',changes:{'door.supportSpacing':1.22}},
  {label:'Door - resize leaf',purpose:'Change render and collision geometry without modifying mechanical link constraints.',changes:{'door.height':2.05}},
  {label:'Failure - oversized mounting holes',purpose:'Retain an inspectable failure instead of publishing an invalid bracket or door.',changes:{'cad.holeDiameter':.2},expectedFailure:true},
  {label:'Recovery - restore baseline inputs',purpose:'Reuse earlier valid cache variants after restoring the exact declared context.',changes:defaultInputs()},
  {label:'Eviction - rebuild one mesh',purpose:'Explain loss of a cache entry separately from semantic invalidation.',evict:'cad/mesh'}
];

function counts(snapshot:DatabaseSnapshot,runId:string) {
  const invocations=snapshot.invocations.filter(i=>i.runId===runId);
  return {executed:invocations.filter(i=>i.status==='executed').length,cached:invocations.filter(i=>i.status==='cached').length,failed:invocations.filter(i=>i.status==='failed').length,total:invocations.length};
}
function summarizeOutputs(artifacts:ProjectArtifacts) {
  return Object.fromEntries(Object.entries(artifacts).map(([name,artifact])=>[name,{id:artifact.id,kind:artifact.kind,revision:artifact.revision,contentHash:artifact.contentHash}]));
}

async function main():Promise<void> {
  const args=process.argv.slice(2);let output=resolve(root,'output');const custom:Record<string,unknown>={};let customMode=false;
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(arg==='--out'){if(!args[i+1])throw new Error('--out requires a directory');output=resolve(args[++i]);}
    else if(arg==='--inputs'){if(!args[i+1])throw new Error('--inputs requires a JSON file');const input=JSON.parse(await readFile(resolve(args[++i]),'utf8'));if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Input configuration must be a record');Object.assign(custom,input);customMode=true;}
    else if(arg==='--set') {const assignment=args[++i];if(!assignment||!assignment.includes('='))throw new Error('--set expects key=JSON');const split=assignment.indexOf('='),key=assignment.slice(0,split),raw=assignment.slice(split+1);if(!Object.hasOwn(defaultInputs(),key))throw new Error(`Unknown input ${key}`);try{custom[key]=JSON.parse(raw);}catch{custom[key]=raw;}customMode=true;}
    else if(arg==='--help'){console.log('node dist/examples/run.js [--out directory] [--inputs config.json] [--set key=JSON]');return;}
    else throw new Error(`Unknown option ${arg}`);
  }
  for(const key of Object.keys(custom))if(!Object.hasOwn(defaultInputs(),key))throw new Error(`Unknown input ${key}`);
  await mkdir(output,{recursive:true});await mkdir(resolve(output,'assets'),{recursive:true});await mkdir(resolve(output,'queries'),{recursive:true});
  const compiler=createProject();const results:unknown[]=[];let baseline:ProjectArtifacts|undefined;let last:ProjectArtifacts|undefined;let lastCadMesh:Artifact<Mesh>|undefined;let baselineRun:CompilationRun|undefined;
  const toRun=customMode?[scenarios[0],{label:'Custom inputs',purpose:'Compile the supplied explicit source configuration.',changes:custom}]:scenarios;
  let customFailed=false;
  for(const scenario of toRun) {
    if(scenario.changes)compiler.setInputs(scenario.changes);if(scenario.evict)compiler.evict(scenario.evict);
    let error:string|undefined,run:CompilationRun|undefined,artifacts:ProjectArtifacts|undefined;
    try {const result=await compileProject(compiler,scenario.label);run=result.run;artifacts=result.artifacts;last=artifacts;lastCadMesh=run.query.artifact(projectTasks().cad.mesh.id) as Artifact<Mesh>;if(!baseline){baseline=artifacts;baselineRun=run;}}
    catch(e){error=e instanceof Error?e.message:String(e);if(!scenario.expectedFailure){if(customMode)customFailed=true;else throw e;}}
    if(scenario.expectedFailure && artifacts)throw new Error('Expected invalid scenario unexpectedly succeeded');
    const snapshot=compiler.snapshot(),record=run?.record??snapshot.runs.at(-1)!;
    const summary={runId:record.id,label:record.label,purpose:scenario.purpose,status:record.status,counts:counts(snapshot,record.id),wallTimeMs:(record.endedAt??record.startedAt)-record.startedAt,changes:scenario.changes??{},...(error?{error}:{}),...(artifacts?{outputs:summarizeOutputs(artifacts)}:{})};results.push(summary);
    console.log(`${record.id}: ${record.label}: ${record.status} (${summary.counts.executed} executed, ${summary.counts.cached} cached, ${summary.counts.failed} failed)`);
    if(scenario.label==='CAD - enlarge mounting holes')await writeFile(resolve(output,'queries/hole-edit.json'),JSON.stringify({cad:run!.why('cad/mesh'),mechanism:run!.why('door.motion/selected'),comparison:run!.compare(baselineRun!)},null,2));
    if(scenario.label==='Game - prefer geometric quality')await writeFile(resolve(output,'queries/optimization.json'),JSON.stringify({choice:run!.alternatives('game/package'),cache:run!.explainCache('game/lod/4'),comparison:run!.compare(baselineRun!)},null,2));
  }
  if(!baseline||!last)throw new Error('No successful artifacts were generated');
  const replay=await compileProject(createProject(),'Independent baseline reproduction');
  const reproduced=Object.keys(baseline).every(name=>baseline![name as keyof ProjectArtifacts].revision===replay.artifacts[name as keyof ProjectArtifacts].revision);
  if(!reproduced)throw new Error('Fresh-runtime artifact reproduction failed');
  const snapshot=compiler.snapshot();const firstRun=snapshot.runs[0];
  const physicsNumeric=snapshot.artifacts.find(a=>a.id==='physics/numeric')!.value as {metrics:unknown};
  const summary={formatVersion:1,implementation:'ir-workbench/0.1.0',generatedAt:new Date().toISOString(),runtime:process.version,
    reproduction:{freshRuntime:true,identicalBaselineRevisions:reproduced,scope:'Artifact values and revisions; excludes execution IDs, timings and wall-clock timestamps'},
    scenarios:results,baseline:{inputs:firstRun.inputs,outputs:summarizeOutputs(baseline),cad:baseline.cad.value,game:baseline.game.value.metrics,physicsNumeric:physicsNumeric.metrics,physicsSelected:baseline.physics.value.metrics,door:{...baseline.door.value.metrics,definitions:baseline.door.value.definitions.length,occurrences:baseline.door.value.occurrences.length,samples:baseline.door.value.animation.samples.length,colliders:baseline.door.value.collision.colliders.length}},
    totals:{runs:snapshot.runs.length,invocations:snapshot.invocations.length,artifactRevisions:snapshot.artifacts.length,derivations:snapshot.derivations.length,passVersions:snapshot.passes.length,irKinds:snapshot.kinds.length}};
  await writeFile(resolve(output,'summary.json'),JSON.stringify(summary,null,2));await writeFile(resolve(output,'trace.json'),JSON.stringify(snapshot));
  await writeFile(resolve(output,'assets/bracket.mesh.json'),JSON.stringify(lastCadMesh!.value,null,2));
  await writeFile(resolve(output,'assets/building.scene.json'),JSON.stringify(last.game.value,null,2));
  await writeFile(resolve(output,'assets/linkage.motion.json'),JSON.stringify(last.physics.value,null,2));
  await writeFile(resolve(output,'assets/door.scene.json'),JSON.stringify(last.door.value,null,2));
  await writeFile(resolve(output,'reproduce.json'),JSON.stringify({inputs:firstRun.inputs,algorithms:snapshot.passes,schemas:snapshot.kinds,expected:summarizeOutputs(baseline)},null,2));
  const bundle=await readFile(resolve(root,'dist/workbench/workbench.js'),'utf8');await writeFile(resolve(output,'index.html'),renderWorkbenchHtml(snapshot,bundle,await collectSources(root)));
  console.log(`Saved actual IRs, trace database, query examples and offline workbench in ${output}`);
  if(customFailed)process.exitCode=1;
}

main().catch(error=>{console.error(error);process.exitCode=1;});
