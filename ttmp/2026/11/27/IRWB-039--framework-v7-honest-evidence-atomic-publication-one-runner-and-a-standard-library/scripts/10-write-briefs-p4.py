#!/usr/bin/env python3
# IRWB-039: briefs for the cleanup (IRWB-055) and phase 4 lanes: derivations (056), fusion and scheduling as
# decide/eligible/prepare (057), solveFor and pe (058). Header and facts come from the step-3 lane brief.
import json, os, re
T = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = T + '/various/prompts'
TK = 'ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library'
SYN = 'ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/index.html'
g = open(P + '/graph/common.md').read()
head = g[: g.index('This is a **')]
facts_tail = g[g.index('## Repository facts'):]
def brief(kind, time, body, tests, baseline, scope, gpu_ok=False):
    rf = re.sub(r'- \*\*Scope:\*\*.*\n', lambda m: '- **Scope:** ' + scope + '\n', facts_tail)
    if gpu_ok:
        rf = rf.replace('Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files (there is no GPU here): other agents share this machine.',
                        'Do not run the full suite (`npm test`): other agents share this machine. You may run the `*-gpu.test.mjs` files (the GPU is remote, reached through `tools/cuda-remote.mjs`); you are the only agent using it, so run one GPU job at a time.')
    acc = ('## Acceptance (all of these, checked on your last commit)\n' + tests + '\n'
           '- **The baselines:** `node ' + TK + '/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. ' + baseline + '\n'
           '- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.\n'
           '- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.\n\n')
    return head + f'This is a **{kind}**, in one session of up to {time}. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.\n\n' + body + '\n' + acc + rf

RUNNER = 'Since phase 3, every Typed and Tix pass is a `Transformation` (`src/framework/passes/transformation.ts`: `relation`, `eligible`, `prepare`, `obligations`) run by one runner, `runTransformation`, under a synchronous or an asynchronous driver (`src/framework/contracts/steps.ts`); the strategy interpreter has `execute` and `executeSync`.'

cleanup = brief('cleanup', 'one hour', f"""## Your task: three small cleanups after the phase 3 migration
{RUNNER}

1. **Move `steps.ts` into `core`.** `src/framework/contracts/steps.ts` (`Steps`, `wait`, `driveSync`, `driveAsync`, `drive`) is generic, and the strategy interpreter now imports it, which is the strategy layer's first import outside `core`. Move it to `src/framework/core/steps.ts`, update the imports, and keep `tests/framework/layering.test.mjs` passing (strategy, contracts and ir import from core only the modules its allow-list names; add `core/steps.js` there, and say so).
2. **One identity algorithm.** `tix.keep` (`src/tensor/index.ts`, around line 42) and `typed.keep` (`src/typed/strategies.ts`, around line 144) are the same strategy algorithm: return the input unchanged, used as the fallback of an `attempt`. Define it once in the framework's strategy layer and use it from both.
3. **One plan builder.** `optimizeTix` (`src/tensor/index.ts`, around lines 50-70) and Typed's `pipelinePlan` (`src/typed/strategy.ts`, around line 19) build the same plan shape: a sequence of `attempt`s, each a pass with the identity as fallback. Put that builder in the framework (`src/framework/strategy/builders.ts`) and use it from both, keeping each caller's options (for example `tolerate`).
""", '- **Existing tests** pass unchanged (the layering test may gain one allow-list entry).',
 'This step must not change them.',
 '`src/framework/core/`, `src/framework/contracts/steps.ts` and its importers, `src/framework/strategy/`, `src/tensor/index.ts`, `src/typed/strategies.ts`, `src/typed/strategy.ts`, `tests/framework/layering.test.mjs`. Nothing else: other steps change `src/framework/passes/`, `src/framework/ir/`, `src/tensor/fusion.ts`, `schedule.ts`, `strategy.ts` and `src/typed/` rules now.')

