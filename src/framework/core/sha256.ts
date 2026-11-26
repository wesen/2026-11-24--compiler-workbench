/**
 * IRWB-004: SHA-256 of text, as the UTF-8 bytes `TextEncoder` gives (a lone surrogate becomes U+FFFD), for
 * identical content addresses in Node and in a browser.
 *
 *   - In Node, `node:crypto` (found through `process.getBuiltinModule`, so no import ties this module to Node).
 *   - Elsewhere, a portable streaming implementation: the text is encoded into a fixed buffer with
 *     `TextEncoder.encodeInto` and hashed block by block, so a large text is never copied into one byte array.
 *
 * Both give the digest the original implementation in data.ts gave (sha256 of `new TextEncoder().encode(text)`).
 * `sha256Parts` hashes the concatenation of several texts without building it.
 */

interface NodeHash {
  update(data: string, encoding: 'utf8'): NodeHash;
  digest(encoding: 'hex'): string;
}
const nodeCrypto: { createHash(algorithm: 'sha256'): NodeHash } | null = (() => {
  try {
    const p = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
    const m = p?.getBuiltinModule?.('node:crypto') as { createHash?: unknown } | undefined;
    return m && typeof m.createHash === 'function' ? (m as { createHash(a: 'sha256'): NodeHash }) : null;
  } catch {
    return null;
  }
})();

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

/** Compress the 64-byte blocks of `b[start, end)` into the state `h`. */
function compress(h: Int32Array, w: Int32Array, b: Uint8Array, start: number, end: number): void {
  let h0 = h[0],
    h1 = h[1],
    h2 = h[2],
    h3 = h[3],
    h4 = h[4],
    h5 = h[5],
    h6 = h[6],
    h7 = h[7];
  for (let off = start; off < end; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + 4 * i;
      w[i] = (b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15],
        y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0,
      c1 = h1,
      c2 = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      k = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (k + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & c1) ^ (a & c2) ^ (c1 & c2))) | 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c2;
      c2 = c1;
      c1 = a;
      a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + c1) | 0;
    h2 = (h2 + c2) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + k) | 0;
  }
  h[0] = h0;
  h[1] = h1;
  h[2] = h2;
  h[3] = h3;
  h[4] = h4;
  h[5] = h5;
  h[6] = h6;
  h[7] = h7;
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * A streaming SHA-256 over text, portable. `update` may be called with any pieces; the digest is that of the UTF-8
 * encoding of their concatenation (a surrogate pair split between two pieces is joined, as in the concatenation).
 */
export class Sha256 {
  #h = new Int32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  #w = new Int32Array(64);
  #buf = new Uint8Array(1 << 16);
  #have = 0;
  #bytes = 0;
  #pending = ''; // a high surrogate that ended the previous piece
  #done = false;
  static #encoder = new TextEncoder();
  update(text: string): this {
    if (this.#done) throw new Error('sha256: update after digest');
    if (this.#pending) {
      text = this.#pending + text;
      this.#pending = '';
    }
    if (text.length && isHigh(text.charCodeAt(text.length - 1))) {
      this.#pending = text[text.length - 1];
      text = text.slice(0, -1);
    }
    let pos = 0;
    while (pos < text.length) {
      // a window that fits the buffer whatever it holds (at most 3 bytes per UTF-16 unit), not the rest of the text:
      // encodeInto on the rest made a browser flatten an 18 MB string once per 64 KiB, about 7 MB/s (IRWB-004)
      let end = Math.min(text.length, pos + Math.floor((this.#buf.length - this.#have) / 3));
      if (end < text.length && isHigh(text.charCodeAt(end - 1))) end--; // keep a surrogate pair together
      const r = Sha256.#encoder.encodeInto(
        pos === 0 && end === text.length ? text : text.slice(pos, end),
        this.#buf.subarray(this.#have),
      );
      pos += r.read;
      this.#have += r.written;
      this.#bytes += r.written;
      const whole = this.#have & ~63;
      if (whole) {
        compress(this.#h, this.#w, this.#buf, 0, whole);
        this.#buf.copyWithin(0, whole, this.#have);
        this.#have -= whole;
      }
      if (r.read === 0) break;
    }
    return this;
  }
  digest(): string {
    if (this.#pending) {
      // the input ended in a lone high surrogate: TextEncoder writes it as U+FFFD (fewer than 64 bytes are buffered)
      const r = Sha256.#encoder.encode(this.#pending);
      this.#pending = '';
      this.#buf.set(r, this.#have);
      this.#have += r.length;
      this.#bytes += r.length;
    }
    this.#done = true;
    const have = this.#have;
    const tail = new Uint8Array((have + 9 + 63) & ~63);
    tail.set(this.#buf.subarray(0, have));
    tail[have] = 0x80;
    const bits = this.#bytes * 8;
    const view = new DataView(tail.buffer);
    view.setUint32(tail.length - 8, Math.floor(bits / 0x100000000));
    view.setUint32(tail.length - 4, bits >>> 0);
    compress(this.#h, this.#w, tail, 0, tail.length);
    let out = '';
    for (let i = 0; i < 8; i++) out += (this.#h[i] >>> 0).toString(16).padStart(8, '0');
    return out;
  }
}

/** SHA-256 of the concatenation of `parts`, as hex. */
export function sha256Parts(parts: readonly string[]): string {
  if (nodeCrypto) {
    // node:crypto encodes each update on its own, so a surrogate pair split between two parts must be joined first
    let split = false;
    for (let i = 0; i + 1 < parts.length; i++) {
      const a = parts[i],
        b = parts[i + 1];
      if (a.length && b.length && isHigh(a.charCodeAt(a.length - 1)) && isLow(b.charCodeAt(0))) split = true;
    }
    const h = nodeCrypto.createHash('sha256');
    if (split) h.update(parts.join(''), 'utf8');
    else for (const p of parts) h.update(p, 'utf8');
    return h.digest('hex');
  }
  const s = new Sha256();
  for (const p of parts) s.update(p);
  return s.digest();
}

/** The portable implementation, whatever the platform (for tests and for measuring it in Node). */
export function sha256Portable(parts: readonly string[]): string {
  const s = new Sha256();
  for (const p of parts) s.update(p);
  return s.digest();
}

/** Which implementation `sha256Parts` uses here. */
export const sha256Implementation: 'node:crypto' | 'portable' = nodeCrypto ? 'node:crypto' : 'portable';
