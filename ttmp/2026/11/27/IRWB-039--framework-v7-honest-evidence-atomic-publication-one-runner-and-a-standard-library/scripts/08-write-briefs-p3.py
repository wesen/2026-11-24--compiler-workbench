#!/usr/bin/env python3
# IRWB-039: briefs for the phase 3 migration (IRWB-052), the solver move (IRWB-053) and F39 (IRWB-054).
# The shared header and facts are taken from the lane briefs written in step 3 (various/prompts/graph/common.md).
import json, os, re
T = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = T + '/various/prompts'
TK = 'ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library'
g = open(P + '/graph/common.md').read()
head = g[: g.index('This is a **')]
facts = g[g.index('## Acceptance'):]
facts_tail = facts[facts.index('## Repository facts'):]
def brief(kind, time, body, tests, baseline, scope, gpu_ok=False):
    rf = facts_tail
    rf = re.sub(r'- \*\*Scope:\*\*.*\n', '- **Scope:** ' + scope + '\n', rf)
    if gpu_ok:
        rf = rf.replace('Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files (there is no GPU here): other agents share this machine.',
                        'Do not run the full suite (`npm test`): other agents share this machine. You are the only agent using the GPU during your session (see your task).')
    acc = ('## Acceptance (all of these, checked on your last commit)\n' + tests + '\n'
           '- **The baselines:** `node ' + TK + '/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. ' + baseline + '\n'
           '- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.\n'
           '- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.\n\n')
    return head + f'This is a **{kind}**, in one session of up to {time}. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.\n\n' + body + '\n' + acc + rf

SPIKE = 'ttmp/2026/11/27/IRWB-051-C--one-pass-runner-with-two-drivers-and-a-transformation-type-phase-3-spike'
migration = brief('migration: the chosen design applied to the whole codebase', 'four hours', f"""## Your task: one pass runner for every pass (phase 3 migration)
Your branch already contains the winning phase 3 spike (IRWB-051-C, three commits on top of the base). Read its design and report first: `{SPIKE}/design-doc/01-one-runner-two-drivers-design.md` and `{SPIKE}/reference/02-report.md`. It added `src/framework/contracts/steps.ts` (a step yields what it would `await`; `driveSync` refuses a promise, `driveAsync` awaits it), turned the analysis manager's `analyse` and `preserve` into generators driven by both drivers (`analyseSync`, `preserveSync`), and added `src/framework/passes/transformation.ts` (the `Transformation` type with `relation`, `eligible`, `prepare`, `obligations`, and the runner `runTransformation` with `applyTransformation` and `applyTransformationSync`). Two passes use it: Tix `inline` and Typed `strength`. Two other spikes reached the same design independently, so the design is settled; your job is to finish it and move everything onto it.

1. **Contracts as steps.** `verifyTransformation` (`src/framework/contracts/analysis-manager.ts`, with `deferCommit`) always returns a promise, so under the synchronous driver a contract obligation is refused and the spike passes the meaning check as a plain function, unrecorded. Convert the contract path to steps (about 13 `await`s), so the synchronous driver records contract executions and facts in the manager exactly as the asynchronous one does, under F33's acceptance boundary (nothing is committed or published before every obligation passes).
2. **A synchronous strategy driver.** Convert the strategy interpreter (`src/framework/strategy/interpreter.ts`, about 27 `await`s) to steps with both drivers. Then make `optimizeTix` (`src/tensor/passes.ts`) run its pass list as a strategy plan under the synchronous driver, with the same revisions as today.
3. **Every pass on the runner.** Move every Typed pass (`src/typed/passes.ts`, built by `definePass`) and every Tix pass (`src/tensor/passes.ts`) onto the transformation type. Delete the synchronous runner's restriction (in `applyNativePassSync`, which refuses `needs`, `preserves` and contracts). Leave one runner: `applyPass` and `applyNativePassSync` are either removed with their callers migrated or reduced to wrappers of a few lines over `runTransformation`; say which and why.
4. **One encoding of the Tix meaning gate.** The spike added `tixMeaning` next to the invariant and contract that `tixAlgorithm` builds (F27); they are the same gate. Keep one.
5. **The cleanup rule.** The synchronous driver abandons a run with `return()`, which runs `finally` but not `catch`; put every cleanup the runner and the manager need in `finally`, and add a test that a rejected synchronous application leaves the manager and the store as the asynchronous one does.

Not in this step (phase 4): derivations, `decide` and plans for fusion and scheduling, Tix → CUDA as a cross-IR transformation, a tolerance bound as data, and the hand-written scheduling rule in `src/tensor/strategy.ts` (leave it working as it is).

Measure, with the spike's script (`{SPIKE}/scripts/04-revisions-and-timings.mjs`, copied into your ticket and extended), milliseconds per application for Tix `inline` on `corpus/tensor/attention` and Typed `strength`, before (the base, `v7-p2`) and after, in the same session; the machine is loaded, so report medians and ranges.
""", '- **Your tests** in `tests/framework/`: the cleanup test above; the synchronous driver records a contract execution; `optimizeTix` as a plan under the synchronous driver gives the same revision as today on every corpus program. The spike\'s `tests/framework/transformation-drivers.test.mjs` still passes.\n- **Existing tests** pass unchanged, except tests that assert the restriction you delete or an API you remove; list each such change.',
 'This step must not change them: every image, instruction count, edit record, CUDA source and Tix revision is byte-identical.',
 '`src/framework/` (passes, contracts, strategy, and their callers), `src/typed/passes.ts` and other Typed callers of the runners, `src/tensor/passes.ts`, `src/tensor/contract.ts`, `src/tensor/index.ts`, `src/workbench/` callers, and tests. Not `src/stdlib/` or `src/framework/dataflow/` (another step moves the solver now), and not the CUDA lowering (`src/tensor/cuda-*.ts`, `src/tensor/schedule.ts`; another step works there).')

