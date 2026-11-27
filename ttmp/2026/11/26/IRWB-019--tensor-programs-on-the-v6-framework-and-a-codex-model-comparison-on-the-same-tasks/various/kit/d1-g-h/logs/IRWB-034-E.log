**Ticket, design and report**

- Ticket: `ttmp/2026/11/27/IRWB-034-E--why-speed-makes-the-bytecode-vm-slower-instruction-attribution-and-a-fix/`
- Design: `design-doc/01-attribution-of-executed-instructions-to-pass-decisions-and-the-licm-preheader-fix.md` (committed first)
- Final report: `report/01-final-report-the-attribution-the-fix-and-the-measurements.md`; diary: `diary/01-implementation-diary.md`; all probes/sweeps with outputs in `scripts/`

**The cause** (from the compiler's own records, not guessing): `typed.loops` reported one natural loop **per back edge**, so after cfg folded the dispatch chain, the VM's dispatch loop reached `licm` as **nine loops with the same head and id**. licm made a preheader per sub-loop and retargeted the other sub-loops' back edges into it, chaining the preheaders onto the runtime cycle. The attribution (`attributeSteps`: emulator counts → statements via `covers` → deltas via correspondence → credits per edit) shows it exactly: the r4 licm transition cost **+2,599 executed instructions on Fibonacci** — 15 "hoisted" frame-address sets re-executing once per guest instruction (+184 each), against −341 of replaced arm work, plus **+20 overhead** (ten callee-saved saves/restores from the register pressure of 14 loop-live `inv` locals). Checksum: +2,251 the same way.

**The fix**: `loopsOf` now **merges natural loops that share a header** (union of bodies, union of assigned locals, one id per header — the textbook treatment). licm's preheader becomes the entry block, the hoists run once, and licm turns into a net win (−306/−258). A licm-only guard was rejected (nine wrong bodies remain for every consumer); a hoist cost check was held in reserve and proved unnecessary.

**Bytecode VM instructions** (n=12, seed=8, checked pipelines, `coalesce: true`):

| | r0 | O2 before → after | speed before → after |
|---|---:|---:|---:|
| Fibonacci | 7,678 | 9,286 → **6,382** | 9,286 → **6,382** |
| checksum | 6,874 | 8,218 → **5,710** | 8,218 → **5,710** |

**Corpus totals** (47 projects, `measure`'s protocol, before → after): O2 1,124,912 → 1,107,836; speed 892,944 → 877,151. Only two projects changed at all: bytecode-vm (47,076 → 32,625) and regex-nfa (improved, same loop shape). Parity: bytecode-vm and regex-nna… regex-nfa both 100/100, zero failures; tests/typed (32 files), tests/framework, tests/workbench: 0 fail; `tools/build-site.mjs` builds.

**Framework changes**: none in `src/framework/` or `src/workbench/` — changes are `src/typed/attribute.ts` (new: the reusable attribution tool `attributeSteps`/`attributeOrigins`), `src/typed/analyses.ts` (the loopsOf merge, with the reason recorded in code and report), and `tests/typed/attribution.test.mjs` (the tool's test: exactness per transition, the fixed licm account, the merged loops fact).

**Last commit**: `4def57e` (working tree clean; commits: design `a12c2a6`, tool `c2c8ac7`, fix `3a25686`, report `4def57e`; not pushed).
