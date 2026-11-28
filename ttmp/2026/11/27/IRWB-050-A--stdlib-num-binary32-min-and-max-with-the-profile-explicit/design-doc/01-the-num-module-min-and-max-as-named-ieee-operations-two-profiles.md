# The num module: min and max as named IEEE operations, two profiles

## The problem

Typed and Tix both compute in IEEE 754 binary32, but they follow different rules for the operations
the standard leaves open. `min`/`max` is where the two compilers disagree today:

- **Typed** (`src/typed/f32.ts`, `F32_BINARY.fmin/fmax`, following RV32F `fmin.s`/`fmax.s`): the
  other operand when one is a NaN, the canonical NaN when both are, and −0 ordered below +0 —
  IEEE 754-2019 `minimumNumber`/`maximumNumber`.
- **Tix** (`src/tensor/evaluate.ts`, its `operations` table and the `max` reduction): JavaScript's
  `Math.max`/`Math.min`, which propagate NaN — IEEE 754-2019 `maximum`/`minimum` (with the
  ECMAScript zero-sign choice, which orders −0 below +0 as well).

A shared unqualified `max` in a library would silently change one of the two: `max(NaN, 7)` is 7
under the first rule and NaN under the second. This step moves the operation into `src/stdlib/num/`
with the choice made explicit as **named operations** — IEEE 754-2019's own names — so no client can
pick a rule without naming it.

## The interface

One module, `src/stdlib/num/minmax.ts`, pure and synchronous, over the smallest shape interface
there is: an IEEE 754 value carried as a JavaScript number. Four operations:

- `maximumNumber(a, b)` / `minimumNumber(a, b)` — the RV32F profile. A NaN operand yields the other
  operand (both NaN: NaN, which Typed canonicalizes to `0x7fc00000` at its bits↔number boundary);
  otherwise the larger/smaller operand by numeric order, with −0 below +0.
- `maximum(a, b)` / `minimum(a, b)` — the JavaScript profile: NaN propagates; otherwise
  `Math.max`/`Math.min` exactly (which also orders −0 below +0).

The operations never round — they return one of their operands — so one implementation serves every
format the two compilers carry exactly in a number: binary32 (both domains' f32) and binary64 (Tix's
f64 mode, whose ops table is shared with f32). No precision is baked into the module.

## The clients

- **Typed** keeps its bit-pattern representation (`f32.ts`'s contract with the evaluator) and calls
  the library across its bits↔number boundary: `fmax: (a, b) => toBits(maximumNumber(fromBits(a),
  fromBits(b)))`. The boundary is exact for non-NaN values (f32 ⊂ f64), maps every NaN to the number
  NaN, and `toBits(NaN)` is the canonical NaN — so the profile's rules and Typed's NaN bits are kept
  exactly. The old `order`/`minmax` helpers are deleted.
- **Tix** names its profile in the ops table (`max: maximum, min: minimum`) and in the `max`
  reduction; `Math.max`/`Math.min` are deleted from `evaluate.ts`. Because `maximum`/`minimum` are
  `Math.max`/`Math.min` on every input (asserted by test), both precisions keep their behaviour.

## Why only min/max, not all of binary32 arithmetic

The brief says "binary32 arithmetic", but the code both domains share *as operations with a rule*
is the min/max family. Moving `+ − * /` would move no code and admit a wrong client:

- Tix's ops table is **precision-generic** (f32 and f64 share it; rounding happens outside the op,
  via the `round` closure). A library binary32 add that rounds internally (the only interesting
  behaviour to move) would break Tix's f64 mode, and one that does not is `a + b` itself.
- Typed computes add/sub/mul/div on **bit patterns**; a number-level library add would force two
  bit↔number conversions per operation in its hot meaning-check evaluator, with Typed as the only
  client — which fails the admission rule (a module needs two clients).

So the module moves exactly the family with a choice to make explicit, and the profile is the name.

## Alternatives considered

- **A profile object** (`num.max = { rv32f, js }`) — rejected: the client then writes
  `max.rv32f(a, b)`, and the rule is one rename away from `max.js`; IEEE's operation names carry the
  rule in themselves and make the trap greppable.
- **Bit-level operations** (the library taking f32 bit patterns, Typed's representation) —
  rejected: bits are Typed's storage choice, not a small shape interface; Tix would never call it.

## Speed

Tix's evaluator runs inside every meaning check, so `01-evaluator-speed.mjs` (ticket `scripts/`)
measures `evaluate` on the corpus program `attention` (the one with a `max` reduction) before and
after; `02-minmax-micro.mjs` isolates the per-call cost of the four library operations against
`Math.max`/`Math.min` in the same process. The max path is a small share of `attention`'s work
(~1k of ~100k operations per run), so the evaluator probe bounds the total effect and the
micro-probe resolves it.
