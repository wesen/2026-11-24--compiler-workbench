// The result table: general VM, automatic specialization in its forms, the budget sweep, and the hand-written
// loops. Instructions at n = 12, seed = 8; code size is the RV32 image's code bytes; backend option coalesce.
import { fresh, bindings, measure, Program, projectSource, lowerToImage, runImage, benchCase, storeOf } from './lib.mjs';
const { specializeInterpreter } = await import('../../../../../../dist/typed/specialize-buffer.js');

const rows = [];
const add = (p, label, extra = {}) => rows.push({ ...measure(p, label), ...extra });
const info = p => {
  for (let r = 1; r <= p.rev; r++) {
    const e = p.edits(r).find(e => e.kind === 'specialized');
    if (e) return { variants: e.variants, over: e.overBudget };
  }
  return {};
};
const bad = steps => steps.filter(s => s.rejected).map(s => s.pass);

let p = fresh();
add(p, 'general r0');
await p.pipeline('speed');
add(p, 'general speed');

p = fresh();
await p.specializeBuffer(bindings());
add(p, 'specialize-buffer only', info(p));

p = fresh();
console.log('rejected:', bad(await specializeInterpreter(p, bindings())));
add(p, 'specialized (code + entry promised)', info(p));
console.log(p.listing('runVm'));

p = fresh();
console.log('rejected:', bad(await specializeInterpreter(p, bindings({ withEntry: false }))));
add(p, 'code promised, entry unbound', info(p));

p = fresh();
console.log('rejected:', bad(await specializeInterpreter(p, bindings(), { guard: true })));
add(p, 'guarded (nothing assumed)', info(p));
console.log('guarded assumptions:', JSON.stringify(p.assumptions));

for (const budget of [0, 4, 8, 16, 24, 32, 37, 38]) {
  p = fresh();
  const rej = bad(await specializeInterpreter(p, bindings(), { budget }));
  add(p, `budget ${budget}`, { ...info(p), ...(rej.length ? { rejected: rej.join(' ') } : {}) });
}

const source = `
function seededFib(n: i32, seed: i32): i32 {
    let a = 0;
    let b = seed;
    for (let remaining = n; remaining > 0; remaining = remaining - 1) {
        const next = a + b;
        a = b;
        b = next;
    }
    return a;
}

function rollingChecksum(n: i32, seed: i32): i32 {
    let h = seed;
    for (let remaining = n; remaining > 0; remaining = remaining - 1) {
        h = h * 33 + remaining;
    }
    return h;
}
`;
const scalar = { n: [0, 12], seed: [-8, 8] };
const hand = Program.fromProject(projectSource('bytecode-vm-specialized', {
  'main.typed': source,
  'project.json': JSON.stringify({ pipeline: 'speed', inputs: { seededFib: scalar, rollingChecksum: scalar } }),
}));
await hand.pipeline('speed');
const { image } = lowerToImage(hand.head, { coalesce: true });
const steps = fn => {
  const c = benchCase(storeOf(hand.head.value), fn, { n: 12, seed: 8 });
  return runImage(image, c.fn, c.args, c.memory, { counts: false }).steps;
};
rows.push({ label: 'hand-specialized (two functions)', bytes: image.value.bytes, e0: steps('seededFib'), e34: steps('rollingChecksum') });
const g = rows[0], h = rows.at(-1);
for (const r of rows) {
  r.closed0 = (100 * (g.e0 - r.e0) / (g.e0 - h.e0)).toFixed(2) + '%';
  r.closed34 = (100 * (g.e34 - r.e34) / (g.e34 - h.e34)).toFixed(2) + '%';
  delete r.r0; delete r.r34;
}
console.table(rows);
