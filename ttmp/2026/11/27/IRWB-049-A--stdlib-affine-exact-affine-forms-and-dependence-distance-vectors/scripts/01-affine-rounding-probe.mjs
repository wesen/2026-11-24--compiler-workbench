// IRWB-049-A script 01: reproduce R3's rounding case on the affine forms as they are today
// (src/tensor/model.ts, built into dist). add(constant(-MAX_SAFE_INTEGER), constant(4503599627370497), 3)
// must have constant 3 * 4503599627370497 - MAX_SAFE_INTEGER, computed exactly; today an intermediate
// rounds, because b.constant * scale and the sums are computed in doubles and only the final
// coefficients are checked for safety.
import { add, constant } from '../../../../../../dist/tensor/model.js';

const a = constant(-Number.MAX_SAFE_INTEGER);
const b = constant(4503599627370497);
const exact = 3n * 4503599627370497n - BigInt(Number.MAX_SAFE_INTEGER);
const got = add(a, b, 3);
console.log('exact  :', exact.toString(), Number.isSafeInteger(Number(exact)));
console.log('add gives:', got.constant, 'safe:', Number.isSafeInteger(got.constant));
console.log(got.constant === Number(exact) ? 'exact' : `WRONG by ${got.constant - Number(exact)}`);
