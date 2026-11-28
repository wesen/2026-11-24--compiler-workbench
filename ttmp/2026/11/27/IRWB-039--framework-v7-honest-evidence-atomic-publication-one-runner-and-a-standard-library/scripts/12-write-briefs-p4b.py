#!/usr/bin/env python3
# IRWB-039 / IRWB-059: briefs for phase 4b: term rules (IRWB-060), cross-IR lowering (061), staged choice (062),
# one coverage check (063). Header and facts from the step-3 lane brief; every brief points at the IRWB-059 intern
# guide and asks for a detailed investigation-format diary (the user, 2026-11-28).
import json, os, re
T = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = T + '/various/prompts'
TK = 'ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library'
GUIDE = 'ttmp/2026/11/28/IRWB-059--v7-phase-4b-rules-over-a-term-signature-lowering-as-cross-ir-transformations-staged-choice/design-doc/01-intern-guide-the-ir-workbench-and-phase-4b-term-rules-cross-ir-lowering-staged-choice.md'
SYN = 'ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/index.html'
g = open(P + '/graph/common.md').read()
head = g[: g.index('This is a **')]
head = head.replace('(ticket `' + TK + '/`, design doc `design-doc/01-...md`)', '(ticket `' + TK + '/`, design doc `design-doc/01-...md`; this round is ticket IRWB-059)')
facts_tail = g[g.index('## Repository facts'):]
DIARY = ('Create your ticket with docmgr under `ttmp/2026/11/28/`. **Read the intern guide first:** `' + GUIDE + '` explains the system and this round, including your lane. '
         'Keep a **detailed diary** in your ticket (`reference/01-diary.md`) as you work, one step per significant action (a design decision, a change, a failure and its fix, a measurement, a commit), more often than you commit. '
         'Each step has: a short prose summary; Prompt Context (the task, quoted once in step 1); What I did; Why; What worked; What didn\'t work (exact commands and error text); What I learned; What was tricky; What warrants a second pair of eyes; Code review instructions. '
         'Write a short design note before you change code, and end with a report in the ticket.')
def brief(kind, time, body, tests, baseline, scope):
    rf = re.sub(r'- \*\*Scope:\*\*.*\n', lambda m: '- **Scope:** ' + scope + '\n', facts_tail)
    rf = rf.replace('Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files (there is no GPU here): other agents share this machine.',
                    'Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files: other agents share this machine, and the coordinator runs the GPU suite at merge.')
    acc = ('## Acceptance (all of these, checked on your last commit)\n' + tests + '\n'
           '- **The baselines:** `node ' + TK + '/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. ' + baseline + '\n'
           '- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.\n'
           '- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.\n\n')
    return head + f'This is a **{kind}**, in one session of up to {time}. {DIARY}\n\n' + body + '\n' + acc + rf

terms = brief('library module and two domain ports, with a decision point', 'three hours', f"""## Your task: rules over a term signature (phase 4, item 4.6), and F40
Read the R3 synthesis (`{SYN}`) library row **terms** and the migration step "Rules over a term signature", after the guide.

Typed already keeps its rewrite rules as data (`src/typed/rules/`: the tables in `simplify.ts`, `fold.ts`, `identities.ts`; the matcher `matchPat`, `firstMatch`, `indexRules` and guards in `compile.ts`; rule verification in `verify.ts`), but the matcher and the verifier are written against Typed's value handles. Tix's `inline` and `split-sum` (`src/tensor/passes.ts`) are hand-written rewrites of Tix expressions. Several places compare trees by hand (R3 counted `sameTree` twice, LVN and LICM keys, and copies of the matcher in A0's tools).

1. **`src/stdlib/term/`:** terms over a signature (a small interface a domain implements: operator, arity, children, constant), structural hash and equality, `match` and `instantiate` for patterns with variables, and a rule-verification interface (`verifyRule` over the signature plus a domain-supplied semantics and case generator), stated in standard terms (first-order rewriting; Alive-style validation of a rule by evaluation on generated cases).
2. **Typed on it:** the rule tables match and instantiate through the library over Typed's signature, and `verify.ts` verifies through the library's interface with Typed's semantics. The edit records, the derivations (rule ids, 183 rule-citing O2 records since IRWB-056-B) and every image must not change.
3. **Tix on it:** `inline` and `split-sum` as rules over Tix's expression signature, through the same library.
4. **F40:** Tix `inline`'s correspondence still says `removed` for a merged statement (the merge is only in the derivation, `mergedInto`). Record it truthfully as `merged`, as IRWB-056-A did (`git show v7-derivations-g-h/irwb-056-a:src/tensor/passes.ts`), and update the equality test that pinned the old entry.

**Decision point:** measure the rule path against today's compiled matcher on the O2 corpus (interleave both in one process; the machine is loaded). If the library path is materially slower (more than about 10% of compile time), keep Typed's compiled visitor, share only the matcher and the verifier, and report the numbers.
""", '- **Your tests** in `tests/stdlib/`: match and instantiate on small signatures, hash and equality laws (equal terms hash equally), a rule verified and a wrong rule refused with a counterexample; Tix `inline` and `split-sum` give the same revisions as before on every corpus program; the F40 correspondence test.',
 'This step must not change them: images, instruction counts, edit records and CUDA stay byte-identical.',
 '`src/stdlib/term/` (new), `src/stdlib/index.ts`, `src/typed/rules/`, the Typed passes that apply rules, `src/tensor/passes.ts`, and tests. Not `src/framework/`, `src/typed/backend/`, `src/tensor/schedule.ts`, `cuda-*.ts` or `index.ts`: other lanes change those now.')

