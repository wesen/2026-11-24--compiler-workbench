import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';

function custom(args,check){
  const parent=resolve('tmp/cli-tests');mkdirSync(parent,{recursive:true});const path=mkdtempSync(parent+'/case-');
  try {
    const result=spawnSync(process.execPath,['dist/examples/run.js',...args,'--out',path],{encoding:'utf8',maxBuffer:4*1024*1024});
    check(result,path);
  }finally{rmSync(path,{recursive:true,force:true});}
}
test('custom CLI runs record baseline and edited outputs with an offline workbench',()=>{
  custom(['--set','game.objective=quality'],(result,path)=>{
    assert.equal(result.status,0,result.stderr);const summary=JSON.parse(readFileSync(path+'/summary.json'));
    assert.equal(summary.scenarios.length,2);assert.equal(summary.scenarios[1].counts.executed,2);
    assert.equal(JSON.parse(readFileSync(path+'/assets/building.scene.json')).selectedLOD,'LOD-48');
    assert.match(readFileSync(path+'/index.html','utf8'),/trace-data/);
  });
});
test('invalid custom CLI exports failed traces and preserves last successful assets before exiting nonzero',()=>{
  custom(['--set','cad.holeDiameter=0.2'],(result,path)=>{
    assert.equal(result.status,1,result.stderr);const summary=JSON.parse(readFileSync(path+'/summary.json'));
    assert.equal(summary.scenarios[1].status,'failed');assert.ok(summary.scenarios[1].counts.failed>0);
    const trace=JSON.parse(readFileSync(path+'/trace.json'));assert.ok(trace.invocations.some(i=>i.runId==='run-2'&&i.taskId==='cad/mesh'&&i.status==='failed'&&!i.output));
    assert.equal(JSON.parse(readFileSync(path+'/assets/bracket.mesh.json')).triangles.length,672);
    assert.equal(JSON.parse(readFileSync(path+'/assets/door.scene.json')).animation.samples.length,65);
    assert.match(readFileSync(path+'/index.html','utf8'),/oversized|clearance|failed/);
  });
});
