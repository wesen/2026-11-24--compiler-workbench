#!/usr/bin/env node
// IRWB-053-B probe 02: corpus compile time under `speed`, old liveness against the solver-based one,
// interleaved. Probe 01 measures one build per run, and on a shared machine two such runs are not
// comparable (the same corpus, unchanged, moved 39 s -> 69 s between runs). This probe loads both builds
// in one process and alternates them per round, so drift and contention hit both equally; per project it
// reports the minimum of n rounds for each build.
//
//   node 02-speed-interleaved.mjs [runs] [project...]
//
// Two measurements per project:
//   pipeline  Program.fromProject + pipeline('speed')          (what "compile under speed" means)
//   lower     lowerToImage(artifact) on the already built IR   (the backend: register allocation and
//                                                                coalescing, the two liveness clients)
// `out/dist.old` is the pre-change build (`git checkout HEAD~1 -- src && tsc --outDir out/dist.old`);
// `dist` is the change. Both must be built.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const checkout = d => {
  let x = d;
  while (!existsSync(join(x, 'package.json'))) x = dirname(x);
  return x;
};
const root = checkout(here);
const imp = p => import(pathToFileURL(resolve(root, p)).href);

const OLD = process.env.OLD ?? 'out/dist.old';
if (!existsSync(resolve(root, OLD))) throw new Error(`${OLD} is missing: build the pre-change sources into it`);

const [runsArg = '5', ...only] = process.argv.slice(2);
const runs = Number(runsArg);

// The vendored classic scripts are globals; each build's vendor slot has to be told about them separately.
const { loadVendorFile } = await imp('tools/node-vendor.mjs');
for (const p of ['compiler/typed/tape.js', 'compiler/typed/typed-wasm.js', 'bench/host/rv32-interp.js'])
  loadVendorFile(p);
const vendorOf = build => imp(`${build}/typed/vendor.js`).then(m => m.setVendor({
  typedTape: globalThis.typedTape,
  typedWasm: globalThis.typedWasm,
  typedRv32Interp: globalThis.typedRv32Interp,
}));
const builds = {};
for (const [name, dir] of [['old', OLD], ['new', 'dist']]) {
  await vendorOf(dir);
  const { projectSource } = await imp(`${dir}/typed/project.js`);
  const { Program } = await imp(`${dir}/typed/program.js`);
  const { lowerToImage } = await imp(`${dir}/typed/backend/index.js`);
  builds[name] = { projectSource, Program, lowerToImage };
}
const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
// tools/node-vendor.mjs's installVendor points at dist/typed/vendor.js only, so the loop above fills both
// build's vendor slots by hand rather than calling it.
const ids = only.length ? only : projectIds();

/** One timed run of one build: build the program, run `speed`, lower it. Returns [pipelineMs, lowerMs, imageHash]. */
const once = async (build, id) => {
  const b = builds[build];
  const p = b.Program.fromProject(b.projectSource(id, projectFiles(id)));
  const t0 = performance.now();
  await p.pipeline('speed');
  const t1 = performance.now();
  const image = b.lowerToImage(p.artifact()).image.value;
  const t2 = performance.now();
  const hash = createHash('sha256').update(JSON.stringify(image)).digest('hex').slice(0, 16);
  return [t1 - t0, t2 - t1, hash];
};

const rows = [];
const totals = { old: [0, 0], new: [0, 0] };
for (const id of ids) {
  const best = { old: [Infinity, Infinity], new: [Infinity, Infinity] }, hashes = {};
  for (let i = 0; i < runs; i++) {
    for (const build of i % 2 ? ['new', 'old'] : ['old', 'new']) {
      const [pipeline, lower, hash] = await once(build, id);
      best[build][0] = Math.min(best[build][0], pipeline);
      best[build][1] = Math.min(best[build][1], lower);
      hashes[build] = hashes[build] ?? hash;
      if (hashes[build] !== hash)
        throw new Error(`${id}: the ${build} build is not deterministic (${hashes[build]} vs ${hash})`);
    }
  }
  if (hashes.old !== hashes.new) throw new Error(`${id}: the two builds produce different images`);
  totals.old[0] += best.old[0];
  totals.old[1] += best.old[1];
  totals.new[0] += best.new[0];
  totals.new[1] += best.new[1];
  rows.push({ id, pipeline: [best.old[0], best.new[0]], lower: [best.old[1], best.new[1]] });
  console.log(`${id}\t${best.old[0].toFixed(2)}\t${best.new[0].toFixed(2)}\t${best.old[1].toFixed(2)}\t${best.new[1].toFixed(2)}`);
}
const pct = (o, n) => `${(((n - o) / o) * 100).toFixed(1)}%`;
console.log(`# id\tpipeline.old\tpipeline.new\tlower.old\tlower.new   (ms, minimum of ${runs} interleaved rounds)`);
console.log(`total\t${totals.old[0].toFixed(2)}\t${totals.new[0].toFixed(2)}\t${totals.old[1].toFixed(2)}\t${totals.new[1].toFixed(2)}`);
console.log(`change\tpipeline ${pct(totals.old[0], totals.new[0])}\tlower ${pct(totals.old[1], totals.new[1])}`);
