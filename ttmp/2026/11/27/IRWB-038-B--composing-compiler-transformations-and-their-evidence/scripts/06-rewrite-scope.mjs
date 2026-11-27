// Exercise A0-G's recovered witness over a full tree and over one subterm.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const cell = resolve('../a0-fa-irwb-035-g');
const {build} = createRequire(resolve(cell,'package.json'))('esbuild');
const {outputFiles} = await build({entryPoints:[resolve(cell,'src/typed/edit-classes.ts')],
  bundle:true, format:'esm', platform:'node', write:false});
const {rederive} = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'));
const variable = imm => ({op:'get',imm,args:[]});
const literal = imm => ({op:'const',imm,args:[]});
const op = (op,...args) => ({op,args});
const x = variable(0), other = variable(1);
const focus = op('add',op('mul',x,literal(1)),literal(0));
const witness = rederive(focus,x);
assert.deepEqual(witness.fired,['mul-one','add-zero']);
const tree = op('sub',focus,other);
assert.ok(rederive(tree,op('sub',x,other)));
assert.equal(rederive(tree,op('sub',x,literal(7))), undefined);
console.log('recovered', witness.fired, 'strength', witness.weakest, 'unexplained sibling change refused');