lowering = brief('framework concept applied to both domains', 'four hours', f"""## Your task: lowering as cross-IR transformations (phase 4, item 4.2)
Read the R3 synthesis (`{SYN}`) section **K1 · Typed transformation** (ports in, ports out; an endomorphic pass is the special case) and the migration step "Cross-IR transformations", after the guide.

Every pass is now a `Transformation` run by `runTransformation` (`src/framework/passes/transformation.ts`), but a transformation maps an IR to itself. The two lowerings sit outside it:
- **Typed → RV32:** `lowerToImage` (`src/typed/backend/compile.ts`, around line 442) is a plain function returning the image and `imageCorrespondence` (`src/typed/backend/image.ts`). Its meaning check, `rv32.image-agrees` (`src/typed/backend/run.ts`, `imageAgrees`), runs only in tests and workbench views.
- **Tix → CUDA:** `tensor.lower-cuda` (`src/tensor/cuda-contract.ts`, `createCudaLowering`) is declared with `defineTransformation`, a correspondence (`kernelCorrespondence`) and the `tensor.cuda-meaning` invariant, but it runs through the manager's asynchronous `execute`, and the path callers use, `cudaSource()` in `src/tensor/index.ts`, bypasses it.

1. **`Transformation<In, Out>`:** generalize the transformation type and the runner to an input IR and an output IR, with today's same-IR passes as the special case (no change for them). Publication, derivations and correspondence across the boundary follow the existing rules.
2. **Typed lowering on the runner:** `lowerToImage` becomes a transformation from `typed.blocks` to `rv32.image` with relation `exact`, `rv32.image-agrees` as its `ensures`, and the image correspondence as its declared output; the callers use it.
3. **Tix lowering on the runner:** `tensor.lower-cuda` runs on the runner (asynchronous driver: the check runs on the remote GPU), and `cudaSource()` produces its source through the same transformation without the GPU check (a declared, recorded choice, not a bypass). Optionally pass the kernel manifest to `runTixCuda` so the emitter's source-hash side table (`emittedKernels`) can go.
4. **Composition:** the correspondence from Tix statements to kernels, composed through the schedule passes and the emission, must equal today's `kernelCorrespondence`; the Typed one must equal `imageCorrespondence`.
""", '- **Your tests** in `tests/framework/` and the domains: a same-IR pass is unchanged; the Typed lowering rejects a planted wrong image (for example one instruction changed) through its `ensures`; the composed correspondences equal today\'s on the whole corpus; `cudaSource()` output is byte-identical.',
 'This step must not change them: image bytes, instruction counts and CUDA source stay byte-identical.',
 '`src/framework/passes/`, `src/framework/contracts/` (only what cross-IR ports need), `src/typed/backend/compile.ts`, `image.ts`, `run.ts` and their callers in `src/typed/` and `src/workbench/`, `src/tensor/cuda-contract.ts` (not `modesOf`), `src/tensor/index.ts`, `src/tensor/cuda-runtime.ts` (only to take the manifest), and tests. Not `src/stdlib/`, `src/typed/rules/`, `src/tensor/passes.ts`, `schedule.ts`, `cuda-source.ts`, or `src/framework/ir/derivation.ts`: other lanes change those now.')

