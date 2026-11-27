import { readFileSync } from 'node:fs';
const root = process.argv[2];
const { compileTix, optimizeTix } = await import(root + '/dist/tensor/index.js');
const p = compileTix(readFileSync(root + '/corpus/tensor/matmul/main.tix', 'utf8'));
console.log(JSON.stringify(p.origin.value.functions[0].statements));
console.log(JSON.stringify(optimizeTix(p, ['split-sum']).program.current.value.functions[0].statements));
