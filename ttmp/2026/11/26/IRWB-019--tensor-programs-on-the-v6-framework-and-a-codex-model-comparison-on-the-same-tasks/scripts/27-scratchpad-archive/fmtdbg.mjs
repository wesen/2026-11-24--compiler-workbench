// Which rendered block of a notes.md changes when wrapProse wraps it (blocks() copied from tools/format-corpus.mjs).
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
const R = '/home/manuel/code/wesen/2026-11-24--compiler-workbench';
const { wrapProse, TILE_WIDTH } = await import(R + '/dist/typed/format.js');
const src = fs.readFileSync(R + '/tools/format-corpus.mjs', 'utf8');
const blocks = new Function('return ' + src.slice(src.indexOf('function blocks'), src.indexOf('const width =')))();
const md = fs.readFileSync(process.argv[2], 'utf8'), a = blocks(md), b = blocks(wrapProse(md, TILE_WIDTH));
console.log(a.length, b.length);
for (let i = 0; i < Math.max(a.length, b.length); i++) if (!isDeepStrictEqual(a[i], b[i])) { console.log('before', JSON.stringify(a[i])); console.log('after ', JSON.stringify(b[i])); break; }
