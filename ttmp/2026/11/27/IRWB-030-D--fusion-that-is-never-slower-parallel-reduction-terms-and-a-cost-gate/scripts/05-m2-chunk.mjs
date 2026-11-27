// IRWB-030-D M2: the term chunk. layernorm-inside and softmax-inside with chunks of 128 to 4096 terms, at the
// brief's size (rows of 1024) and at 1024 rows of 4096 (same element count); three rounds.
import { bench } from './03-bench.mjs';
for (let round = 0; round < 3; round++)
  for (const name of ['layernorm-inside', 'softmax-inside'])
    for (const chunk of [128, 256, 512, 1024, 2048, 4096]) {
      const long = name.startsWith('layernorm') ? { N: 1024, D: 4096 } : { N: 1024, C: 4096 };
      const short = name.startsWith('layernorm') ? { N: 4096, D: 1024 } : { N: 4096, C: 1024 };
      for (const r of await bench(name, { chunk, shapes: [short, long] }))
        console.log(JSON.stringify({ round, name, chunk, ...r }));
    }
