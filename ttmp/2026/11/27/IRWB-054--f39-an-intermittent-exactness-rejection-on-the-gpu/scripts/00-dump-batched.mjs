// IRWB-054: print the emitted CUDA for the `batched` feature contraction.
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';

const features = compileTix(`
  fn batched(a:f32[B,M,K], b:f32[B,K,N]):f32[B,M,N] { y[z,i,j] = sum(k) a[z,i,k] * b[z,k,j]; return y; }
`);
process.stdout.write(cudaSource(features, 'batched'));
