// Typed programs for the f32 backend's conventions: record results with leaves in registers and in stack words, a
// pass-through and a swapped record return, f32 arguments beyond fa7 (in x registers, then stack words), f32 values
// kept across calls (callee-saved fs registers), frame arrays (aaddr, zero) and checked f32 buffer accesses (caddr).
export const CONVENTION_FIXTURE = `
value record Big {
    a: f32;
    b: f32;
    c: f32;
    d: f32;
    e: f32;
    f: f32;
    g: f32;
    h: f32;
    i: f32;
    j: f32;
    k: i32;
    ok: bool;
}
value record Pair {
    x: f32;
    y: f32;
}
function big(x: f32, n: i32): Big {
    return Big(x, x + 1.0, x * 2.0, -x, x - 3.0, x / 4.0, Math.sqrt(x), Math.abs(x), Math.floor(x), Math.ceil(x), n * 3, x < 1.0);
}
function bigSum(x: f32, n: i32): f32 {
    const r: Big = big(x, n);
    let s: f32 = r.a + r.b + r.c + r.d + r.e + r.f + r.g + r.h + r.i + r.j + f32(r.k);
    if (r.ok) { s = s + 100.0; }
    return s;
}
function passBig(x: f32, n: i32): Big {
    return big(x + 1.0, n - 1);
}
function passBigSum(x: f32, n: i32): f32 {
    const r: Big = passBig(x, n);
    return r.a + r.j + f32(r.k);
}
function swapPair(x: f32, y: f32): Pair {
    return Pair(y, x);
}
function swapTwice(x: f32, y: f32): Pair {
    const p: Pair = swapPair(x, y);
    return Pair(p.y, p.x);
}
function many(a: f32, b: f32, c: f32, d: f32, e: f32, f: f32, g: f32, h: f32, i: f32, j: f32, k: f32, n: i32, m: i32): f32 {
    return a - b + c - d + e - f + g - h + i * 2.0 - j * 3.0 + k * 5.0 + f32(n) - f32(m);
}
function manyCall(x: f32, n: i32): f32 {
    return many(x, x + 1.0, x + 2.0, x + 3.0, x + 4.0, x + 5.0, x + 6.0, x + 7.0, x + 8.0, x + 9.0, x + 10.0, n, n + 1);
}
function wide(a: i32, b: i32, c: i32, d: i32, e: i32, f: i32, g: i32, h: i32, i: i32, p: f32, q: f32, r: f32, s: f32, t: f32, u: f32, v: f32, w: f32, x: f32, y: f32): f32 {
    return f32(a + b + c + d + e + f + g + h) * 0.5 + f32(i) + (p + q + r + s + t + u + v + w) * 0.25 + x - y;
}
function wideCall(x: f32, n: i32): f32 {
    return wide(n, n + 1, n + 2, n + 3, n + 4, n + 5, n + 6, n + 7, n + 8, x, x * 2.0, x * 3.0, x * 4.0, x * 5.0, x * 6.0, x * 7.0, x * 8.0, x * 9.0, 0.0);
}
function half(x: f32): f32 {
    return x * 0.5;
}
function keep(x: f32, y: f32): f32 {
    const a: f32 = x * y;
    const b: f32 = x + y;
    const c: f32 = half(x);
    const d: f32 = half(y);
    return a - b + c * d;
}
function sumArray(n: i32): i32 {
    const s = new Int32Array(8);
    s[0] = n;
    s[3] = n * 2;
    let t: i32 = 0;
    for (let i: i32 = 0; i < 8; i = i + 1) { t = t + s[i]; }
    return t;
}
function sumBigArray(n: i32, k: i32): i32 {
    const s = new Int32Array(40);
    s[k & 31] = n;
    let t: i32 = 0;
    for (let i: i32 = 0; i < 40; i = i + 1) { t = t + s[i] * (i + 1); }
    return t;
}
function at(b: buffer, i: i32): f32 {
    return b.getF32(i);
}
function scaleBuffer(b: buffer, n: i32, f: f32): f32 {
    let s: f32 = 0.0;
    for (let i: i32 = 0; i < n; i = i + 1) {
        const v: f32 = b.getF32(i) * f;
        b.setF32(i, v);
        s = s + v;
    }
    return s;
}
`;
