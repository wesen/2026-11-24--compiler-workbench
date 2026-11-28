#!/usr/bin/env python3
# IRWB-039 / IRWB-064: briefs for phase 4c: attribution and classification as queries (IRWB-065), the E1 benchmark
# and the unused engines (066), lowering follow-ups F42 (067). Built on 12-write-briefs-p4b.py's header and facts.
import importlib.util, json, os
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('p4b', os.path.join(here, '12-write-briefs-p4b.py'))
src = open(os.path.join(here, '12-write-briefs-p4b.py')).read()
src = src[: src.index("terms = brief(")]   # reuse only the helpers, not the p4b briefs
ns = {'__file__': os.path.join(here, '12-write-briefs-p4b.py')}
exec(compile(src, '12-write-briefs-p4b.py', 'exec'), ns)
T, P, TK, SYN = ns['T'], ns['P'], ns['TK'], ns['SYN']
GUIDE = 'ttmp/2026/11/28/IRWB-064--v7-phase-4c-attribution-and-classification-as-queries-keep-or-delete-the-unused-engines-e1-lowering-follow-ups/design-doc/01-intern-guide-attribution-and-classification-as-queries-the-e1-benchmark-and-the-unused-engines.md'
ns['DIARY'] = ns['DIARY'].replace(ns['GUIDE'], GUIDE).replace('this round, including your lane', 'this round (phase 4c), including your lane; the phase 4b guide it points to explains the rest of the system')
brief = ns['brief']
brief.__globals__['DIARY'] = ns['DIARY']

queries = brief('framework concept applied to Typed, with a fixed check', 'three hours', f"""## Your task: attribution and classification as queries (phase 4, item 4.3)
Read the R3 synthesis (`{SYN}`) migration step "Attribution and classification as queries" and section **K2 · Derivation**, after the guide.

Three tools explain what the optimizer did by re-deriving it from IR trees, instead of reading the records the passes now write:
- **D1's instruction attribution** (`src/typed/attribute.ts`, `attributeSteps`; IRWB-034-G and its tables, `ttmp/2026/11/27/IRWB-034-G--*/scripts/04-attribution-tables.sh`) charges each executed RV32 instruction to the pass steps that produced it.
- **D2's provenance tool** (`src/typed/missed.ts`, `hotShapes`) finds hot instruction shapes that no rule touched.
- **A0's edit classifier** (`src/typed/edit-classes.ts`: `classifyApplication`, `rederive`, `sameTree`) classifies each edit as a local value rewrite or not, by re-matching rules on the trees before and after. Its two policies count 203 and 395 local edits on the O2 corpus; IRWB-056-B's queries over the derivation records gave 203 and 393.

Since phase 4.1 every Typed `Tx` pass records a derivation (`src/framework/ir/derivation.ts`: rule, site, premises), and since 4.2 the lowering is a cross-IR transformation whose correspondence maps blocks to instructions.

1. **Attribution as a query:** rewrite D1's attribution (and D2's provenance where it re-derives) as queries over the derivations and the composed correspondence chain from source to image. **Check:** the D1 tables reproduce exactly (run its script before and after).
2. **Classification as a query:** both A0 policies as queries over the same records, with no class field. Settle 203 against 395: explain the 393 (two `fold-add` records folding a tree the same application made, per IRWB-056-B's test), decide which reading A0 meant, and make the query and the test say so.
3. **One matcher:** `edit-classes.ts` still carries a copy of the rule matcher; move it onto `src/stdlib/term` (IRWB-060-B did this; see `git show v7-terms-ds-x/irwb-060-b:src/typed/edit-classes.ts`).
4. Delete what the queries replace (re-derivation code), and say what remains and why.
""", '- **Your tests:** the D1 tables reproduce (attach the before and after output); both A0 policies as queries with the settled numbers; D2\'s hot-shape output unchanged on the corpus programs it was run on.',
 'This step must not change them.',
 '`src/typed/attribute.ts`, `src/typed/missed.ts`, `src/typed/edit-classes.ts`, a query module in `src/framework/ir/` next to `derivation.ts` if the queries are domain-independent, and tests. Not `src/framework/core/`, `src/framework/ir/{patterns,rewrites,traversal,transactions}.ts`, `src/labs/`, `src/conformance/`, `src/typed/rules/` or `src/tensor/`: other lanes change those now.')