derivations = brief('framework concept', 'two and a half hours', f"""## Your task: derivations (phase 4, concept K2 of the R3 design)
{RUNNER}

Read first: the R3 synthesis (`{SYN}`), section **K2 · Derivation** and the migration step "Derivation and scoped correspondence"; and `src/typed/tx.ts` (Typed's edit transaction: `record`, around line 203, writes each edit with a `because`).

Today a pass's edits say *what* changed; the correspondence between the IR before and after is computed separately and only partly audited. A **derivation** is the producer's own record of *why*: for each step, the rule or decision it applied, the site (the entities it consumed and produced), and the premises (the facts or analysis results it relied on). The correspondence is then computed *from* the steps under a coverage policy (F35's vocabulary in `src/framework/ir/correspondence.ts`), and the existing diff audits it.

1. **The record:** a small framework type for a derivation step (rule or decision id, site, premises, relation) in `src/framework/ir/`, carried in a transformation's result next to its edits and correspondence.
2. **Typed writes rule ids:** make `Tx.record` (and its callers in `src/typed/rules/` and the passes that apply rules: simplify, fold, identities) record the rule that licensed each edit and the facts it used. R3 counted 183 verified-rule matches among the 2,021 O2 edit records of the corpus, and today 0 records cite a rule: that number must go from 0 to 183 (or explain each difference).
3. **Tix records merges:** Tix `inline` (`src/tensor/passes.ts`) records which statement was merged into which.
4. **Correspondence from steps:** for those passes, compute the correspondence from the derivation and check it against the one computed today: they must be equal. Reject empty and false mappings (a step whose site names entities that do not exist, or that the diff contradicts).
5. **Classification stays a query:** do not add a class field (`local`, `structural`) to a step; R3 decided against it (A0's two policies, 203 and 395 local edits, must both be computable from the same records). Show both numbers as queries in a test.

**Decision point:** measure the cost. If recording derivations makes the O2 corpus compile more than about 2× slower than today's correspondence computation, store the local terms only on demand, and report the numbers either way.
""", '- **Your tests:** rule-citing records on the O2 corpus (0 → 183, or each difference explained); derivation-computed correspondence equals today\'s for every pass that records one; an empty and a false mapping are rejected; both A0 policies as queries over the same records.',
 'Edit records may gain fields; images, instruction counts, CUDA and Tix revisions must not change. If the census in the baselines changes only by new fields, say so and show it.',
 '`src/framework/ir/`, `src/framework/passes/transformation.ts` (only to carry the derivation), `src/typed/tx.ts`, `src/typed/rules/`, the Typed passes that apply rules, `src/tensor/passes.ts` (only `inline`), and tests. Not `src/framework/strategy/`, `src/framework/core/`, `src/tensor/fusion.ts`, `schedule.ts`, `strategy.ts`, `src/typed/sccp.ts`, `specialize.ts` or `pe.ts`: other steps change those now.')

fusion = brief('framework concept applied to a domain', 'four hours', f"""## Your task: fusion and scheduling as decide, eligible, prepare (phase 4, concept K6)
{RUNNER}

Read first: the R3 synthesis (`{SYN}`), section **K6 · Decisions as data** and the worked defect "5 · The extent-17 reduction-order counterexample", and the migration step "Fusion as decide, eligible, prepare".

K6 splits a transformation that makes a choice into three parts: an **untrusted `decide`** that returns a plan (a serializable value: which statements to fuse, which loop order and tiling to use); a **small `eligible(plan)`** that decides whether that plan is legal on this IR; and **`prepare`**, which applies it. Only `eligible` must be trusted, so it should be small and grounded in standard theory: here, the affine library's dependence distance vectors (`src/stdlib/affine/`) and the legality of loop reordering and strip-mining over them.

Today:
- **Fusion** (`src/tensor/fusion.ts`, `planFusion` with `joinDepth`, now on the library's distance vectors) decides and applies in one step.
- **Scheduling** (`src/tensor/schedule.ts`, T6's checked scheduling passes with a `legal` precondition, and its output validator `orderViolation` around line 298) and the hand-written scheduling rule in `src/tensor/strategy.ts` (`lowerSchedule`).
- The CUDA runtime finds the fused/unfused gate names with a regex over the emitted source (`src/tensor/cuda-runtime.ts`, around line 142).

1. **Fusion** as decide/eligible/prepare: the plan is the grouping; `eligible` checks it with the distance vectors.
2. **Scheduling** the same way: the plan is the loop order, tiling and bindings of each kernel variant; `eligible` replaces both the per-pass `legal` checks and `orderViolation`. The extent-17 counterexample must be rejected: T6's `orderViolation` simulates three extent vectors (11, 1 and 0, all below the strip-mining factor 16) and accepts a variant whose reduction order differs from the source's at extent 17, which changes f32 results (reviewer B's probe, copied to `{TK}/various/reference-probes/r3-b-05-reduction-order.mjs`; it shows the variant, the order and the two sums; adapt it into a test in `tests/tensor/`).
3. **The hand-written rule** in `src/tensor/strategy.ts` becomes a strategy plan run under `executeSync`.
4. **A manifest** of the emitted kernels and gates, produced with the CUDA source, drives the runtime's gate names; delete the regex.

**Decision point:** if fusion and scheduling need different `eligible` signatures (they cannot share one plan-checking interface without contortion), say so with the two signatures and keep them separate: that withdraws K6's unification for this pair.
""", '- **Your tests:** the extent-17 variant is rejected by `eligible`; fusion and scheduling plans round-trip through serialization; `eligible` accepts every plan the corpus produces today.\n- **The GPU suite** `tests/tensor/*-gpu.test.mjs` passes at the end.',
 'This step must not change them: CUDA source is byte-identical for every Tix program.',
 '`src/tensor/fusion.ts`, `src/tensor/schedule.ts`, `src/tensor/strategy.ts`, `src/tensor/cuda-*.ts`, `src/stdlib/affine/` (additions only), and tests. Not `src/tensor/passes.ts`, `src/tensor/index.ts`, `src/framework/`, or `src/typed/`: other steps change those now.', gpu_ok=True)

