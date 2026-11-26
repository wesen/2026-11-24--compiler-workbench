import assert from 'node:assert/strict';
import { seededRandom } from '../../../../../../dist/framework/contracts/differential.js';

const f = Math.fround;
const rng = seededRandom(5);
const fold = (xs, head = 0) => xs.reduce((acc, x) => f(acc + x), head);
function attempt(row, chunkSize) {
  // The CPU uses a deterministic prefix order on chunk totals as the guess.
  // Verifying guessed carries does not depend on how they were obtained.
  const chunks = [];
  for (let j = 0; j < row.length; j += chunkSize) chunks.push(row.subarray(j, j + chunkSize));
  const guesses = [0];
  for (const values of chunks) guesses.push(f(guesses.at(-1) + fold(values)));

  const verified = chunks.every((values, i) => Object.is(fold(values, guesses[i]), guesses[i + 1]));
  return { verified, value: guesses.at(-1) };
}

const profiles = {
  uniform: () => 0,
  narrow: () => 0.2 * rng() - 0.1,
  broad: () => 36 * rng() - 18,
  peaked: j => j === 0 ? 0 : -17,
};
for (const n of [128, 1024, 4096]) for (const [name, profile] of Object.entries(profiles)) {
  const trials = 384;
  const counts = Object.fromEntries([8, 32, 128, 256].filter(c => c < n)
    .map(c => [c, { fullyVerified: 0, finalWordMatched: 0 }]));
  for (let r = 0; r < trials; r++) {
    const x = Float32Array.from({ length: n }, (_, j) => profile(j));
    const max = x.reduce((a, b) => Math.max(a, b), -Infinity);
    const e = Float32Array.from(x, v => f(Math.exp(f(v - max))));
    const reference = fold(e);
    for (const [c, count] of Object.entries(counts)) {
      const proposal = attempt(e, Number(c));
      const last = Object.is(proposal.value, reference);
      if (proposal.verified) {
        assert.equal(last, true);
        count.fullyVerified++;
      }
      if (last) count.finalWordMatched++;
    }
  }
  console.log(JSON.stringify({ test: 'softmax-denominator-chunks', n, profile: name, trials, counts }));
}
const witness = Float32Array.of(1, f(Math.exp(-17)), f(Math.exp(-17)), f(Math.exp(-17)));
const reassociated = attempt(witness, 2);
assert.equal(reassociated.verified, false);
assert.equal(fold(witness), 1);
assert.equal(reassociated.value, 1 + 2 ** -23);
console.log(JSON.stringify({ test: 'denominator-half-ulp-witness', fold: fold(witness), ...reassociated }));
