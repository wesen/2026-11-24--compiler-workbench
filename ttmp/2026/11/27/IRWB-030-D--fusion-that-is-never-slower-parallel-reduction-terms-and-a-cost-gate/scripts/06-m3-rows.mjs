// IRWB-030-D M3: fused against unfused as the row count changes. softmax, layernorm-inside and attention, rows of
// the brief's length with N (or Q) from 1 up, and softmax at a fixed 2^22 elements from 1 row of 2^22 to 2^20 rows
// of 4. One GPU call per (series, fuse) and round; three rounds.
import { bench } from './03-bench.mjs';
const few = [1, 2, 4, 8, 16, 32, 48, 96, 192, 384, 768, 1536, 4096];
const series = {
  'softmax/C=1024': ['softmax', few.map(N => ({ N, C: 1024 }))],
  'layernorm-inside/D=1024': ['layernorm-inside', few.map(N => ({ N, D: 1024 }))],
  'attention/K=1024': ['attention', few.filter(n => n <= 1024).map(Q => ({ Q, K: 1024, D: 64, V: 64 }))],
  'softmax/NC=2^22': ['softmax', [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20].map(b => ({ N: 2 ** b, C: 2 ** (22 - b) }))],
};
for (let round = 0; round < 3; round++)
  for (const [label, [name, shapes]] of Object.entries(series))
    for (const fuse of [true, false])
      for (const r of await bench(name, { fuse, shapes }))
        console.log(JSON.stringify({ round, label, fuse, ...r }));