pe = brief('library extension with a decision point', 'three hours', f"""## Your task: `solveFor` and `pe` (phase 4), tested on B1's specializer
Read first: the R3 synthesis (`{SYN}`), the library table rows **lattice** (`solveFor` with on-demand unknowns) and **pe** (division and congruence; polyvariant unfold; budget: refuse, generalize, fall back), and the migration step "solveFor and pe"; then `src/stdlib/index.ts` (the admission rule and layering) and `src/stdlib/flow/`.

The library's solver works on a fixed graph. Two things in the codebase need more:
- **SCCP** (`src/typed/sccp.ts`, Wegman and Zadeck) explores only the blocks it finds executable, and it already uses the library's flat lattice.
- **B1's specializer** (`src/typed/specialize.ts` and `src/typed/pe.ts`; B1 specializes Typed's bytecode VM on its bytecode, the first Futamura projection, giving Fibonacci in 110 instructions) runs its own binding-time division, memo table, worklist and cloner. R3 found that a static-graph solver can express a division but not polyvariant unfolding, which must intern and schedule new residual program points as it discovers them.

1. **`solveFor`** in `src/stdlib/flow/` (or `lattice/`, by the layering): equations whose right-hand side reads other unknowns through a `get` that registers a dependency and may create the unknown (Fecht and Seidl's local solving; R3 quotes the interface: `rhs(unknown, get)`, `widenAt?`, `solveFor(eqs, roots, budget)`). Port SCCP onto it as the first client.
2. **`pe`** in `src/stdlib/pe/`: a binding-time division (congruence) on `solveFor`, and polyvariant unfolding with a memo of (program point, static environment), a budget, and the three outcomes on exhaustion (refuse, generalize, fall back). Restate B1's specializer on it as the second client.

**Decision point:** count the lines of B1's specializer (`specialize.ts` + `pe.ts`) before and after. If the restated specializer is not at most half of the original, `unfold` is not earning its place: say so, keep B1 as it is, and keep `solveFor` with SCCP only.
""", '- **Your tests** in `tests/stdlib/`: `solveFor` on equation systems with known solutions, including one that creates unknowns on demand and one that needs widening; the division on a small program with known binding times; unfolding that hits the budget under each of the three outcomes.\n- **B1 unchanged:** the B1 tests in `tests/typed/` pass, and the specialized programs\' instruction counts are unchanged (Fibonacci under `promote+speed`: 110).',
 'This step must not change them.',
 '`src/stdlib/flow/` (additions), `src/stdlib/pe/` (new), `src/stdlib/index.ts`, `src/typed/sccp.ts`, `src/typed/specialize.ts`, `src/typed/pe.ts`, and tests. Not `src/framework/`, `src/typed/tx.ts`, `src/typed/rules/` or `src/tensor/`: other steps change those now.')

lanes = [('cleanup', cleanup, [('IRWB-055', 'tl', 'gpt-6.1-terra', 'low', 'codex')]),
         ('derivations', derivations, [('IRWB-056-A', 'g-h', 'lunaroute/glm-5.3', 'high', 'pi'), ('IRWB-056-B', 'ds-x', 'lunaroute/deepseek-4.1-flash', 'xhigh', 'pi')]),
         ('fusion', fusion, [('IRWB-057', 'fa', 'fable', 'default', 'claude-code-subagent')]),
         ('pe', pe, [('IRWB-058', 'sl', 'gpt-6.2-sol', 'low', 'codex')])]
for name, text, items in lanes:
    os.makedirs(f'{P}/{name}', exist_ok=True)
    open(f'{P}/{name}/common.md', 'w').write(text)
    key = {}
    for item, cfg, model, effort, harness in items:
        open(f'{P}/{name}/{item}.md', 'w').write('')
        key[item] = dict(task=name, config=cfg, model=model, effort=effort, round=f'v7-{name}-{cfg}', harness=harness, **({'tools': 'read,bash,edit,write'} if harness == 'pi' else {}))
    json.dump(key, open(f'{T}/various/results/{name}-config-key.json', 'w'), indent=1)
print('ok')
