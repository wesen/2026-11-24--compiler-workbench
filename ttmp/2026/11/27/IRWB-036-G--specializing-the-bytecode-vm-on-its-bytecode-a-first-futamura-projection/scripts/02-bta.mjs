// The binding-time division of runVm: with the buffer bound only, and with `entry` bound to its candidates.
import { fresh, storeOf, bindingTimes } from './lib.mjs';
const p = fresh();
const st = storeOf(p.head.value), f = st.fn('runVm');
const idx = n => f.locals.findIndex(l => l.name === n);
for (const [label, cands] of [['code bound', []], ['code and entry bound', [idx('entry')]]]) {
  const d = bindingTimes(st, f, new Set([idx('code')]), new Set(cands));
  console.log(label);
  console.log('  static :', [...d.static].map(l => f.locals[l].name).join(' '));
  console.log('  dynamic:', [...d.dynamicBecause].map(([l, s]) => `${f.locals[l].name} (${s})`).join(' '));
  console.log('  buffer loads: static', d.staticLoads.length, 'dynamic', d.dynamicLoads.length);
}
