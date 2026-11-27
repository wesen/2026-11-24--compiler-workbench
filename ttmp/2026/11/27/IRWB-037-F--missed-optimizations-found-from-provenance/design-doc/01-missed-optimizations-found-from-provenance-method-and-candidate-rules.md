---
Title: 'Missed optimizations found from provenance: method and candidate rules'
Ticket: IRWB-037-F
Status: active
Topics:
    - compiler
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Hot statements with provenance and a shape census, three findings (dominated bounds checks, bcm missing from speed, constant reassociation), and the changes to make
LastUpdated: 2026-11-27T12:41:35.925611701-05:00
WhatFor: ""
WhenToUse: ""
---

# Missed optimizations found from provenance: method and candidate rules

## Goal and input domain

Find executed RV32 instructions that no pass or rule improves, explain the code shapes behind the gap to the
reference compiler (regex first, then LZ), and add verified rules or checked pass changes that remove them.
The domain is the Typed corpus (`corpus/projects/`) under the `speed` pipeline (and O2 for the report), with
the instruction counts the tickets used: regex `[a-c]*[b-d]*a*d` over `abccabbd` (default backend options), LZ
100 seed-7 round trips and chess quiet-mate-in-two at depth 3 (both with chains, coalesce, homes).

## Starting point, measured (`scripts/01-bench-three.mjs`, `various/bench-before.json`)

| Benchmark | r0 | speed, default options | speed, tuned | reference |
| --- | ---: | ---: | ---: | ---: |
| regex | 8,183 | 6,933 | 5,405 | 6,628 |
| LZ | 185,876 | 159,079 | 156,782 | 156,405 |
| chess | 14,804,396 | | 10,038,193 | 10,827,760 |

D1 took the regex from 8,040 to 6,933. The remaining gaps: regex +305 with default options, LZ +377 tuned.

## Method

1. **Hot statements with provenance** (extension of D1's attribution). `hotSites(revisions, call)` in
   `src/typed/attribute.ts`: for the last revision of a chain, each statement's executed instructions, its machine
   instructions with counts, its ancestor at r0 (through statement origins) with the ancestor's count, and every
   edit of the chain naming it or an ancestor. `tools/attribute.mjs ... --hot N`. A hot statement whose count did
   not fall, or whose decisions are only `retarget`/`move`, is code no pass improved. `--reference` adds the
   reference image's instructions per function and its hottest instructions, for reading the same loop side by side.
   - Alternative: D1's step table alone. It answers "what did each pass do", not "what is left"; the residue is
     what this task needs.
2. **Shape census** (`scripts/02-shape-census.mjs`): every value-tree node of executed statements over the corpus,
   weighted by how often its statement runs, grouped by operator over operand operators. It ranks rule-shaped
   opportunities across projects instead of one benchmark.
3. Candidate rules are written in the rule language (`rules/form.ts`), verified with `verifyRule`, and kept only if
   the corpus measurement says they pay.

## Findings (from the tool's output on regex and LZ)

**F1. Dominated bounds checks (regex).** `current[first]` is read and then written, `next[state]` read then
written, `current[state] = next[state]; next[state] = 0`: each access has its own `if (i >=u 9) trap`, and the
second check of the same index is dominated by the first's fall-through. bce only removes checks against a
buffer's length proven by a dominating `lt`. Checks in the benchmark: s:144 (52), s:162 (38), s:242 (128), s:247
(128), 346 instructions with default options (each check is `addi` + branch there; one instruction with homes).

**F2. bcm is in no pipeline (LZ).** `hash3(input[p], input[p+1], input[p+2])` inlined into `compress` makes three
checked text addresses in one block; bcm (IRWB-001) merges them into one check, but only Candela's experiments ran
it. Measured: `speed` with bcm after bce takes LZ tuned from 156,782 to 148,250.

**F3. Constants inside addresses (LZ after bcm, f32-dsp, regex).** bcm writes `caddr(r, p + Δ) - 2Δ`; after subst
that is `caddr(input, ((p + 1) + -1)) + 2` and `input + ((p + 2) << 1)`. The backend folds a constant into a load
or store offset only when it is the outermost `+ c` of the address. Three reassociation identities move constants
outwards: `(x + a) + b → x + (a+b)`, `(x + a) << k → (x << k) + (a << k)`, `y + (x + c) → (y + x) + c`.

**Seen, not addressed:** constants rebuilt in loops with default options (`addi rX, zero, 9` before every
check; the `homes` option already does this), the buffer length reloaded by every `caddr` (the reference keeps it
in a register), `x * 5` in the closure loop (the reference holds 5 in a register), the `&&` value `t43` built and
then tested (jump threading).

## Changes

1. **bce: a dominating check of the same index** (`src/typed/passes.ts`). A check `i >=u k` (frame array: `k`
   constant; buffer: `k` its length) goes when a dominating check of the same local against `k' <=u k`, or against
   the same buffer's length, has a fall-through arm that dominates it, and the local (and the buffer) hold the same
   value at both. Unsigned, so no range fact is needed. "Same value" is: the first check runs before the second on
   every path, and every definition reaching the second runs before the first (a definition executed after the
   last first check would give a path from the entry around it). Equal reaching-definition sets, which the existing
   `lt` case uses, are not enough: `A; if (c) i = i + 1; B` in a loop has the same set at A and B.
   - Simplest alternative: global value numbering over checks. Larger, and the checks are the only target here.
2. **A rule table `reassoc`** with F3's three rules, as a table pass (`typed.reassoc`, `tableBody`), verified with
   `verifyRule`, its evidence recorded beside the others.
   - Alternative: add the rules to `simplify`. simplify's table must give the hand-written pass's revisions (a
     B1 test), and simplify runs before subst and bcm build these trees; a separate pass placed after them keeps
     both.
3. **The verifier proves them** (`rules/verify.ts`, symbolic-linear): a constant variable that is not a power of two
   is a symbol of degree one (instead of disabling the method), `{eval: add|sub|shl}` in a template is evaluated
   symbolically, and a constant variable used only as a shift amount is instantiated over 0..31 (every operator that
   reads it masks it to five bits). Without this the three rules would be "sampled".
4. **`speed` runs bcm after bce, and reassoc and fold after the last subst** — measured per placement on the
   corpus before keeping it.

Every pass change is checked as passes are (the meaning contract on each application; parity; the reference
checks; the test suites).

## Measurements to report

Instructions per project under O2 and speed (default and tuned) before and after, with the reference compiler's
count on the same cases (`scripts/03-corpus-measure.mjs`); the three benchmarks (`scripts/01`); rule firings over
the corpus; per-change gains measured by toggling each change.

## Left out

- Constant homes by default, caddr length hoisting, induction-variable strength reduction, jump threading: each is
  a backend or a new pass; listed under Later in the report with the instructions the tool attributes to it.
- A guard for immediates out of the 12-bit range: the reassociated constants in the corpus are small; checked by
  measurement instead.
