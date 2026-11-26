// IRWB-004: the definition-preserving caches and shortcuts. Each test compares the new path with the old definition.
//   - sha256 (node:crypto in Node, a streaming portable implementation elsewhere) equals the original portable one;
//   - revisionOf(kind, schemaVersion, value) equals fingerprint({ kind, schemaVersion, value });
//   - validateOnce runs a validator once per canonical value, and again for a value that failed;
//   - an edit with no operations makes applyPass return the input unchanged, as preparing it did.
import test from 'node:test';
import assert from 'node:assert/strict';

const D = await import('../../dist/framework/core/data.js');
const H = await import('../../dist/framework/core/sha256.js');

// the implementation data.ts had before IRWB-004, kept here as the reference the new ones must equal
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
];
const rotr = (v, b) => (v >>> b) | (v << (32 - b));
function reference(text) {
  const bytes = new TextEncoder().encode(text);
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(length);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = bytes.length * 8;
  view.setUint32(length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(length - 4, bits >>> 0);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, j] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (j + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      j = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    const v = [a, b, c, d, e, f, g, j];
    for (let i = 0; i < 8; i++) h[i] = (h[i] + v[i]) | 0;
  }
  return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

let seed = 12345;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
const ALPHABET = ['a', 'Z', '"', '\\', 'é', '€', '𝄞', '\ud800', '\udbff', '\udc00', '\n', '{', '0', ' '];
const randomText = max => {
  const n = Math.floor(rnd() * max);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
  return s;
};

test('IRWB-004 A6: sha256, the portable streaming SHA-256 and pieces equal the original implementation', () => {
  assert.equal(D.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(D.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (let n = 0; n < 300; n++) {
    const text = randomText(n < 250 ? 300 : 140000);
    const want = reference(text);
    assert.equal(D.sha256(text), want, `sha256 (${H.sha256Implementation}), text ${n}`);
    assert.equal(H.sha256Portable([text]), want, `portable, text ${n}`);
    // the same text in random pieces, cutting anywhere (including between the two halves of a surrogate pair)
    const pieces = [];
    for (let at = 0; at < text.length; ) {
      const len = Math.floor(rnd() * 70000) + 1;
      pieces.push(text.slice(at, at + len));
      at += len;
    }
    assert.equal(H.sha256Parts(pieces), want, `pieces, text ${n}`);
    assert.equal(H.sha256Portable(pieces), want, `portable pieces, text ${n}`);
  }
  // a pair split exactly at a boundary, and a lone high surrogate at the very end
  assert.equal(H.sha256Parts(['x\ud834', '\udd1ey']), reference('x𝄞y'));
  assert.equal(H.sha256Portable(['x\ud834', '\udd1ey']), reference('x𝄞y'));
  assert.equal(H.sha256Portable(['tail\ud834']), reference('tail\ud834'));
});

const randomValue = depth => {
  const r = rnd();
  if (depth > 3 || r < 0.3) return [null, true, 1.5, -0, 42, 'text', randomText(20)][Math.floor(rnd() * 7)];
  if (r < 0.6) return Array.from({ length: Math.floor(rnd() * 5) }, () => randomValue(depth + 1));
  return Object.fromEntries(Array.from({ length: Math.floor(rnd() * 6) }, () => [randomText(6), randomValue(depth + 1)]));
};

test('IRWB-004 A2: revisionOf equals fingerprint of { kind, schemaVersion, value }, canonical or not', () => {
  for (let n = 0; n < 400; n++) {
    const raw = { tables: randomValue(0), big: 'x'.repeat(n * 30), n };
    const want = D.fingerprint({ kind: 'k.ind', schemaVersion: '1', value: raw });
    assert.equal(D.revisionOf('k.ind', '1', raw), want, `plain value ${n}`);
    const frozen = D.immutable(raw);
    assert.equal(D.revisionOf('k.ind', '1', frozen), want, `canonical value ${n}`);
    assert.equal(D.revisionOf('k.ind', '1', frozen), want, `cached ${n}`);
    assert.equal(D.revisionOf('other', '2', frozen), D.fingerprint({ kind: 'other', schemaVersion: '2', value: frozen }));
  }
  assert.throws(() => D.revisionOf('k', '1', { bad: Infinity }), /finite/);
});

test('IRWB-004 A3: validateOnce validates a canonical value once per validator, and a failed one again', () => {
  let calls = 0;
  const validator = v => {
    calls++;
    if (v.bad) throw new Error('bad value');
  };
  const good = D.immutable({ a: [1, 2, 3] });
  D.validateOnce(validator, good);
  D.validateOnce(validator, good);
  assert.equal(calls, 1);
  const other = v => (calls += 10);
  D.validateOnce(other, good);
  assert.equal(calls, 11, 'another validator runs on its own');
  const bad = D.immutable({ bad: true });
  assert.throws(() => D.validateOnce(validator, bad), /bad value/);
  assert.throws(() => D.validateOnce(validator, bad), /bad value/);
  assert.equal(calls, 13);
  const plain = { a: 1 };
  D.validateOnce(validator, plain);
  D.validateOnce(validator, plain);
  assert.equal(calls, 15, 'a value that is not canonical is validated every time');
  const self = { seen: 0, check(v) { this.seen++; } };
  D.validateOnce(self.check, D.immutable({ z: 1 }), undefined, self);
  assert.equal(self.seen, 1, 'thisArg is the validator\'s owner');
});

test('IRWB-004 A1: a pass whose edit records nothing returns its input, unchanged', async () => {
  const { installVendor } = await import('../../tools/node-vendor.mjs');
  await installVendor();
  const { projectFiles } = await import('../../tools/corpus.mjs');
  const { projectSource, ingestProject } = await import('../../dist/typed/project.js');
  const { PASSES } = await import('../../dist/typed/passes.js');
  const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');
  const { applyPass } = await import('../../dist/framework/passes/index.js');
  const r0 = ingestProject(projectSource('blend', projectFiles('blend')));
  const r = await applyPass(PASSES.strength, r0, { manager: new AnalysisManager() });
  assert.equal(r.changed, false);
  assert.equal(r.artifact, r0, 'the input itself');
  assert.equal(r.edits, 0);
});