solver = brief('library extraction', 'two hours', """The standard library lives in `src/stdlib/` (read `src/stdlib/index.ts` first: its admission rule, its layering, and the modules that exist: `flow/liveness.ts`, `graph/`, `lattice/`, `affine/`, `num/`, with `tests/stdlib/`). A library module is a pure, synchronous implementation of a named algorithm over a small shape interface, never over a domain's types, and it imports nothing outside `src/stdlib/` (`tests/stdlib/layering.test.mjs` enforces that). Every module needs at least two clients in the repository and an executable test, and it **moves** code that exists, rather than writing a second copy: each client must call the library and its old copy must be deleted.

## Your task: `stdlib/flow`, the dataflow fixpoint solver
Move the framework's fixpoint solver into `src/stdlib/flow/`: `solve` and its `FlowGraph`, `SolveOptions` and `Solution` types (`src/framework/dataflow/solver.ts`; it already takes its depth-first order from `stdlib/graph`). It iterates a monotone transfer function over a graph to a fixpoint, in either direction, widening at loop heads; it takes its lattice from the caller (the lattices are in `stdlib/lattice`). The framework's `dataflow` layer then re-exports it from the library, so its callers (`src/framework/dataflow/analysis.ts`, and through it Typed's dataflow analyses) keep working unchanged.

The second client is the library's own liveness (`src/stdlib/flow/liveness.ts`), which hardcodes its own backward fixpoint; the index says the solver "generalises it". Rewrite liveness on `solve` with a set lattice and the same results. Liveness runs inside the register allocator and the coalescer on every function, so measure the corpus compile time under `speed` before and after (the baselines script prints nothing about time; time the build of a few corpus projects, or write a probe) and report it. If the solver makes liveness more than about 10% slower on the corpus, say so and keep both, with the numbers.
""", '- **Your tests** in `tests/stdlib/`: the solver on small graphs with known fixpoints, forward and backward, with a loop that needs widening, and with an unreachable block; liveness through the solver equals the old liveness on generated graphs (compare against a copy of the old function kept inside the test).',
 'This step must not change them.',
 '`src/stdlib/flow/`, `src/stdlib/index.ts`, `src/framework/dataflow/` (solver, analysis, index), the import in `src/typed/analyses.ts`, and tests. Not `src/framework/passes/`, `src/framework/contracts/`, `src/framework/strategy/`, `src/typed/passes.ts` or `src/tensor/`: other steps change those now.')

