import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourceCompiler, compileProgram } from '../dist/pipelines/project.js';
import { planProgramStrategy } from '../dist/pipelines/strategy.js';
import * as S from '../dist/strategy/index.js';
import building from '../dist/programs/building.js';

function prefixNodeIds(node,prefix){node.id=prefix+node.id;for(const child of S.childNodes(node))prefixNodeIds(child.node,prefix);return node;}
function invocations(compiler,runId){return compiler.snapshot().invocations.filter(i=>i.runId===runId);}

test('two choices over the same candidate artifacts retain exact causality when materializing the earlier result',async()=>{
  const compiler=createSourceCompiler();let plan=planProgramStrategy(building,'two-choices');
  const original=S.find(plan,'scene/choose');
  plan=S.replace(plan,original.id,{...original,bind:'earlierValue'});
  const later=prefixNodeIds(JSON.parse(JSON.stringify(original)),'later/');later.objective={metric:'surfaceErrorBound',direction:'min'};later.decisionAs='laterDecision';
  plan=S.insertAfter(plan,original.id,later);
  const materializer=S.find(plan,'scene/materialize');
  plan=S.replace(plan,materializer.id,{...materializer,args:{...materializer.args,selected:S.binding('earlierValue',['task']),strategySelection:S.binding(original.decisionAs)}});
  const result=await compileProgram(compiler,building,'Choose twice, keep first','two-choices',{strategyPlan:plan});
  assert.equal(result.value.value.selectedLOD,'divisor-4');
  const selection=result.run.artifact('two-choices/selected').value;
  assert.equal(selection.strategySelection.nodeId,'scene/choose');
  assert.equal(selection.strategySelection.objective.metric,'renderedTriangles');
  assert.equal(selection.strategySelection.winner,'divisor-4');
  const laterEvidence=result.strategy.trace.records.find(r=>r.nodeId==='later/scene/choose').evidence.find(e=>e.label==='selection').data;
  assert.equal(laterEvidence.winner,'divisor-1');assert.equal(laterEvidence.objective.metric,'surfaceErrorBound');
  assert.equal(Object.hasOwn(selection.strategySelection,'executionId'),false);
  const warm=await compileProgram(compiler,building,'Repeated two-choice strategy','two-choices',{strategyPlan:plan});
  assert.equal(warm.value.revision,result.value.revision);
  assert.ok(invocations(compiler,warm.run.id).every(i=>i.status==='cached'),'Execution-specific provenance must not contaminate content cache keys');
});

test('inserting an observational strategy checkpoint changes the plan trace while preserving all pass cache identities',async()=>{
  const compiler=createSourceCompiler(),original=planProgramStrategy(building,'checkpoint');
  const cold=await compileProgram(compiler,building,'Original plan','checkpoint',{strategyPlan:original});
  const edited=S.insertAfter(original,'program/source',S.checkpoint('review/source-observation','Source authoring data',S.ref('current')));
  const warm=await compileProgram(compiler,building,'Instrumented plan','checkpoint',{strategyPlan:edited});
  assert.notEqual(cold.strategy.trace.planRevision,warm.strategy.trace.planRevision);
  assert.equal(cold.value.revision,warm.value.revision);
  assert.ok(invocations(compiler,warm.run.id).every(i=>i.status==='cached'));
  const record=warm.strategy.trace.records.find(r=>r.nodeId==='review/source-observation');assert.equal(record.status,'succeeded');
  assert.equal(record.evidence[0].data.artifact.artifact,'checkpoint/source');
  assert.equal(cold.strategy.trace.records.some(r=>r.nodeId==='review/source-observation'),false);
});
