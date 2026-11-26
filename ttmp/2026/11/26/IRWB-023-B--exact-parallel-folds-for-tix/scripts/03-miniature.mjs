// Integer model: four significant bits, subnormal spacing 1, no saturation in tested interval.
// Native arithmetic on these small integers is exact. All rounding is explicit.
import assert from 'node:assert/strict';
const levels=[0,1,2,3,4,5,6,7];
for (let step=1;step<=64;step*=2) for (let i=8;i<16;i++) levels.push(i*step);
function rn(x) {
  let s=Math.sign(x), v=Math.abs(x);
  if (v<8) return x;
  let q=2**(Math.floor(Math.log2(v))-3), a=Math.floor(v/q), rem=v-a*q;
  return s*q*(a+Number(rem*2>q || (rem*2===q && (a&1)===1)));
}
const terms=[...new Set(levels.filter(n=>n<=64).flatMap(n=>[n,-n]))];
const counts={}, witnesses={};
function record(mode, ok, expected, got, data) {
  const t=counts[mode]??={accepted:0,wrong:0};
  if (!ok) return;
  t.accepted++;
  if (got!==expected) { t.wrong++; witnesses[mode]??={...data,expected,got}; }
}
for (const sign of [-1,1]) for (let anchor=32;anchor<64;anchor+=4)
for (let entry=32;entry<64;entry+=4) {
  if (anchor===entry) continue;
  const delta=entry-anchor, even=(delta%8===0);
  for (const a of terms) for(const b of terms) {
    const mid=rn(sign*anchor+a)*sign, end=rn(sign*mid+b)*sign;
    const expected=rn(rn(sign*entry+a)+b);
    const low=Math.min(anchor,mid,end,entry,mid+delta,end+delta);
    const high=Math.max(anchor,mid,end,entry,mid+delta,end+delta);
    const got=sign*(end+delta), d={sign,anchor,entry,a,b,mid,end};
    record('strict',even && low>32 && high<64,expected,got,d);
    record('directional',even && sign*a>=0 && sign*b>=0 && low>=32 && high<64,expected,got,d);
    record('noParity',low>32 && high<64,expected,got,d);
    record('includeLower',even && low>=32 && high<64,expected,got,d);
    record('endOnly',even && Math.min(anchor,end,entry,end+delta)>32 &&
      Math.max(anchor,end,entry,end+delta)<64,expected,got,d);
  }
}
assert.equal(counts.strict.wrong,0); assert.equal(counts.directional.wrong,0);
for (const m of ['noParity','includeLower','endOnly']) assert(counts[m].wrong>0);
console.log(JSON.stringify({termCount:terms.length,counts,witnesses},null,2));
