All work is committed and the tree is clean. Here is the summary:

## Ticket IRWB-037-E (D2): missed optimizations, found from provenance

**Paths**
- Ticket: `ttmp/2026/11/27/IRWB-037-E--missed-optimizations-found-from-provenance/`
- Design: `…/design-doc/01-closing-the-loop-from-hot-instructions-to-verified-rules-duplicate-bounds-checks-threshold-widening-and-shift-masks.md`
- Report: `…/analysis/01-report-measured-shapes-rules-and-pass-changes-and-the-corpus-before-and-after.md`
- Diary: `…/log/01-implementation-diary.md`; probes and measurements: `…/scripts/01–12`

**Method.** Hot-site probes (per-statement executed instruction counts + each site's edit-record provenance) found three shapes no rule or pass improved: **S1** four bounds checks dominated by an identical earlier check in the regex head (346 instructions); **S2** `typed.ranges`' standard widening sent `dense` to `[0, MAX]`, `dense+1` overflowed the interval to full, so `strength` never fired on chess's `(dense / 8) << 3` (860,800 instructions); **S3** `(x >>> k) << k` shift pairs with no covering rule.

**Rules and pass changes added**
- `typed.ranges` v2: **widening up to the guard constants** (threshold widening) — fixes the overflow collapse; chess `strength: replace −14,322` on the measured call.
- Two verified simplify rules `shl-shru-mask` and `sub-shl-shru-mask` (new `shift` guard k ∈ [0,31], `lowMask`/`highMask` template constants, repeated-constant patterns); both verify **sound, reduced-width+argument** (records in `rules/evidence.ts`). `shl-shru-mask` fires 3× on the corpus (chess `simplify: −165,314`); `sub-shl-shru-mask` never fires — honest negative, kept as the verified pair identity.
- `strength` emits `shru` (valid under its x ≥ 0 proof), so the mask rules apply to its output.
- `bce`: a dominating **identical check** proves the check, and constant lengths are recognized — regex `bce −346` (exactly the measured shape), LZ `bce −44`, chess `bce −5,734`.
- `speed` runs `simplify` after `strength` (O2/O2+ stay as the book defines; the two book-anchored tests updated with reasons).
- `attributeSteps` gained a `limit` option (`tools/attribute.mjs --limit 3e7`) — D1's tool refused the 14.2M-instruction chess call outright.

**Measurements** (emulator counts; parity 8,286/8,286 cases agree, 0 failures; all typed/framework/workbench tests pass; site builds)

| benchmark, `speed` | before | after | reference |
| --- | ---: | ---: | ---: |
| regex (one call, default) | 6,933 | **6,587** | 6,628 — gap closed, now 0.6% below |
| LZ (100 cases, tuned) | 156,782 | **154,700** | 156,405 — now 1.1% below |
| chess (mate fixture, tuned) | 10,038,193 | **9,535,352** | 10,827,760 — lead 7.3% → 11.9% |

Corpus totals (tuned, 10 seed-7 cases per function): `speed` 792,800 → **776,650** (−2.04%), 11.3% below the reference (875,417); O2 1,032,485 → **1,028,932** (−0.34%). **No project regressed** under any pipeline × options combination.

**Framework changes** (one, with its reason): the dataflow solver passes the region context to `widen` (like `transfer`/`boundary`/`edge` already get) — thresholds are per-function data; without it a widening must be context-free. Everything else is typed-side.

**Last commit:** `bbde9bf`
