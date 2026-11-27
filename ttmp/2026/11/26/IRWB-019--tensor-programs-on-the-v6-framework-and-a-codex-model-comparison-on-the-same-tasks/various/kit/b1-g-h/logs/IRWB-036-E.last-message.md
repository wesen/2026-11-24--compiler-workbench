## Final report

**Ticket:** `ttmp/2026/11/27/IRWB-036-E--b1-specializing-the-bytecode-vm-on-its-bytecode-first-futamura-projection/`
**Design:** `design-doc/01-specializing-the-bytecode-vm-on-its-bytecode-design.md` (committed before implementation, revised where the code taught better)
**Report:** `design-doc/02-report.md` · **Diary:** `log/01-implementation-diary.md` · **Scripts:** `scripts/01–04` (all committed)

### The result: a first Futamura projection, checked

A buffer promise (`typed.bindings` buffer form: "`runVm`'s `code` always holds these 64 cells", checked as the field binding is checked — refusal on any store through the bound parameter, `assume` restricting the contract to the promised bytes) plus the new **`peval`** pass: a polyvariant abstract trace whose binding-time analysis propagates the promise through `caddr`/`load16u`, folds fetch/dispatch/operand, closes loops at memoized program points, and **peels** the first trip where the abstract state differs instead of demoting it. The dispatch loop is specialized on the program counter split over the input spec's `oneOf` domain — exactly the domain the meaning contract generates, so the specializer never claims more than the check enforces (other entries trap; a test pins that stance down).

### Instructions and code size (n=12, seed=8, `coalesce: true`)

| Fixture (guest) | r0 | speed | **peval+speed** | hand-written |
|---|---:|---:|---:|---:|
| Fibonacci (184) | 7,678 | 9,286 | **76** | 75 |
| Checksum (160) | 6,874 | 8,218 | **81** | 74 |
| image bytes | 840 | 904 | **160** | 76 |

Per trip (fitted over n=0…12): **5.90 instructions vs the hand loop's 5.97** — the steady-state residual is statement-for-statement the hand code; the entire remaining gap is the peeled first trip and the two-entry dispatch. All 442 domain cases agree with the independent oracle on the evaluator and on RV32; the gated pass runs 40/40; the meaning contract rejected three real residual bugs during development (diary step 4).

### Framework changes

**None in `src/framework/`** — the existing pass machinery sufficed. In `src/typed/`: `bindings.ts` (new: the buffer binding, its check, cycle-free), `peval.ts` (new: the pass), `specialize.ts`/`program.ts`/`passes.ts` (promise validation, `assume`, registration), each with its reason in the report's table.

### Checks run before the last commit

`tests/typed` 157 tests (0 fail), `tests/framework` 234 (0 fail), `tests/workbench` 25 (0 fail, pass count 15→16 updated), `tools/build-site.mjs` builds.

**Last commit:** `b8b4498`
