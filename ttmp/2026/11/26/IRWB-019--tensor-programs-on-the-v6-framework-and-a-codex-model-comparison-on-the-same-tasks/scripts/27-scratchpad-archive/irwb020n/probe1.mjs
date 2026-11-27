const W = process.argv[2];
const C = await import(W + '/dist/framework/contracts/index.js');
const IR = await import(W + '/dist/framework/ir/index.js');
const P = await import(W + '/dist/framework/passes/index.js');
const D = await import(W + '/dist/framework/contracts/differential.js');
// tiny native IR: {stmts:{id:{c:number}}}
const T = C.defineIR({id:'probe.t',version:'1',description:'probe',validate(v){ if(!v||typeof v.stmts!=='object') throw new Error('bad'); }});
const adapter = IR.defineAdapter({id:'adapter.probe',version:'1',kind:T.id,schemaVersion:T.version,description:'p',
  relationKinds:{contains:'containment'},
  entities:v=>Object.entries(v.stmts).map(([id,s])=>({id,kind:'stmt',attributes:{c:s.c}})),
  resolve:(v,id)=>v.stmts[id]?{id,kind:'stmt',attributes:{c:v.stmts[id].c}}:undefined,
  relations:()=>[], describe:(v,id)=>({label:id}), validate:T.validate, rebuild:(b)=>b});
const a = IR.createIRArtifact(adapter,'p',{stmts:{s1:{c:0.1},s2:{c:-1.5e-30}}});
console.log('float payload ok', a.revision.slice(0,8), Object.isFrozen(a.value));
const mk = (tol) => D.differential({id:'probe.close'+tol,version:'1',description:'d',inputs:{origin:T,candidate:T},
  baseline:'origin',subject:'candidate',count:4,
  cases:(_i,r,n)=>Array.from({length:n},()=>({x:Math.fround(r()*2-1)})),
  run:(side,art,k)=>Object.values(art.value.stmts).reduce((s,t)=>s+t.c*k.x,0),
  compare:(b,s)=>Math.abs(b-s)<=tol});
const exact = mk(0), loose = mk(1);
const contract = (inv)=>C.defineTransformation({id:'probe.opt'+inv.id,version:'1',description:'x',inputs:{input:T,origin:T},outputs:{output:T},
  ensures:[{invariant:inv,bindings:{origin:{from:'inputs',port:'origin'},candidate:{from:'outputs',port:'output'}}}]});
const pass = P.definePass({id:'probe.bump',version:'1',description:'b',ir:T,adapter,writes:{entities:['stmt'],relations:[]},
  run:({before})=>({native:{stmts:{...before.value.stmts,s1:{c:0.1000001}}}, correspondence:[]})});
const manager = new C.AnalysisManager();
const r = pass.run({before:a});
console.log('run is sync:', !(r instanceof Promise));
const res = P.applyPass(pass,a,{manager,contract:contract(loose),contractInputs:{origin:a}});
console.log('applyPass returns promise:', res instanceof Promise);
console.log('loose accepted:', (await res).changed);
try { await P.applyPass(pass,a,{manager,contract:contract(exact),contractInputs:{origin:a}}); console.log('exact accepted?!'); }
catch(e){ console.log('exact rejected:', e.code, e.message.slice(0,120)); }
console.log('sync runDifferential:', D.runDifferential(D.differentialSpec(exact),{origin:a,candidate:a}).status);
