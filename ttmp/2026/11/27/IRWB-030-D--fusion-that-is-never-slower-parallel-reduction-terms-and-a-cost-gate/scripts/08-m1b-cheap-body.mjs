// IRWB-030-D M1b: is a one-multiply body worth staging? layernorm (variance = sum(j) centered * centered) with
// staging off ('none') and on ('any'), alternating, five rounds, three timed cases of the brief's size per call.
import { bench } from './03-bench.mjs';
const s = { N: 4096, D: 1024 };
for (let round = 0; round < 5; round++)
  for (const terms of ['none', 'any'])
    for (const r of await bench('layernorm', { terms, shapes: [s, s, s] }))
      console.log(JSON.stringify({ round, name: 'layernorm', terms, ...r }));