staged = brief('framework concept applied to a domain', 'three hours', f"""## Your task: staged choice (phase 4, item 4.8)
Read the R3 synthesis (`{SYN}`) section **K6 · Decisions as data** ("Plus staged choice: a launch-time variant with its guard, so the differential's arms are derived") and the migration step "Staged choice", after the guide.

Some of a CUDA lowering's choices are made at launch time, when the shapes are known: a fused kernel can have a gate (a fused and an unfused path), and a tiled contraction has several variants with a launch rule (`select` entries with `minBlocks`/`minTerms`, `src/tensor/schedule.ts`). Since IRWB-057 the emitter returns a manifest (`emitScheduleProgram` in `src/tensor/cuda-source.ts`), and the meaning check enumerates its cases' modes from it (`modesOf` in `src/tensor/cuda-contract.ts`). The gate and the variant rule are two different encodings of one idea.

1. **One construct:** a launch-time `select` in the schedule IR: a guard over launch-time values (grid size, number of terms, the gate's condition) and its arms. The gate and the variants with their launch rule become instances of it.
2. **The emitter and the runtime** print and evaluate it; the manifest describes it.
3. **Derived arms:** the differential's modes are derived from the `select` (every arm checked; adding an arm adds its check). Change `modesOf` in `src/tensor/cuda-contract.ts` to that derivation and nothing else in that file (another lane changes the rest of it now).
4. **Guard coverage:** report an arm that no launch can reach, and a launch that no arm accepts (today's rule requires a last entry that accepts every grid).
""", '- **Your tests** in `tests/tensor/`: the derived modes equal today\'s modes for every corpus program and the schedule tests\' kernels; a schedule with an extra arm gets that arm checked without other changes; an unreachable arm and an uncovered launch are reported.',
 'This step must not change them: CUDA source stays byte-identical.',
 '`src/tensor/schedule.ts`, `src/tensor/strategy.ts`, `src/tensor/cuda-source.ts`, `src/tensor/cuda-runtime.ts` (the gate and variant evaluation only), `modesOf` in `src/tensor/cuda-contract.ts`, and tests. Not `src/tensor/passes.ts`, `src/tensor/index.ts`, `src/framework/`, `src/stdlib/` or `src/typed/`: other lanes change those now.')

coverage = brief('small framework fix', 'one hour', """## Your task: F41, one coverage check for correspondences
The coverage vocabulary for correspondences exists twice: `DerivationCoverage` in `src/framework/ir/derivation.ts` (added by IRWB-056-B) mirrors `CorrespondenceCoverage`, whose only check lives in the analysis manager (`src/framework/contracts/analysis-manager.ts`; F35 added it: `partial`, `nonempty`, `source`, `target`, `both`). Make one type and one check over `EntityCorrespondence` in `src/framework/ir/correspondence.ts`, used by both the manager and the derivation code, and delete the duplicate.
""", '- **Existing tests** pass unchanged, in particular the F35 tests in `tests/framework/r3-defects.test.mjs` and `tests/framework/derivation.test.mjs`.',
 'This step must not change them.',
 '`src/framework/ir/correspondence.ts`, `src/framework/ir/derivation.ts`, the coverage check in `src/framework/contracts/analysis-manager.ts` (nothing else there), and tests. Nothing else: other lanes change `src/framework/passes/`, the rest of the manager, `src/stdlib/`, `src/typed/` and `src/tensor/` now.')

lanes = [('terms', terms, [('IRWB-060-A', 'g-h', 'lunaroute/glm-5.3', 'high', 'pi'), ('IRWB-060-B', 'ds-x', 'lunaroute/deepseek-4.1-flash', 'xhigh', 'pi')]),
         ('lowering', lowering, [('IRWB-061', 'fa', 'fable', 'default', 'claude-code-subagent')]),
         ('staged', staged, [('IRWB-062', 'sl', 'gpt-6.2-sol', 'low', 'codex')]),
         ('coverage', coverage, [('IRWB-063', 'tl', 'gpt-6.1-terra', 'low', 'codex')])]
for name, text, items in lanes:
    os.makedirs(f'{P}/{name}', exist_ok=True)
    open(f'{P}/{name}/common.md', 'w').write(text)
    key = {}
    for item, cfg, model, effort, harness in items:
        open(f'{P}/{name}/{item}.md', 'w').write('')
        key[item] = dict(task=name, config=cfg, model=model, effort=effort, round=f'v7-{name}-{cfg}', harness=harness, **({'tools': 'read,bash,edit,write'} if harness == 'pi' else {}))
    json.dump(key, open(f'{T}/various/results/{name}-config-key.json', 'w'), indent=1)
print('ok')
