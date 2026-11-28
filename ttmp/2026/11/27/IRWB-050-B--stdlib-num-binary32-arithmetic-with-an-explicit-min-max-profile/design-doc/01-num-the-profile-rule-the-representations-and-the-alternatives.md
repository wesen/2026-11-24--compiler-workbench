---
Title: 'num: the profile rule, the representations, and the alternatives'
Ticket: IRWB-050-B
Status: active
Topics:
    - compiler
    - ir
    - typescript
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/stdlib/num/minmax.ts
      Note: the min/max rule, stated once over a representation, and the two profile names
    - Path: repo://src/stdlib/num/binary32.ts
      Note: binary32 as bit patterns, the operation set, and the bit representation's order
    - Path: repo://src/typed/f32.ts
      Note: Typed's client, which picks 'minimumNumber'
    - Path: repo://src/tensor/evaluate.ts
      Note: Tix's client, which picks 'minimum'
ExternalSources: []
Summary: "Why src/stdlib/num names the min/max profile instead of exporting a max, and how one rule serves two representations."
LastUpdated: 2026-11-27
WhatFor: "Reading the design of the num module before adding operations to it or changing a client's profile."
WhenToUse: "When a domain's floating-point semantics are moved into or out of src/stdlib/num/."
---

# num: the profile rule, the representations, and the alternatives

## Executive Summary

`src/stdlib/num/` holds binary32 arithmetic on IEEE bit patterns and the one operation IEEE 754-2019 leaves open in
two flavours, min and max. The open choice is not defaulted: it is a named profile, written at the call site
(`binary32('minimumNumber')`, `minmax('minimum', NUMBERS)`). Typed's RV32F evaluator asks for `minimumNumber`
(a NaN loses, so `max(NaN, 7)` is 7); Tix's evaluator asks for `minimum` over JavaScript numbers (a NaN
propagates, so `max(NaN, 7)` is NaN) — which is what its `Math.max`/`Math.min` did before the move.

## Problem Statement

Both languages compute in binary32, and both need min and max. IEEE 754-2019 defines four min/max operations and
leaves the choice between the pairs to the language, and the two clients in this repository made opposite choices:

| operation IEEE leaves open | Typed (`src/typed/f32.ts`) | Tix (`src/tensor/evaluate.ts`) |
| --- | --- | --- |
| NaN with a number | `fmin`/`fmax` return the *other* operand (`minimumNumber`/`maximumNumber`, as `fmin.s`/`fmax.s`) | `Math.min`/`Math.max` return NaN (`minimum`/`maximum`) |
| `max(NaN, 7)` | 7 | NaN |
| both NaN | the canonical NaN `0x7fc00000` | NaN |
| `max(-0, +0)` | +0 | +0 |
| `min(-0, +0)` | -0 | -0 |

A shared, unqualified `max` therefore changes one of the two silently: pull Tix's `Math.max` into the library and
Typed's `fmax` stops satisfying RV32F (`fmax(NaN, x)` would be NaN, and candela's `saturate`, whose first step is
`max_num(NaN, 0)`, would report NaN instead of 0); pull Typed's rule over and Tix's meaning checks change on every
program with a `max` reduction over a NaN. The step exists to make that choice impossible to take by accident.

## Proposed Solution

Two files under `src/stdlib/num/`:

**`minmax.ts` — the rule, once.** `minmax(profile, domain)` returns `{ min, max }` for the named profile over a
*representation* `FloatOrder<T>`: `isNaN(x)`, `compare(a, b)` (a total order over the non-NaN values, -0 below +0)
and `nan`. The two profile names are the IEEE 754-2019 operation families they select:

- `'minimumNumber'`: `minimumNumber`/`maximumNumber`. A NaN loses to a number; two NaNs give `domain.nan`.
- `'minimum'`: `minimum`/`maximum`. Any NaN gives `domain.nan`.

Both pairs order -0 below +0, so both give `max(-0, +0) = +0`; the profiles differ on exactly one input family —
a NaN beside a number. The module also exports `NUMBERS`, the representation for JavaScript numbers (values already
rounded to some format: its NaN and zero rules do not depend on the width, so Tix uses it at both f32 and f64).