engines = brief('measurement with a decision point, then the change it supports', 'three hours', f"""## Your task: the E1 benchmark, and keep, move or delete the unused engines (phase 4, item 4.7)
Read the R3 synthesis (`{SYN}`) migration step "Keep or move the rewrite engine, the transaction layer and the 1,237-line core runtime" and `BACKLOG.md` item **E1** (incremental checking per function), after the guide.

R3 found three framework parts that no domain uses (probe 03/05): the **core runtime** (`src/framework/core/runtime.ts`, `query.ts`, `records.ts`; about 1,237 lines: queries with dependency tracking and early cutoff), the **rewrite engine** (`src/framework/ir/patterns.ts`, `rewrites.ts`, `traversal.ts`) and the **transaction layer** (`src/framework/ir/transactions.ts`). Their callers are the test domain in `src/labs/`, `src/conformance/`, framework tests, and `src/typed/rules/form.ts` (it builds a `NodePattern` for listing rules). Typed has its own transaction (`src/typed/tx.ts`), and rules now match through `src/stdlib/term`.

1. **The E1 benchmark** (in your ticket's `scripts/`): an edit stream on large corpus programs (chess, and Candela if it loads in time), applying small edits one at a time to programs of increasing size, measuring the cost of checking each edit (re-running the analyses and checks it invalidates) today, and with the core runtime's queries keyed by function part (early cutoff). Report cost per edit against program size.
2. **Decision point (R3):** adopt the runtime only if its per-edit checking cost falls with program size. If it does not, the runtime does not earn its place in the core.
3. **The change the measurement supports:**
   - Runtime: adopt it on the path the benchmark measured, or move it out of `src/framework/core/` (to `src/labs/` with its conformance tests) or delete it.
   - Rewrite engine and transaction layer: no measurement decides them; R3's evidence is that no domain uses them. Move `form.ts`'s listing onto `src/stdlib/term`, then move the engine and transactions with the test domain that uses them (`src/labs/`), keeping their tests passing, unless you find a domain use.
   - Record what you moved, deleted or kept, with the numbers, and the framework's line count before and after.
""", '- **Your evidence:** the benchmark script, its output (cost per edit against program size, both configurations), and the decision with the numbers.\n- **Existing tests** pass; tests of moved modules move with them.',
 'This step must not change them.',
 '`src/framework/core/runtime.ts`, `query.ts`, `records.ts`, `src/framework/core/index.ts`, `src/framework/ir/patterns.ts`, `rewrites.ts`, `traversal.ts`, `transactions.ts`, `src/framework/ir/index.ts`, `src/labs/`, `src/conformance/`, `src/typed/rules/form.ts`, the framework tests of those modules, and your benchmark. Not `src/framework/ir/derivation.ts` or `correspondence.ts`, `src/framework/passes/`, `src/typed/attribute.ts`, `missed.ts`, `edit-classes.ts` or `src/tensor/`: other lanes change those now.')

followups = brief('small follow-up fixes', 'one hour', """## Your task: F42, lowering follow-ups from phase 4b
1. **One schedule registry.** `scheduleFunction` (`src/tensor/strategy.ts`) runs the schedule plan and drops the pass results, so `src/tensor/cuda-contract.ts` runs `schedulePlan` again on a registry of its own to collect the correspondences it composes. Make `scheduleFunction` return the pass results (and their correspondences), use them in `cuda-contract.ts`, and delete the second registry.
2. **The schedule memo.** Since IRWB-061, `cudaSource()` (`src/tensor/index.ts`, through `lowerTixCuda`) takes about 4.7 ms per lowering against 0.29 ms before, because the earlier body memoized the schedule. Restore a memo keyed by what the schedule depends on (the program revision, the function, the options), and measure before and after.
""", '- **Your tests:** the composed correspondence still equals `kernelCorrespondence` on every corpus program (`tests/tensor/lowering.test.mjs`); `cudaSource()` is byte-identical; the measured cost per lowering, before and after, in your report.',
 'This step must not change them: CUDA source stays byte-identical.',
 '`src/tensor/strategy.ts`, `src/tensor/cuda-contract.ts`, `src/tensor/index.ts`, and tests. Nothing else: other lanes change `src/framework/`, `src/labs/` and `src/typed/` now.')

lanes = [('queries', queries, [('IRWB-065-A', 'g-h', 'lunaroute/glm-5.3', 'high', 'pi'), ('IRWB-065-B', 'ds-x', 'lunaroute/deepseek-4.1-flash', 'xhigh', 'pi')]),
         ('engines', engines, [('IRWB-066', 'sl', 'gpt-6.2-sol', 'low', 'codex')]),
         ('followups', followups, [('IRWB-067', 'tl', 'gpt-6.1-terra', 'low', 'codex')])]
for name, text, items in lanes:
    os.makedirs(f'{P}/{name}', exist_ok=True)
    open(f'{P}/{name}/common.md', 'w').write(text)
    key = {}
    for item, cfg, model, effort, harness in items:
        open(f'{P}/{name}/{item}.md', 'w').write('')
        key[item] = dict(task=name, config=cfg, model=model, effort=effort, round=f'v7-{name}-{cfg}', harness=harness, **({'tools': 'read,bash,edit,write'} if harness == 'pi' else {}))
    json.dump(key, open(f'{T}/various/results/{name}-config-key.json', 'w'), indent=1)
print('ok')