f39 = brief('defect investigation and fix on the GPU', 'two hours', """## Your task: F39, an intermittent exactness rejection on the GPU
Tix lowers its tensor programs to CUDA (`src/tensor/schedule.ts` tiles contractions; `src/tensor/cuda-contraction.ts` and `src/tensor/cuda-source.ts` emit kernels; `src/tensor/cuda-contract.ts` and `src/tensor/cuda-runtime.ts` run them and compare the results with the interpreter, bit for bit). The GPU is on a remote machine: the `*-gpu.test.mjs` tests reach it through `tools/cuda-remote.mjs` (read it first; it compiles with `nvcc` and runs there over ssh). **You are the only agent using the GPU during your session**; run one GPU job at a time.

The defect: `tests/tensor/schedule-gpu.test.mjs:35` ("every tiled variant of the feature contractions is exact on every case (each variant forced)") failed once in four runs of the GPU suite, with the `batched` variant's lowering check returning `accepted: false`; it passed the other three times, once with `--test-concurrency=1`. The batched contraction is `t[b,i,j] = sum(k) a[b,i,k] * b[b,k,j]` in that test file. A result that changes between runs of the same kernel on the same input points at a race (missing synchronization between tile loads and reads, a shared-memory reuse across iterations, an out-of-bounds read of a tail), which would undercut every exactness claim the lowering makes. It could also be outside the kernel: the remote runner (a truncated transfer, a stale binary, two runs sharing a file name), or the checker's case generation.

1. **Reproduce:** run the batched variant's check in a loop (a probe in your ticket's `scripts/`, not the whole suite) until it fails, and record the failure rate. Capture the disagreeing case: the inputs, the positions that differ, the GPU and interpreter values.
2. **Find the cause,** with evidence (for example `compute-sanitizer --tool racecheck` or `--tool memcheck` on the remote machine, or a deterministic reproduction).
3. **Fix it** at the cause, and show the loop no longer fails over at least ten times as many runs as it took to fail before. If the cause is outside the kernel, fix it there.
""", '- **Your evidence,** in your report: the failure rate before and after, with the probe that measured it; the captured case; the cause.\n- **The GPU suite:** `tests/tensor/*-gpu.test.mjs` pass (you may run these).',
 'If your fix changes emitted CUDA, the baselines will show it: report every difference and why each is expected; do not re-record them.',
 '`src/tensor/schedule.ts`, `src/tensor/cuda-*.ts`, `tools/cuda-remote.mjs`, `tests/tensor/`, and your ticket. Not `src/tensor/passes.ts`, `src/tensor/strategy.ts`, `src/framework/` or `src/stdlib/`: other steps change those now.', gpu_ok=True)

for name, text, items in [('migration', migration, [('IRWB-052', 'fa', 'fable', 'default', 'claude-code-subagent')]),
                          ('solver', solver, [('IRWB-053-A', 'g-h', 'lunaroute/glm-5.3', 'high', 'pi'), ('IRWB-053-B', 'ds-x', 'lunaroute/deepseek-4.1-flash', 'xhigh', 'pi')]),
                          ('f39', f39, [('IRWB-054', 'ds-x', 'lunaroute/deepseek-4.1-flash', 'xhigh', 'pi')])]:
    os.makedirs(f'{P}/{name}', exist_ok=True)
    open(f'{P}/{name}/common.md', 'w').write(text)
    key = {}
    for item, cfg, model, effort, harness in items:
        open(f'{P}/{name}/{item}.md', 'w').write('')
        key[item] = dict(task=name, config=cfg, model=model, effort=effort, round=f'v7-{name}-{cfg}', harness=harness, **({'tools': 'read,bash,edit,write'} if harness == 'pi' else {}))
    json.dump(key, open(f'{T}/various/results/{name}-config-key.json', 'w'), indent=1)
print('ok')
