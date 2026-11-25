// How Candela's 559 checked addresses relate: per block and receiver, are positions constants, or one linear
// base plus constant offsets? Decides which bounds-check rule pays. node …/09-caddr-patterns.mjs
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs'); await installVendor();
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { describeText } = await import(root + 'dist/typed/listing.js');
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const V = id => st.get(id);
// linear form of an i32 value: { base: text of the non-constant part, k: constant } or null
let single = new Map(); // local index -> value id of its only assignment (in the current function)
const linear = id => {
  let v = V(id);
  if (v.op === 'get' && single.has(v.imm)) return linear(single.get(v.imm));
  if (v.op === 'const') return { base: '', k: v.imm | 0 };
  if (v.op === 'add') { const a = linear(v.args[0]), b = linear(v.args[1]); if (a && b && (!a.base || !b.base)) return { base: a.base || b.base, k: (a.k + b.k) | 0 }; }
  if (v.op === 'sub') { const a = linear(v.args[0]), b = linear(v.args[1]); if (a && b && !b.base) return { base: a.base, k: (a.k - b.k) | 0 }; }
  if (v.op === 'shl' && V(v.args[1]).op === 'const') { const a = linear(v.args[0]), s = V(v.args[1]).imm; if (a) return { base: a.base ? `(${a.base})<<${s}` : '', k: (a.k << s) | 0 }; }
  return { base: describeText(st, id), k: 0 };
};
const stats = { total: 0, constPos: 0, groups: 0, inGroupsOf2plus: 0, removableByMinMax: 0, sameBaseAcrossBlocks: 0 };
for (const f of st.fns.values()) {
  const perFn = new Map(), sets = new Map();
  for (const b of f.blocks) for (const sid of b.stmts) { const s = V(sid); if (s.op === 'set') sets.set(s.local, (sets.get(s.local) || []).concat(s.value)); }
  single = new Map([...sets].filter(([l, vs]) => vs.length === 1 && !f.locals[l].param).map(([l, vs]) => [l, vs[0]]));
  for (const b of f.blocks) {
    const groups = new Map();
    const walk = id => { const v = V(id); if (v.op === 'caddr') { const rv = V(v.args[0]), r = rv.op === 'get' && single.has(rv.imm) ? describeText(st, single.get(rv.imm)) : describeText(st, v.args[0]), L = linear(v.args[1]); stats.total++; if (!L.base) stats.constPos++; const key = r + '|' + L.base; (groups.get(key) || groups.set(key, []).get(key)).push(L.k); (perFn.get(key) || perFn.set(key, new Set()).get(key)).add(b.id); } v.args.forEach(walk); };
    for (const sid of b.stmts) { const s = V(sid); for (const k of ['value', 'cond', 'addr']) if (s[k]) walk(s[k]); }
    for (const ks of groups.values()) { stats.groups++; if (ks.length > 1) { stats.inGroupsOf2plus += ks.length; stats.removableByMinMax += Math.max(0, new Set(ks).size - 2) + (ks.length - new Set(ks).size); } }
  }
  for (const blocks of perFn.values()) if (blocks.size > 1) stats.sameBaseAcrossBlocks++;
}
console.log(JSON.stringify(stats));
