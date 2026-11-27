// The full sequence once, with each step's check, the final listing and the measurement.
import { fresh, bindings, measure } from './lib.mjs';
const { specializeInterpreter } = await import('../../../../../../dist/typed/specialize-buffer.js');
const p = fresh();
const steps = await specializeInterpreter(p, bindings());
for (const s of steps) console.log(`${String(s.pass).padEnd(18)} ${s.changed ? `${s.rev} edits ${s.edits} check ${s.check}` : s.rejected ? 'REJECTED ' + s.rejected : 'no change'}`);
console.log(p.listing('runVm'));
console.table([measure(p, 'specialized')]);
