import { compileTix, checkLowering } from '../../../../../../dist/tensor/index.js';
const program = compileTix(`fn f(x: f32[N,D]): f32[N] {
  s[i] = sum(k) x[i,k];
  y[i] = s[i] + 1;
  return y;
}`);
console.log(JSON.stringify(await checkLowering(program, 'f')));
