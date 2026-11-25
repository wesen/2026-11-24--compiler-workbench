// A small Typed program over f32: one function per operation whose edge cases matter (NaN, -0, ±∞, saturation,
// rounding direction), plus the shapes the float-safety tests rewrite (x + 0, x * 0, x - x, !(a < b)).
export const F32_FIXTURE = `
function addZero(x: f32): f32 { return x + 0.0; }
function mulZero(x: f32): f32 { return x * 0.0; }
function subSelf(x: f32): f32 { return x - x; }
function notLess(a: f32, b: f32): i32 { if (!(a < b)) { return 1; } return 0; }
function lo(a: f32, b: f32): f32 { return Math.min(a, b); }
function hi(a: f32, b: f32): f32 { return Math.max(a, b); }
function sum(a: f32, b: f32): f32 { return a + b; }
function quot(a: f32, b: f32): f32 { return a / b; }
function sign(a: f32, b: f32): f32 { return Math.copysign(a, b); }
function eq(a: f32, b: f32): i32 { if (a === b) { return 1; } return 0; }
function ne(a: f32, b: f32): i32 { if (a !== b) { return 1; } return 0; }
function le(a: f32, b: f32): i32 { if (a <= b) { return 1; } return 0; }
function toInt(x: f32): i32 { return i32(x); }
function toUnsigned(x: f32): u32 { return u32(x); }
function down(x: f32): f32 { return Math.floor(x); }
function up(x: f32): f32 { return Math.ceil(x); }
function chop(x: f32): f32 { return Math.trunc(x); }
function root(x: f32): f32 { return Math.sqrt(x); }
function magnitude(x: f32): f32 { return Math.abs(x); }
function negate(x: f32): f32 { return -x; }
function bits(x: f32): i32 { return Math.bitsOf(x); }
function fromBits(i: i32): f32 { return Math.fromBits(i); }
function widen(i: i32): f32 { return f32(i); }
function widenUnsigned(i: u32): f32 { return f32(i); }
function tenth(): f32 { return 0.1 + 0.2; }
function third(): f32 { return 1.0 / 3.0; }
function floorConst(): f32 { return Math.floor(2.5); }
function scale(n: i32, a: f32, b: f32): f32 {
    let s: f32 = 0.0;
    for (let i: i32 = 0; i < n; i = i + 1) { s = s + a * b; }
    return s;
}
`;
