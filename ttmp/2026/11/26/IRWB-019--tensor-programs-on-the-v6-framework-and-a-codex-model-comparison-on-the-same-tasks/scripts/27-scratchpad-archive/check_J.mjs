const f = Math.fround;
const v=[1,1,3]; let b=0; for (const x of v) b=f(b+f(f(1*x)/3));
let u=0; for (const x of v) u=f(u+f(1*x)); console.log(b, f(u/3));
const e=Math.exp(-1); console.log((4*e-1)/(2*e+1), (e*1+e*3+1*-1)/(e+e+1));
