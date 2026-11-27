import fs from 'node:fs';
const root = process.argv[2];
const { compileTix } = await import(root + '/dist/tensor/index.js');
const src = fs.readFileSync(root + '/tests/tensor/syntax-check.test.mjs', 'utf8');
const block = src.slice(src.indexOf('const errors = ['), src.indexOf('];\ntest(\'check errors'));
const errors = eval(block.replace('const errors = ', '') + ']');
for (const [source, expected] of errors) {
  let msg = 'NO ERROR';
  try { compileTix(source); } catch (e) { msg = e.message; }
  const [l, c] = msg.split(':').map(Number);
  const line = source.split('\n')[l - 1] ?? '';
  console.log(expected.test(msg) ? 'ok ' : 'XX ', msg, '   @', JSON.stringify(line.slice(c - 1, c + 9)));
}
