const f=Math.fround;
let seed=7; const rnd=()=>{seed=(seed*1103515245+12345)%2147483648; return seed/2147483648;};
let diffs=0, trials=200;
for(let t=0;t<trials;t++){
  const N=64; const u=[]; for(let j=0;j<N;j++) u.push(f(rnd()*8-4));
  // plain
  let M=-Infinity; for(const x of u) M=Math.max(M,x);
  let l=0; for(const x of u) l=f(l+f(Math.exp(f(x-M))));
  // per-element fold with softmax_state combine: state (m,l), elem (u,1)
  let m=-Infinity, L=0;
  for(const x of u){ const c=Math.max(m,x); const a=f(Math.exp(f(m-c))); const b=f(Math.exp(f(x-c))); L=f(f(L*a)+f(1*b)); m=c; }
  if(L!==l) diffs++;
}
console.log('per-element fold differs from plain in', diffs, 'of', trials);
// unit combine unit
const c=Math.max(-Infinity,-Infinity); console.log('exp(-inf-(-inf))=', Math.exp(-Infinity-c));
