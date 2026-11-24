## 11. Verification, reproducibility and delivery

The guide describes an executable release. The source files, examples and API implementations are the primary references; the checked-in tests and generated evidence state what was actually exercised. A successful test is evidence for its stated case and invariants, not a claim of correctness for every possible domain input.

### 11.1 Release verification

The complete strict TypeScript build and all **371 automated tests** pass. This includes the 269 earlier runtime, strategy, contract, domain and workbench tests, plus 102 new tests for generic manipulation, its domain integrations, the v6 UI and independent review findings. No test is skipped.

| New verification group | Tests | Main risks exercised |
| --- | --- | --- |
| Representation foundation | 22 | Typed navigation, native reconstruction, revision hashes, stale/ABA edits, semantic commit races, diffs and correspondence |
| Patterns and rewriting | 34 | Binding isolation, exact matching, all schedules, relation order, shared budgets, cycles, cancellation and scoped authority |
| Native domain laboratories | 31 | Real transformations, native round trips, checker assumptions, customized input, cache reuse and negative semantic cases |
| V6 workbench integration | 12 | Actual compiler/query/matcher execution, source navigation, history, warm origins, branches and lineage |
| Independent review regressions | 3 | Reentrant cancellation, inherited adapter callback loss, and incorrect wildcard provenance at the runtime bridge |

The reproducible release command also runs the sixteen authored-source scenarios, twenty Strategy IR scenarios, thirty-three semantic-contract scenarios, five IR experiment scenarios and all five guide tutorials. The contract experiment includes deliberate negative cases: twenty-four successful runs and nine expected failures. An expected rejection is recorded as such and checked; it is not silently counted as a successful compilation.

The v6 experiments retain four full warm-run traces and a tighter mesh-bound comparison. The guide tutorials have assertions against their real results, including a changed source input, custom rewrite, rejected algebraic edit, resource invalidation and rollback, customized domain inputs, the authored CAD bracket, and a newly registered adapter.

### 11.2 What the checks establish

The foundation tests exercise transaction lifecycle and competing edits, not just a happy-path graph update. A stale draft is rejected even after the head returns to identical content. A verification callback that awaits cannot publish over a newer head. Reentrant cancellation at the synchronous publication boundary cannot report success and then be ignored. Async acceptance callbacks are rejected by the protocol.

The rewrite tests distinguish a frontier sweep from normalization, verify order using actual expression operand edges, and test that callbacks cannot commit before the scheduler checks its budget. Failed, budget-limited and cycle-closing candidates remain diagnostic evidence without advancing the retained revision. Prior accepted edits remain visible when a later step fails; the entire schedule is not falsely represented as one atomic transaction.

The domain tests check the assumptions needed by their mathematics. Polynomial analysis uses bounded exact integer arithmetic. Mesh eligibility checks global convexity, so a self-crossing star does not pass merely because consecutive turns have the same sign. Constraint solves check finite intermediates and residuals against the original equations. These are targeted guarantees within the declared input families.

The UI tests run the real compilers, adapters, matchers, contracts and correspondence utilities through explicit DOM, Canvas and Worker transport doubles. They verify exact source bytes, query execution, live registered predicates, failed-input behavior, and the difference between a warm cache invocation and the earlier invocation that actually performed a rewrite.

### 11.3 What has not been verified here

The authoring environment did not provide permitted browser execution for this release. The earlier restriction was not retried or bypassed. The optional `scripts/check-ir-browser.py` is included for a browser-capable environment, but rendered desktop/mobile layout, browser compatibility and live Web Worker behavior are not claimed as visually verified for v6. A historical screenshot or browser result from an earlier release is not evidence for this one.

The document itself is generated as a searchable PDF, rendered and visually checked for page layout. That PDF review is separate from running the interactive application in a browser. The document's tables and code remain text, rather than screenshots of source.

These tests also do not establish universal CAD geometry, arbitrary nonlinear physics, unbounded polynomial normalization, formally proved equivalence, persistent crash recovery or distributed effect atomicity. The implementation and this guide describe the supported semantics and the relevant trust boundaries explicitly.

### 11.4 Reproduce and retain the result

Run `npm run verify:release` from the extracted project. It builds the application, runs the regressions and emits the experiment/tutorial records. The release log is `output/v6-release-validation.log`; the compact verification ledger is `output/v6-verification.json`. Each experiment family has its own detailed records under `output/`.

The complete ZIP includes the project source, installed build dependencies, compiled outputs, declarations, tests, scripts, guide sources, final guide and evidence. The package script verifies the archive CRC, exact file set, byte lengths and SHA-256 entries against `WORKSPACE-MANIFEST.json`. The manifest excludes its own digest and reproducible Python bytecode caches.

The standalone HTML is also delivered separately, as are this guide's Markdown and PDF. The chapter sources and PDF generator remain in the workspace so the document can evolve with the code. Earlier published releases remain intact. Browser drafts and live caches are ephemeral; export edited input, plans and traces when you want to retain an interactive session's work.

To rebuild the guide, use Python 3 with the optional packages in `requirements-docs.txt`, then run the two commands below. The renderer uses DejaVu fonts when installed and otherwise falls back to standard PDF fonts. The delivered PDF already embeds its fonts. Neither Python nor these packages are needed to run the compiler or open the delivered HTML.

```sh
python3 scripts/assemble-guide.py
python3 scripts/render-user-guide.py
```
