import {mkdir,writeFile} from 'node:fs/promises';
import {IR_LAB_DOMAINS,runIRLab} from '../dist/ir-examples/index.js';
await mkdir('output',{recursive:true});
const evidence=[];
for(const domain of IR_LAB_DOMAINS){const result=await runIRLab(domain.id,{warm:true});await writeFile(`output/v6-ir-${domain.id}.json`,JSON.stringify(result,null,2)+'\n');evidence.push({domain:domain.id,runId:result.runId,summary:result.summary,invocations:result.snapshot.invocations.length,editTransactions:result.changes.length,semanticExecutions:result.contracts.executions.length,semanticChecks:result.contracts.executions.flatMap(e=>e.checks).length});}
const tight=await runIRLab('meshes',{meshTolerance:.1});evidence.push({domain:'meshes-tight-bound',summary:tight.summary});
await writeFile('output/v6-ir-verification.json',JSON.stringify({formatVersion:1,scenarios:evidence},null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
