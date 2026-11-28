**Recommend one runner with two drivers.** The synchronous analysis path needed **27 sync-specific lines** and duplicated no cache lookup or record construction. Both drivers reused the same manager records across calls and respected invalidation. They produced the same revisions, edits and correspondence as the stock runners on all **50 Typed projects and six Tix programs**.

[Ticket IRWB-051-B](ttmp/2026/11/27/IRWB-051-B--one-runner-with-two-drivers/index.md) · [Report with measurements and reproduction commands](ttmp/2026/11/27/IRWB-051-B--one-runner-with-two-drivers/various/01-report.md)

### Measurements

Median milliseconds per application, using a trivial gate for timing and real domain gates for corpus equivalence.

| Fixture | Stock | Sync driver | Async driver |
|---|---:|---:|---:|
| Tix `inline` on `attention` | 1.857 | 1.948 | 2.034 |
| Typed `constprop` on `constants`, cold manager and audited preservation | 11.064 | 6.765 | 6.329 |

A second run put synchronous Tix within 0.063 ms of stock. The timing ranges overlapped. The lower Typed times include a separate difference: stock attempts transfer before recomputing, while the prototype directly recomputes the three preservation claims.

### Acceptance

The baseline oracle printed **`no differences from …/various/baselines/main.json`**. All four spike tests passed, including cross-driver cache reuse and rollback after a failed preservation check. `npm run build`, `npm run check` and `node tools/build-site.mjs` passed.

| Suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Typed | 186 | 0 | 2 |
| Framework, including spike tests | 247 | 0 | 0 |
| Workbench | 24 | 0 | 1 |
| Standard library | 7 | 0 | 0 |
| Tensor, excluding GPU files | 45 | 0 | 0 |

The three skips were existing opt-in Candela checks. No existing assertion changed.

### Changed files

| File | Change |
|---|---|
| `src/framework/contracts/analysis-manager.ts` | Added `analyseSync` and shared cache lookup, validation, record creation and events. |
| `src/framework/passes/define-pass.ts` | Added the transformation type, generator lifecycle and two drivers using the existing F33 publisher. |
| `src/tensor/passes.ts` | Ported `inline` with its exact relation and sampled meaning gate. |
| `src/typed/passes.ts` | Ported `constprop` with its reaching-definition need and three preservation claims. |
| `tests/framework/transformation-drivers.test.mjs` | Added corpus parity, cache reuse, invalidation and rejection tests. |
| Ticket `design/01-runner.md` | Recorded the design before implementation, in commit `a19f0b9`. |
| Ticket `reference/01-diary.md` | Recorded implementation decisions and verification checkpoints. |
| Ticket `various/01-report.md` | Recorded the recommendation, both timing runs, commands and acceptance results. |
| Ticket `scripts/01-suites.sh` | Runs the five requested suites and excludes GPU files. |
| Ticket `scripts/02-measure.mjs` | Measures both ports against stock in balanced driver order. |
| Ticket `scripts/03-size.mjs` | Counts shared and driver-specific manager source lines. |
| Ticket `scripts/04-generator-probe.mjs` | Reproduces the Node generator-resumption probe. |
| Ticket `README.md` | Provides the docmgr workspace guide. |
| Ticket `index.md` | Links the design, diary, report and implementation. |
| Ticket `tasks.md` | Records completion of the requested work. |
| Ticket `changelog.md` | Records the prototype milestone. |

I chose `constprop` because both suggested alternatives, `licm` and `bce`, have empty preservation lists in this checkout. The synchronous prototype supports pure leaf analysis misses and immediate domain gates. General deferred manager contracts use the async driver. Strategy migration, preservation transfer and projection-edit kernels remain outside this spike.

**Last commit:** `165f76ed3adfa9eb0ac1c7ee2f06155ce7608922`. The worktree is clean.