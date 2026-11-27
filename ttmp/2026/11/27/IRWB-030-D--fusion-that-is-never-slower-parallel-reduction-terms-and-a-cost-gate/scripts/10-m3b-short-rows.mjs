// IRWB-030-D M3b: fused against unfused for short rows, where script 06 found block mode slower (softmax at
// 2^20 rows of 4: 2.93 ms fused, 0.62 ms unfused). Row lengths 4 to 128 at 2^22 and 2^18 elements (softmax),
// 2^22 elements (layernorm-inside), and attention with 4096 queries and K from 4 to 128 keys (D = V = 64).
// One GPU call per (series, fuse) and round; three rounds.
import { bench } from './03-bench.mjs';
const lengths = [4, 8, 16, 24, 32, 48, 64, 96, 128];
const series = {
  'softmax/NC=2^22': ['softmax', lengths.map(C => ({ N: Math.round(2 ** 22 / C), C }))],
  'softmax/NC=2^18': ['softmax', lengths.map(C => ({ N: Math.round(2 ** 18 / C), C }))],
  'layernorm-inside/ND=2^22': ['layernorm-inside', lengths.map(D => ({ N: Math.round(2 ** 22 / D), D }))],
  'attention/Q=4096': ['attention', [4, 8, 16, 32, 64, 128].map(K => ({ Q: 4096, K, D: 64, V: 64 }))],
};
for (let round = 0; round < 3; round++)
  for (const [label, [name, shapes]] of Object.entries(series))
    for (const fuse of [true, false])
      for (const r of await bench(name, { fuse, shapes }))
        console.log(JSON.stringify({ round, label, fuse, ...r }));
