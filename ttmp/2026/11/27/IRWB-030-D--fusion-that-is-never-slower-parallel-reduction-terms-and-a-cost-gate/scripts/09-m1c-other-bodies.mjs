// IRWB-030-D M1c: a body of five single-instruction operations and a body with a square root, staging off
// ('none') and on ('any'), alternating, four rounds, three timed cases of N = 4096, C = 1024 per call.
import { bench } from './03-bench.mjs';
const s = { N: 4096, C: 1024 };
for (let round = 0; round < 4; round++)
  for (const name of ['probe-cheap5', 'probe-sqrt'])
    for (const terms of ['none', 'any'])
      for (const r of await bench(name, { terms, shapes: [s, s, s] }))
        console.log(JSON.stringify({ round, name, terms, ...r }));
