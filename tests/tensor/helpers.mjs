import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const fr = Math.fround;
export const CORPUS = ['attention', 'conv2d', 'layernorm', 'matmul', 'mlp', 'softmax'];
export const corpusSource = name =>
  fs.readFileSync(fileURLToPath(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url)), 'utf8');

/** A deterministic generator of f32 values in [-4, 4). */
export function values(seed) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return fr((a / 4294967296) * 8 - 4);
  };
}
export function tensor(shape, next) {
  const data = new Float32Array(shape.reduce((a, b) => a * b, 1));
  for (let i = 0; i < data.length; i++) data[i] = next();
  return { shape, data };
}
/** Bit-level equality of two f32 results (NaN equals NaN, 0 differs from -0). */
export const sameBits = (a, b) => a.length === b.length && Array.from(a).every((v, i) => Object.is(v, b[i]));
