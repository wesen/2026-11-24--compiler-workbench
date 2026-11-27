const f = Math.fround;
const v=[1,1,-0.25]; let b=0; for (const x of v) b=f(b+f(f(1*x)/3));
let u=0; for (const x of v) u=f(u+f(1*x)); console.log(b, f(u/3));
const t=f(2**-24); console.log(f(f(1+t)+t), f(1+f(t+t)));
