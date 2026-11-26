import { readFileSync } from 'node:fs';

const data = readFileSync(new URL('./01-gb10/out/results.bin', import.meta.url));
const names = ['add','sub','mul','div','neg','exp','log','sqrt','tanh','max','min','sum7'];
const round = Math.fround;
const rows = names.map(op => ({ op, bitDifferences: 0, worstBudgetFraction: 0, first: null }));
if (data.length !== 8192 * names.length * 4) throw Error('Incomplete result');
for (let i = 0; i < 8192; i++) {
  const x = (i - 4096) / 1024, y = (i + 1) / 1024;
  let sum = 0, sum32 = 0;
  for (let j = 1; j <= 7; j++) {
    sum += x * (y / j);
    sum32 = round(sum32 + round(x * round(y / j)));
  }
  const ref = [x+y,x-y,x*y,x/y,-x,Math.exp(x),Math.log(y),Math.sqrt(y),Math.tanh(x),
    Math.max(x,y),Math.min(x,y),sum];
  for (const [k, r] of ref.entries()) {
    const gpu = data.readFloatLE((i * names.length + k) * 4);
    const expected = k === names.length - 1 ? sum32 : round(r);
    const row = rows[k];
    if (!Object.is(gpu, expected)) {
      row.bitDifferences++;
      row.first ??= { i, x, y, expected, gpu };
    }
    const fraction = Math.abs(gpu - r) / (2e-6 + 2e-5 * Math.abs(r));
    if (!(fraction <= 1)) throw Error(JSON.stringify({ i, k, gpu, r }));
    row.worstBudgetFraction = Math.max(row.worstBudgetFraction, fraction);
  }
}
console.log(JSON.stringify(rows, null, 2));
