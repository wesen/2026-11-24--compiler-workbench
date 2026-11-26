// IRWB-004: summarize a V8 .cpuprofile. Prints the functions with the most inclusive time (a sample counts once for
// every distinct function on its stack) and the most self time, with file:line, in milliseconds.
//   node …/03-profile-summary.mjs PROFILE.cpuprofile [--top 40] [--within NAME]
// --within NAME restricts to samples whose stack contains a function called NAME (e.g. applyPass).
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const flag = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const file = args[0],
  top = +flag('--top', 40),
  within = flag('--within', null);
const prof = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(prof.nodes.map(n => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const label = n => {
  const f = n.callFrame;
  const url = (f.url || '').replace(/^file:\/\/.*?\/dist\//, 'dist/').replace(/^file:\/\/.*\//, '');
  return `${f.functionName || '(anon)'} ${url}:${f.lineNumber + 1}`;
};
const dt = new Map();
// time per sample: timeDeltas[i] is the time before sample i
const samples = prof.samples,
  deltas = prof.timeDeltas;
const incl = new Map(),
  self = new Map();
let total = 0;
for (let i = 0; i < samples.length; i++) {
  const d = (deltas[i + 1] ?? deltas[i]) / 1000;
  let id = samples[i];
  const stack = [];
  while (id !== undefined) {
    stack.push(byId.get(id));
    id = parent.get(id);
  }
  if (within && !stack.some(n => n.callFrame.functionName === within)) continue;
  total += d;
  const leaf = stack[0];
  if (leaf.callFrame.functionName === '(idle)' || leaf.callFrame.functionName === '(program)') {
    self.set(label(leaf), (self.get(label(leaf)) ?? 0) + d);
    continue;
  }
  self.set(label(leaf), (self.get(label(leaf)) ?? 0) + d);
  const seen = new Set();
  for (const n of stack) {
    const l = label(n);
    if (seen.has(l)) continue;
    seen.add(l);
    incl.set(l, (incl.get(l) ?? 0) + d);
  }
}
const show = (m, title) => {
  console.log(`\n${title}`);
  for (const [k, v] of [...m].sort((a, b) => b[1] - a[1]).slice(0, top))
    console.log(`${String(Math.round(v)).padStart(8)} ms  ${k}`);
};
console.log(`total ${Math.round(total)} ms${within ? ` within ${within}` : ''}`);
show(incl, 'inclusive');
show(self, 'self');
