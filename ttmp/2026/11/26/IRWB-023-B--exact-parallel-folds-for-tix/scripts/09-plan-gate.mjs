// Verify a restricted schedule selection in the actual v6 transformation manager.
// The kernel template and the provenance of receipts are trusted parts of this prototype.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {inspectRow} from './12-row-region.mjs';
import {compileTix,optimizeTix} from '../../../../../../dist/tensor/index.js';
import {TixIR} from '../../../../../../dist/tensor/ir.js';
import {defineIR,createArtifact,defineTransformation,defineInvariant,AnalysisManager,ContractError} from '../../../../../../dist/framework/contracts/index.js';

const read=f=>JSON.parse(readFileSync(new URL(f,import.meta.url)));
const source=readFileSync('corpus/tensor/softmax/main.tix','utf8');
const binary=r=>r.stdout.match(/^([a-f0-9]{64})  \.\/prog$/m)[1];
const profile=r=>r.stdout.split('\n').find(s=>s.startsWith('NVIDIA '));
const calibrated=process.argv[2]==='calibrated';
const prefix=calibrated?'11-':'06-';
const deploy=read(calibrated?'11-full.json':'05-full.json');
const intervals=['low','active','high'].map(name=>{
  const cpu=read(prefix+name+'-node.json'),gpu=read(prefix+name+'-gpu.json');
  const expected=calibrated?'selected=quadratic':'cubic-quartic-diff=0';
  const g=gpu.stdout.match(/audit \[([a-f0-9]+),([a-f0-9]+)\) words=(\d+) ([^\n]+)/);
  assert.equal(g?.[4],expected);
  assert(g && gpu.exit===0);
  return {first:parseInt(cpu.first,16),end:parseInt(cpu.end,16),words:cpu.words,cpu:cpu.sha256,
    gpuFirst:parseInt(g[1],16),gpuEnd:parseInt(g[2],16),gpuWords:Number(g[3]),
    gpu:gpu.stdout.match(/^([a-f0-9]{64})  -$/m)[1],reference:cpu.node+'/'+cpu.v8,
    binary:binary(gpu),profile:profile(gpu),table:gpu.tableSha256};
});
const canonical={version:'row-owner-v1',function:'softmax',sum:'ordered-fadd-rn',tail:'masked',
  guard:calibrated?'0<N and 0<C<=1024 and N*C<=INT_MAX':'finite logits and 0<N and 0<C<=1024 and N*C<=INT_MAX',
  fallback:'current-emitter',scalar:calibrated?'fitted-quadratic':'patched-cubic',
  binary:binary(deploy),profile:profile(deploy),table:deploy.tableSha256};
const scalarIR=(id)=>defineIR({id,version:'1',description:id,validate(v){if(!v||typeof v!=='object') throw Error(id);}});
const Receipt=scalarIR('ticket023.receipt'),Plan=scalarIR('ticket023.schedule');
function verifyRows(module,chosen) {
  const fn=module.functions.find(f=>f.name===chosen);
  if(fn?.params.length!==1 || fn.statements.length!==4) return 'function signature or statement count';
  const region=inspectRow(fn,0);
  if(region.error) return region.error;
  if(fn.result!==region.output) return 'returned tensor';
}
function verifyReceipt(plan,spans) {
  let end=0;
  for(const s of spans) {
    if(s.first!==end||s.end<=end||s.words!==s.end-end||s.gpuFirst!==s.first||s.gpuEnd!==s.end||s.gpuWords!==s.words) return 'discontinuous or unequal domain';
    if(s.reference!==process.version+'/'+process.versions.v8||s.profile!==plan.profile||s.binary!==plan.binary||s.table!==plan.table) return 'execution identity differs';
    if(!/^[0-9a-f]{64}$/.test(s.cpu)||s.cpu!==s.gpu) return 'outputs differ';
    end=s.end;
  }
  if(end!==0x7f800001) return 'incomplete negative domain';
}
const inputs={source:TixIR,receipt:Receipt},outputs={plan:Plan};
const inv=defineInvariant({id:'ticket023.row-meaning',version:'1',description:'Domain discharge and target identity',
  inputs:{...inputs,...outputs},check(_ctx,{source,receipt,plan}) {
    const p=plan.value;
    for(const field of ['version','sum','tail','guard','fallback','scalar'])
      if(p[field]!==canonical[field]) return {ok:false,reason:'unsupported plan '+field};
    const reason=verifyRows(source.value,p.function)??verifyReceipt(p,receipt.value.intervals);
    return reason ? {ok:false,reason} : {ok:true,evidence:{scope:'restricted-row-template',reference:source.revision}};
  }});
const transform=defineTransformation({id:'ticket023.choose-row',version:'1',description:'Check a selected schedule',
  inputs,outputs,ensures:[{invariant:inv,bindings:{source:{from:'inputs',port:'source'},receipt:{from:'inputs',port:'receipt'},plan:{from:'outputs',port:'plan'}}}]});
const initial=compileTix(source).current;
const square=source.replaceAll('N,C','N,N');
const split=optimizeTix(compileTix(source),['split-sum']).program.current;
const cases=[
  ['valid',true,initial,canonical,intervals],
  ['alpha-renamed',true,compileTix(source.replaceAll('i','h').replaceAll('j','k')).current,canonical,intervals],
  ['square transpose',false,compileTix(square.replace('max(j) x[i,j]','max(j) x[j,i]')).current,canonical,intervals],
  ['wrong broadcast',false,compileTix(square.replace('x[i,j] - m[i]','x[i,j] - m[j]')).current,canonical,intervals],
  ['positive argument possible',false,compileTix(source.replace('x[i,j] - m[i]','m[i] - x[i,j]')).current,canonical,intervals],
  ['already split',false,split,canonical,intervals],
  ['tree schedule',false,initial,{...canonical,sum:'tree'},intervals],
  ['lost tail',false,initial,{...canonical,tail:'floor'},intervals],
  ['stale binary',false,initial,{...canonical,binary:'0'.repeat(64)},intervals],
  ['missing interval',false,initial,canonical,intervals.slice(1)],
  ['reference disagreement',false,initial,canonical,intervals.map((v,i)=>i===1?{...v,cpu:'1'.repeat(64)}:v)],
  ['different oracle',false,initial,canonical,intervals.map(v=>({...v,reference:'other'}))],
];
for(const [name,expected,value,p,spans] of cases) {
  const manager=new AnalysisManager();
  let accepted=true,reason;
  try { await manager.verifyTransformation({source:value,receipt:createArtifact(Receipt,'receipt',{intervals:spans})},
    {plan:createArtifact(Plan,'plan',p)},transform); }
  catch(e) { if(!(e instanceof ContractError)||e.code!=='postcondition') throw e; accepted=false; reason=e.message; }
  assert.equal(accepted,expected,name);
  console.log(JSON.stringify({name,accepted,reason}));
}
