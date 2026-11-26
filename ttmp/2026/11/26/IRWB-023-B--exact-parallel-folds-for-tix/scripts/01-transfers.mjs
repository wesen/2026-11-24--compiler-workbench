// Run from the repository root after npm run build.
import assert from 'node:assert/strict';
import {compileTix, runTix} from '../../../../../../dist/tensor/index.js';

const f = Math.fround;
const float = new Float32Array(1);
const raw = new Uint32Array(float.buffer);
function word(x) { float[0] = x; return raw[0]; }
function value(x) { raw[0] = x; return float[0]; }
function fold(start, row) {
  for (const x of row) start = f(start + x);
  return start;
}
function trace(start, row) {
  const seed = word(start), tag = seed >>> 23;
  let end = start, low = seed, high = seed;
  for (const x of row) {
    end = f(end + x);
    const bits = word(end);
    low = Math.min(low, bits);
    high = Math.max(high, bits);
  }
  return {seed, tag, low, high, end:word(end)};
}
function relocate(t, entry) {
  const w = word(entry);
  if (w === t.seed) return value(t.end);
  if ((w >>> 23) !== t.tag || (w & 1) !== (t.seed & 1)) return;
  const exponent = t.tag & 255;
  if (exponent === 0 || exponent === 255) return;
  const delta = w - t.seed;
  const lower = t.tag * 2**23, upper = lower + 2**23;
  if (Math.min(t.low,t.low + delta) <= lower ||
      Math.max(t.high,t.high + delta) >= upper) return;
  return value(t.end + delta);
}

let state = 23023;
function random() {
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  return (state >>> 0) / 2**32;
}
const patterns = {
  positive: () => f(0.25 + 0.75 * random()),
  expShift: () => f(Math.exp(f(-2 * random()))),
  expWide: () => f(Math.exp(f(-80 * random()))),
  signed: () => f(2 * random() - 1),
  signedProduct: () => f(f(2 * random()-1) * f(2 * random()-1)),
  halfUlp: i => i === 0 ? 1 : 2**-24,
  spikes: i => [2**25,1,-(2**25),-1][i%4],
  subnormal: () => (random()<0.5 ? -1:1)*2**-149,
  overflow: i => i%5<2 ? value(0x7f7fffff) : -value(0x7f7fffff),
};
const program = compileTix('fn row(x:f32[N,K]):f32[N]{ y[i]=sum(j) x[i,j]; return y; }');
for (const [name, sample] of Object.entries(patterns)) {
  for (const width of [8,32,128]) {
    let total=0, direct=0, translated=0, replay=0, oneAnchor=0, wrongPredict=0, wrongFinal=0;
    for (let r=0;r<128;r++) {
      const row=Float32Array.from({length:1023+r%3},(_,i)=>sample(i));
      let carry=0, reference=0, estimate=0;
      for (let k=0;k<row.length;k+=width) {
        const chunk=row.subarray(k,k+width);
        const predicted = f(estimate); // f64 exclusive prefix; an intentionally good predictor
        const anchor = trace(predicted, chunk);
        const neighbor = trace(value(anchor.seed ^ 1),chunk);
        const first = relocate(anchor, carry);
        if (first !== undefined) oneAnchor++;
        let found = first ?? relocate(neighbor,carry);
        if (word(carry) === anchor.seed || word(carry) === neighbor.seed) direct++;
        else if (found !== undefined) translated++;
        else replay++;
        const oracle=fold(reference,chunk);
        if (!Object.is(value(anchor.end),oracle)) wrongPredict++;
        carry = found ?? fold(carry,chunk);
        assert.equal(word(carry),word(oracle),name+' chunk '+k);
        reference=oracle;
        for (const x of chunk) estimate+=x;
        total++;
      }
      if (!Object.is(f(estimate),reference)) wrongFinal++;
      if (r<2) {
        const fromTix=runTix(program,'row',{x:{shape:[1,row.length],data:row}}).data[0];
        assert.equal(word(carry),word(fromTix));
      }
    }
    console.log(JSON.stringify({name,width,total,direct,translated,replay,oneAnchor,wrongPredict,wrongFinal}));
  }
}
