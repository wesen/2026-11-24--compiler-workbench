Done. Summary:

## Ticket, design, report
- Ticket: `ttmp/2026/11/27/IRWB-037-D--missed-optimizations-found-from-provenance/` (`index.md`, `tasks.md`, `changelog.md`)
- Design (committed first): `.../design/01-design-missed-optimizations-from-provenance.md`
- Report: `.../reference/02-report-missed-optimizations-from-provenance.md`; diary: `.../reference/01-implementation-diary.md`
- Scripts `.../scripts/01`–`06` (baseline, hot sites with provenance, op histogram, block-reorder probe, corpus vs reference, hot shapes); measurements in `.../various/`

## Method and shapes found
`attributeSteps` was reused unchanged; two new views found *what is left*: executed instructions per statement marked with whether any pass's edit record names it, and the per-RV32-opcode gap to the reference. Regex's +305 is +326 `j` (183 rotated-latch bottom tests, 56 checks whose trap block is far from them) plus inlining savings; `bounds-offset`'s miss is a check on `i + c` that `bce` could not match. The layout fix was probed and **rejected by measurement** (bytecode-vm −12 % but lz-roundtrip +13 %, because IR block order feeds the allocator).

## What was added
- **`bce` on affine indices** (`src/typed/passes.ts` + new `src/typed/linear.ts`): a check `x >=u len` goes when a dominating branch proved `x + k <u len`, the two indices being linear forms over the values the reaching definitions name, `k ≥ 0`, no wrap. Verified as every pass is (meaning contract on every pipeline step, no rejections on 44 projects) plus `tests/typed/bce-offset.test.mjs`.
  - `bounds-offset` 1,355 → 1,215 (−10.3 %), `bounds-lab` 5,012 → 4,788 (−4.5 %) under `speed`.
- **`ranges` transfer maps bottom to bottom** (`src/typed/analyses.ts`): the analysis had been turning a not-yet-swept block into "every local is anything", hiding every loop counter's bound in that function shape. No corpus count moved by itself; kept as a monotonicity fix with a second use.
- **No rule added**: 40.9 % of executed instructions are in statements no pass edits, but the hot shapes are loads, calls, control flow, increments and one `rem`-under-non-negativity case that needs a fact, not a rule guard.

## Numbers under `speed` (before → after)
- regex 6,933 → 6,933; LZ `roundTrip` 156,782 → 156,782; chess 10,038,193 → 10,038,193 (unchanged: neither shape occurs)
- corpus `O2` 1,090,271 → 1,089,907; `speed` 867,770 → 867,406; reference 875,417 (r0 1,123,009)

## Framework changes
None — `src/framework/` untouched; `node tools/build-site.mjs` builds; typed 158 pass / 2 skip, framework+workbench 258 pass / 1 skip, 0 failures.

Last commit: `88ef00c`