**`binary32.ts` — the format.** `fromBits`/`toBits`/`isNaNBits`/`CANONICAL_NAN` (the representation Typed carries:
an f32 is its bits in a signed i32, so NaN payloads and the sign of zero are exact), `BITS` (that representation as
a `FloatOrder`), and `binary32(profile)` — the operation set: add, sub, mul, div (one `Math.fround` of the exact
double result, which is RV32F's round-to-nearest-even), sqrt, floor, ceil, trunc, the saturating `toInt`/`toUnsigned`,
`fromInt`/`fromUnsigned`, sign operations that touch only the sign bit, the six comparisons, copysign, and min/max
from the profile. Operation names are neutral; the IR opcodes (`fadd`, `fmin`, …) stay in `src/typed/f32.ts`.

So the clients are: `src/typed/f32.ts` builds its three opcode tables from `binary32('minimumNumber')` and re-exports
the helpers (its public surface and every internal import are unchanged); `src/tensor/evaluate.ts` builds
`MINMAX = minmax('minimum', NUMBERS)` and uses it for the elementwise `max`/`min` ops and for the `max` reduction.
Both old copies are gone: Typed's `minmax`/`order` helpers and its tables moved, Tix's `Math.max`/`Math.min` are
replaced.

## Design Decisions

**The profile is a parameter, not a default.** There is no `max` export. Each client writes its choice once, at the
place where its semantics are decided (`binary32('minimumNumber')`, `minmax('minimum', NUMBERS)`), so a later
"tidy-up" that unifies the names has to delete an argument rather than change a behaviour.

**The rule is generic over a representation, and the two representations are one rule.** Stating the rule twice
(once on bit patterns as Typed already did, once on numbers as Tix does) is the duplication this library exists to
prevent. `FloatOrder<T>` is the smallest interface both need — NaN test, total order, own NaN — and it is a shape
interface, not a domain type, which is the admission rule. The bit representation supplies `order(bits)`, a monotone
key over the non-NaN patterns (-0 → -1 sorts below +0 → 0); the number representation supplies a compare that
distinguishes -0 from +0 with `Object.is`. `tests/stdlib/num.test.mjs` pins them to each other on every pair of
special values.

**The bit representation stays the bit representation.** Typed could have been moved to numbers (`toBits(profile.max(fromBits(a), fromBits(b)))`), but its NaN payload rules (`fneg`/`fabs`/`fcopysign` keep a payload) and its
canonical-NaN rule for arithmetic are properties of the pattern, and a round trip through a double would make the
result depend on `toBits` instead of on the operation. Comparing the patterns directly is the same rule with no
conversion.

**A NaN result is the canonical NaN.** Under `'minimum'` the bit set returns `CANONICAL_NAN`, not the payloaded NaN
operand — the module's rule for every NaN result, and what Typed's arithmetic already did. For numbers the canonical
NaN and any other NaN are the same value, so Tix is unaffected.

**Typed's opcode tables stay in Typed.** `fadd`, `fmin`, `f2u` are this IR's names, and `F32_RESULT`,
`F32_OPERANDS`, `F32_FOLDABLE` are this compiler's policy (which operators produce f32, which fold at compile time).
The library holds operations, the domain holds its vocabulary. `f32Op` (the name-keyed dispatcher) stays in
`src/typed/f32.ts` for the same reason, which also keeps every existing import and the module's public surface
unchanged.

## Alternatives Considered

**One unqualified `max`/`min` in the library, both clients on it.** Simplest, and it changes one client: Typed's
`fmax(NaN, 7)` becomes NaN and candela's `saturate` (probe: `max_num(NaN, 0)`) changes its meaning, or Tix's max
reductions propagate less. This is the trap the step names; rejected outright.

**Profiles named after the clients (`'rv32f'`, `'javascript'`).** Rejected: a profile names the rule, and the same
rule can be a client's for reasons other than its target (Typed could switch to `minimum` and still be RV32-compatible
if the backend emitted the C-style min/max sequence). `minimumNumber`/`minimum` name what is actually chosen, and
the report can say which client chose what.

**A single number-level operation set, with Typed going through numbers.** Rejected above: it loses the pattern-level
NaN payload rules and makes arithmetic results depend on a conversion.

**Two copies of the rule (bits and numbers), each small.** Rejected: it is exactly the duplication the library is
for, and the pair that must agree would have no single place to disagree in.

**Returning `Math.max`/`Math.min` themselves for the `'minimum'` profile over `NUMBERS`.** The rule *is* JavaScript's,
and `Math.max` is a JIT intrinsic: measured at 2.4 ns per pair against 11–14 ns for the library's closure
(probe 04). Rejected: the number representation would then bypass the rule, and "the two representations are one
rule" would no longer be an invariant a test can hold — the fast path would be the thing under test. The measured
cost of not special-casing it is inside the noise of the corpus measurement (probe 03: 1.02–1.30× on two programs,
whose own run-to-run spread is that wide) and is stated in the report.

## Implementation Plan

Done in this session (see the report and the diary):

1. `src/stdlib/num/minmax.ts`, `src/stdlib/num/binary32.ts`; re-exported from `src/stdlib/index.ts`; the index's
   "what exists now" gains `num/`.
2. `src/typed/f32.ts` builds its tables from `binary32('minimumNumber')` and re-exports the helpers; its `minmax`,
   `order`, `round`, `toInt` and the operation implementations are deleted.
3. `src/tensor/evaluate.ts` uses `minmax('minimum', NUMBERS)` for `max`/`min` and for the `max` reduction; its
   `Math.max`/`Math.min` are deleted.
4. `tests/stdlib/num.test.mjs`: each operation under each profile on the special values, the two disagreeing inputs,
   the two representations against each other, and both clients end to end.
5. Baselines and the five suites, unchanged.

## Open Questions

- Is `FloatOrder.compare`'s "tie returns `a`" a rule or an accident? Both representations make a tie mean *the same
  value*, so returning either is unobservable; the module returns `a` because the sweep it replaces did. If a third
  representation ever orders more coarsely (a total order on equivalence classes), it would have to be revisited.
- `binary32.ts` exports the operation set as a factory rather than constants, so the profile is visible at each
  construction. If a third client ever needs a second profile at run time (a flag deciding min/max semantics), the
  per-call string test in `minmax`'s closure is the thing to hoist; today both clients construct one set at module
  load.

## References

- IEEE 754-2019 §5.3.1, §9.6 (`minimum`, `minimumNumber`, `maximum`, `maximumNumber`).
- RISC-V unprivileged ISA, `fmin.s`/`fmax.s`; `vendor/ds-js-os/compiler/rv32/emit/floats.js` for the reference
  compiler's instruction sequence.
- IRWB-039 design doc, phase 2 (the admission rule and the layering D).
- IRWB-046-B (the library skeleton and the first primitive, whose client-and-delete pattern this step follows).
