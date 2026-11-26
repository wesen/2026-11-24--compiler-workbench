// IRWB-004: SHA-256 throughput on a text the size of Candela's revision text (18 MB), for the framework's portable
// implementation, a faster portable one (the candidate for data.ts), and node:crypto; and a check that all three
// agree on random texts, including non-ASCII characters and lone surrogates.
//   node …/05-sha256-bench.mjs [--mb 18]   (prints JSON)
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const { sha256 } = await import(root + 'dist/framework/core/data.js');
const { createHash } = await import('node:crypto');
const args = process.argv.slice(2);
const mb = +(args.includes('--mb') ? args[args.indexOf('--mb') + 1] : 18);

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);
function blocks(h, w, b, start, end) {
  let h0 = h[0], h1 = h[1], h2 = h[2], h3 = h[3], h4 = h[4], h5 = h[5], h6 = h[6], h7 = h[7];
  for (let off = start; off < end; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + 4 * i;
      w[i] = (b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, bb = h1, c = h2, d = h3, e = h4, f = h5, g = h6, k = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (k + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + k) | 0;
  }
  h[0] = h0; h[1] = h1; h[2] = h2; h[3] = h3; h[4] = h4; h[5] = h5; h[6] = h6; h[7] = h7;
}
function fast(text) {
  const enc = new TextEncoder();
  const h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Int32Array(64);
  // stream the text through a fixed buffer: encodeInto fills it, whole blocks are hashed, the rest carried over
  const buf = new Uint8Array(1 << 16);
  let have = 0, total = 0, pos = 0;
  while (pos < text.length) {
    const r = enc.encodeInto(pos === 0 ? text : text.slice(pos), buf.subarray(have));
    pos += r.read; have += r.written; total += r.written;
    const whole = have & ~63;
    blocks(h, w, buf, 0, whole);
    buf.copyWithin(0, whole, have);
    have -= whole;
    if (r.read === 0) break;
  }
  // padding
  const tail = new Uint8Array(((have + 9 + 63) & ~63));
  tail.set(buf.subarray(0, have));
  tail[have] = 0x80;
  const bits = total * 8;
  const dv = new DataView(tail.buffer);
  dv.setUint32(tail.length - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(tail.length - 4, bits >>> 0);
  blocks(h, w, tail, 0, tail.length);
  let out = '';
  for (let i = 0; i < 8; i++) out += (h[i] >>> 0).toString(16).padStart(8, '0');
  return out;
}
const node = t => createHash('sha256').update(t, 'utf8').digest('hex');

// agreement on random texts
let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const alphabet = ['a', '"', '\\', 'é', '€', '𝄞', '\ud800', '\udc00', '\n', '{', '0'];
let agreed = 0;
for (let n = 0; n < 400; n++) {
  const len = Math.floor(rnd() * (n < 300 ? 200 : 70000));
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
  const a = sha256(s), b = fast(s), c = node(s);
  if (a !== b || a !== c) throw new Error(`disagree at n=${n} len=${len}: ${a} ${b} ${c}`);
  agreed++;
}
const unit = '{"id":"v:candela.123","kind":"value","fn":"fn:candela","op":"fadd","args":["v:x.1","v:x.2"],"origin":[]},';
const big = unit.repeat(Math.ceil((mb * 1e6) / unit.length));
const time = f => { const t = performance.now(); const h = f(big); return [Math.round(performance.now() - t), h]; };
const [tOld, hOld] = time(sha256), [tFast, hFast] = time(fast), [tNode, hNode] = time(node);
if (hOld !== hFast || hOld !== hNode) throw new Error('disagree on the big text');
console.log(JSON.stringify({ agreed, chars: big.length, ms: { portable: tOld, fastPortable: tFast, nodeCrypto: tNode },
  MBps: { portable: Math.round(big.length / 1e3 / tOld), fastPortable: Math.round(big.length / 1e3 / tFast), nodeCrypto: Math.round(big.length / 1e3 / tNode) } }));
