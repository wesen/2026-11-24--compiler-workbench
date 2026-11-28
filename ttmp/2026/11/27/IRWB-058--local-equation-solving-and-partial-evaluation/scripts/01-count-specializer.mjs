import { readFileSync } from 'node:fs';

const lines = path =>
  readFileSync(new URL(`../../../../../../src/typed/${path}`, import.meta.url), 'utf8').split('\n').length -
  1;
const files = Object.fromEntries(['specialize.ts', 'pe.ts'].map(path => [path, lines(path)]));
console.log({ ...files, total: Object.values(files).reduce((sum, count) => sum + count, 0) });
