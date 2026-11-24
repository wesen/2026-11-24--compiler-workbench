/** Canonical finite JSON. Rejects values that would make persistent keys ambiguous. */
export function canonical(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(v: unknown): string {
    if (v === null) return 'null';
    if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('IR data must contain only finite numbers');
      return Object.is(v, -0) ? '0' : String(v);
    }
    if (typeof v !== 'object') throw new Error(`IR data cannot contain ${typeof v}`);
    if (ancestors.has(v)) throw new Error('IR data cannot contain cycles');
    const prototype = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && prototype !== Object.prototype && prototype !== null) {
      throw new Error('IR data must be plain records or arrays');
    }
    ancestors.add(v);
    let result: string;
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length) throw new Error('IR arrays cannot be sparse or have extra properties');
      if (Object.getOwnPropertySymbols(v).length) throw new Error('IR arrays cannot contain symbol keys');
      const entries:string[]=[];
      for(let i=0;i<v.length;i++) {
        const descriptor=Object.getOwnPropertyDescriptor(v,String(i));
        if(!descriptor || !('value' in descriptor)) throw new Error('IR arrays require own data elements without holes or accessors');
        entries.push(encode(descriptor.value));
      }
      result = '[' + entries.join(',') + ']';
    } else {
      if (Object.getOwnPropertySymbols(v).length) throw new Error('IR data cannot contain symbol keys');
      result = '{' + Object.keys(v).sort().map(k => {
        const descriptor = Object.getOwnPropertyDescriptor(v, k)!;
        if (!('value' in descriptor)) throw new Error('IR data cannot contain accessors');
        return JSON.stringify(k) + ':' + encode(descriptor.value);
      }).join(',') + '}';
    }
    ancestors.delete(v);
    return result;
  }
  return encode(value);
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function immutable<T>(value: T): T { return deepFreeze(JSON.parse(canonical(value)) as T); }

const K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];
function rotr(v: number, bits: number): number { return (v >>> bits) | (v << (32 - bits)); }

/** Portable SHA-256 for identical browser/Node content addresses; no platform or npm dependency. */
export function sha256(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(length);
  padded.set(bytes); padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = bytes.length * 8;
  view.setUint32(length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(length - 4, bits >>> 0);
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const w = new Uint32Array(64);
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = w[i - 16] + (rotr(a,7) ^ rotr(a,18) ^ (a >>> 3)) + w[i - 7] + (rotr(b,17) ^ rotr(b,19) ^ (b >>> 10));
    }
    let [a,b,c,d,e,f,g,j] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (j + (rotr(e,6)^rotr(e,11)^rotr(e,25)) + ((e&f)^(~e&g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a,2)^rotr(a,13)^rotr(a,22)) + ((a&b)^(a&c)^(b&c))) | 0;
      j=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    const v = [a,b,c,d,e,f,g,j];
    for(let i=0;i<8;i++) h[i]=(h[i]+v[i])|0;
  }
  return h.map(x => (x >>> 0).toString(16).padStart(8,'0')).join('');
}

export function fingerprint(value: unknown): string { return sha256(canonical(value)); }
