// IRWB-030-D M1: which reduction bodies to stage. layernorm (variance's body is one multiply) and
// layernorm-inside, softmax-inside, at the brief's sizes, with term staging off ('none'), for multi-instruction
// bodies only ('costly') and for every operation ('any'); three rounds, one GPU call per configuration and round.
import { bench } from './03-bench.mjs';
for (let round = 0; round < 3; round++)
  for (const name of ['layernorm', 'layernorm-inside', 'softmax-inside'])
    for (const terms of ['none', 'costly', 'any']) {
      const [r] = await bench(name, { terms });
      console.log(JSON.stringify({ round, name, terms, ...r }));
    }
