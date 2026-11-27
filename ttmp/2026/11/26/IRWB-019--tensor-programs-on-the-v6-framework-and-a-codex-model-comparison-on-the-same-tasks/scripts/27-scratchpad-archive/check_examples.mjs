const f = Math.fround;
// D/E: ten equal scores, values 1 -> sum of f32(1/10) ten times
let acc = 0; for (let i=0;i<10;i++) acc = f(acc + f(f(1*1)/10));
console.log('D/E 10x0.1 sum:', acc, ' hoisted:', f(10/10));
// H: three equal scores, values [1,1,f32(0.09)], L=3
const vals=[1,1,f(0.09)];
let b=0; for (const v of vals) b = f(b + f(f(1*v)/3));
let u=0; for (const v of vals) u = f(u + f(1*v));
console.log('H before:', b, 'after:', f(u/3));
// C negative control
const e2=Math.exp(-2); console.log('C ref', 32*e2/(32*e2+1), 'bad', 32/33);
// D three-score example f64 ref
const L2=f(Math.log(2)); const w=[Math.exp(0-L2),Math.exp(0-L2),1]; const v=[0,1,1];
console.log('D f64', (w[0]*v[0]+w[1]*v[1]+w[2]*v[2])/(w[0]+w[1]+w[2]));
// score bounds
console.log('A bound', 6.25*Math.sqrt(128), 'B', 16*Math.sqrt(128), 'E', 64*Math.sqrt(128));
console.log('E example shift', -2*(128/Math.sqrt(2)), 'exp(-104) f32', f(Math.exp(-104)), 'exp(-103)',f(Math.exp(-103)));
console.log('D underflow scores', 64*16/8);
