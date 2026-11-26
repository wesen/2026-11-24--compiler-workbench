// IRWB-007 measurement 1: what the scene buffers hold, per gallery scene. Pure data: the vendored scene table
// (corpus/candela-gallery/candela_gallery_scenes.c, digest-checked), parsed by parseSceneTable; nothing of Candela runs.
//   node …/01-scene-table-inventory.mjs [--json out.json] [--text out.txt]
// The meaning of the words decoded here is read from the kernel that consumes them (kernel.typed):
//   U row 0        res.x, res.y, -, spp                       renderPixel (kernel.typed:2599)
//   U 76..79       nObj, nLights, nB (first BVH object), nNodes   traceAll (:962), nLightChoices (:1883)
//   U 31, U 32     sun on (> 0.5), environment mode          nLightChoices, neeAt (:2001)
//   U 87           integrator mode (0 path, 9 custom, 20 ids)  renderPixel
//   U 95           first media row in SD                      mRow (:1889)
//   U 97           motion keys K (pose blending if >= 2)      poseQ (:416), renderPixel
//   O rows         6 per object: row 0 (type, material, light, flags), rows 1-3 the affine transform,
//                  row 4 the primitive's parameters, row 5 (irand, iid, motion base + 1, -)   oRow (:403), finishHit (:776)
//   LI rows        6 per light                                lRow (:1556)
//   BV rows        2 per node: (min.xyz, first or left child), (max.xyz, object count; 0 = inner node)   traceAll
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const root = new URL('../../../../../../', import.meta.url).pathname;
const { candelaDir, candelaManifest } = await import(root + 'tools/candela.mjs');
const { parseSceneTable } = await import(root + 'dist/typed/candela-render.js');

const args = process.argv.slice(2);
const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const file = 'candela_gallery_scenes.c';
const text = readFileSync(join(candelaDir, file));
const digest = createHash('sha256').update(text).digest('hex');
const entry = candelaManifest.files.find(x => x.file === file);
if (!entry || entry.sha256 !== digest) throw new Error(`${file}: digest ${digest} does not match VENDOR.json`);
const scenes = parseSceneTable(text.toString('utf8'));

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const fl = w => ((u32[0] = w), f32[0]);
const TYPES = { 0: 'sphere', 1: 'plane', 2: 'rect', 3: 'disc', 4: 'box', 5: 'cylinder', 13: 'mesh' };
const tname = t => TYPES[t] ?? (t >= 6 ? `sdf${t}` : `t${t}`);

const rows = [];
for (const s of scenes) {
  const [nU, nO, nL, nB, nS] = s.rows;
  const off = [0, nU, nU + nO, nU + nO + nL, nU + nO + nL + nB].map(r => 4 * r);
  const buf = b => (r, c) => fl(s.data[off[b] + 4 * r + c]);
  const U = i => fl(s.data[i]), O = buf(1), BV = buf(3);
  const nObj = U(76), nLights = U(77), nBfirst = U(78), nNodes = U(79);
  // objects
  const objects = [];
  for (let i = 0; i < nO / 6; i++) {
    const r = k => [0, 1, 2, 3].map(c => O(6 * i + k, c));
    const [ty, mat, lit, flags] = r(0);
    const m = [r(1), r(2), r(3)];
    const identityLinear = m.every((row, a) => row.slice(0, 3).every((x, b) => x === (a === b ? 1 : 0)));
    objects.push({ i, type: tname(ty), mat, lit, flags, motion: r(5)[2] - 1 >= 0, identityLinear, translation: m.map(row => row[3]) });
  }
  // BVH: walk from node 0 as traceAll does (inner node: children a.w and a.w + 1)
  const nodes = nB / 2;
  let leaves = 0, maxLeaf = 0, depth = 0, inBvh = 0;
  if (nodes > 0 && nNodes > 0) {
    const walk = (n, d) => {
      depth = Math.max(depth, d);
      const cnt = BV(2 * n + 1, 3), first = BV(2 * n, 3);
      if (cnt > 0) { leaves++; maxLeaf = Math.max(maxLeaf, cnt); inBvh += cnt; return; }
      walk(first, d + 1); walk(first + 1, d + 1);
    };
    walk(0, 1);
  }
  const types = {};
  for (const o of objects) types[o.type] = (types[o.type] ?? 0) + 1;
  rows.push({
    index: s.index, id: s.id, title: s.title, size: `${s.width}x${s.height}`, spectral: s.spectral,
    rows: { U: nU, O: nO, LI: nL, BV: nB, SD: nS }, words: s.data.length, bytes: 4 * s.data.length,
    u: { spp: U(3), mode: U(87), nObj, nLights, firstUnbounded: nBfirst, nNodes, sunOn: U(31) > 0.5, envMode: U(32), mediaBase: U(95), motionKeys: U(97) },
    objects: objects.length, types, linearLoopTrips: Math.max(0, nObj - nBfirst),
    bvh: { nodes, nNodesU: nNodes, leaves, maxLeaf, depth, objectsInLeaves: inBvh },
    materials: [...new Set(objects.map(o => o.mat))].sort((a, b) => a - b),
    identityTransforms: objects.filter(o => o.identityLinear).length, movingObjects: objects.filter(o => o.motion).length,
    objectList: objects,
  });
}

const pad = (x, n) => String(x).padStart(n);
const lines = [
  `scene table ${file} sha256 ${digest.slice(0, 16)}…: ${scenes.length} scenes`,
  'id    size     rows U  O  LI BV SD  words  obj  lit  BVH nodes/leaves/maxleaf/depth  linear  types',
];
for (const r of rows)
  lines.push(
    `${r.id.padEnd(5)} ${r.size.padEnd(8)} ${pad(r.rows.U, 6)}${pad(r.rows.O, 4)}${pad(r.rows.LI, 3)}${pad(r.rows.BV, 3)}${pad(r.rows.SD, 4)}` +
      `${pad(r.words, 7)}${pad(r.objects, 5)}${pad(r.u.nLights, 5)}   ${pad(`${r.bvh.nodes}/${r.bvh.leaves}/${r.bvh.maxLeaf}/${r.bvh.depth}`, 12)}` +
      `${pad(r.linearLoopTrips, 20)}  ${Object.entries(r.types).map(([k, v]) => `${k}:${v}`).join(' ')}`,
  );
const tot = rows.reduce((a, r) => a + r.words, 0);
lines.push(`words in all scenes: ${tot} (${4 * tot} bytes); largest ${Math.max(...rows.map(r => r.words))}, smallest ${Math.min(...rows.map(r => r.words))}`);
const out = lines.join('\n');
console.log(out);
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(rows, null, 1) + '\n');
if (opt('--text')) writeFileSync(opt('--text'), out + '\n');
