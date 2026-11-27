You are an implementation agent in a comparison of agent configurations. Your git worktree is /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3b-fa-irwb-030-e (branch t3b-fa/irwb-030-e). Run every command in it (cd there first), and change files only there. The task follows. Your final message is the one it specifies.

## Standing instructions
When writing a design, specification or plan (as opposed to changing code now):
- State the supported input domain explicitly and specify behaviour only within it. Do not add status codes, error precedence or guarantees about state on failure for inputs outside it unless the user asks for them.
- For each significant decision, name the simplest alternative that would serve the goal and say why it was chosen or why it falls short. In design documents, decision records and reviews, comparing alternatives is requested; contrastive phrasing is allowed for that purpose.
- Covering every part of a request means addressing each requested item, not maximizing its depth. Prefer the smallest deliverable that fully meets the goal, and list what you left out and why.
- Describe only what can be built with the current code. Work that depends on missing features gets one line each in a "Later" list.
- If a small piece of infrastructure is missing, propose the change instead of designing around it.
When the brief specifies a language, grammar or API:
- Accept everything the brief fixes; that surface is not yours to narrow. Cover it with the simplest method that works. Where full generality would need machinery no example uses (for example solving for a shape name that appears only inside an affine dimension), reject that case with an ordinary error and list the general case under "Later".
- Rely on the assumptions the brief states about inputs (for example "inputs are finite"). Do not specify checks, encodings or rules for inputs that violate them.
- Specify an error only by where it is detected and what its message says. Do not define error classes, codes, precedence or recovery beyond those the brief names.
- Build one path for each job. Do not plan a second implementation of the same job (a synchronous and an asynchronous checker, a fast and a reference verifier) unless the brief requires both.
- Justify every numeric threshold (a tolerance, a case count, a block size) by an error argument or a measurement, not by a round number.
In all tasks: before relying on a language, library, loader or tool feature you have not seen work in this repository, run a minimal probe and state the result.
Work only from the files in your worktree (and any outside repository your task names). Do not read other git branches, other worktrees, or other agents' tickets.

## The task
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
- **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`).

Tix has been built in three stages, each merged from one of several independent implementations:
- **Stage 1** (ticket IRWB-020-B): the front end, an IR as a v6 artifact, f32 and f64 evaluators, a meaning contract, and two checked passes (`inline`, `split-sum`).
- **Stage 2** (ticket IRWB-022-I): lowering to CUDA, one kernel per statement and one thread per output element, run and checked on an NVIDIA GB10.
- **Stage 3** (ticket IRWB-029-D): checked fusion. `planFusion` (`src/tensor/fusion.ts`) decides groups from the Tix IR, and the emitter prints each group as a thread-mode kernel (registers) or a block-mode kernel (one block per row, rows in shared memory or global scratch). Every corpus program lowers to one kernel, bit-identical to the f32 meaning; `fuse: false` is stage 2's lowering.

All three tickets are under `ttmp/2026/11/26/`. Read stage 3's design and final report first, then stage 2's, then the code.

Since stage 2, these changes have landed:
- the lowering is checked under the exact relation: bit-identical with the current revision's f32 meaning, NaN compared as a class;
- the stage-1 meaning gate gives every shape symbol a distinct size, and checks empty extents;
- `optimizeTix` steps carry `changed` and `reason`;
- concurrent checks share an in-flight GPU batch;
- `tools/cuda-remote.mjs` takes `--link <lib>`.

The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.

Your ticket is IRWB-030-E. This is an **implementation stage**, in one session. Write a short design first and commit it. Then implement, test, measure, and write a final report in the ticket.

## Stage 3b (yours): fusion that is never slower
Stage 3's fusion is exact, but on some programs it is slower than stage 2. The cause is where the work of a row reduction runs:
- In block mode, a per-row statement such as `mu[i] = sum(d) x[i, d] / D` runs on thread 0 of the row's block, with the reduction's whole body inlined into its loop. Every term, here a division, is computed serially by one thread.
- Stage 2 runs the same reduction one thread per row, all rows at once. When the body is costly, the fused kernel loses that concurrency.

Measured on the merged stage 3, `benchmark` medians at the sizes below. "Inside" divides each term inside the reduction; "outside" divides the reduced value, as `corpus/tensor/` does. The two placements are different f32 programs; each must stay exact.

| Program | Division | Fused | Unfused |
|---|---|---|---|
| layernorm | outside: `mu[i] = (sum(d) x[i, d]) / D` | 0.191 ms | 0.484 ms |
| layernorm | inside: `mu[i] = sum(d) x[i, d] / D` (and the same for the variance) | 0.569 ms | 0.577 ms |
| attention | outside: `s = (sum(d) q * k) / sqrt(D)`, then `w = e / l`, then `o = sum(j) w * v` | 0.767 ms | 1.048 ms |
| attention | inside: `s = sum(d) q * k / sqrt(D)`, then `o = sum(j) e * v / l[i]`, with no `w` statement | 1.412 ms | 1.503 ms |
| softmax | (as in the corpus) | 0.386 ms | 0.797 ms |
| mlp | (as in the corpus) | 0.880 ms | 1.063 ms |

Other stage-3 implementations, with different plans, were up to 2× slower than unfused on the "inside" programs.

Your stage:
- **Compute a reduction's terms in parallel and accumulate them in order.** A term such as `x[i, d] / D` does not depend on the accumulator, so any thread can compute it, for example into shared memory. One thread then adds the computed terms in the meaning's order. Each term is rounded as before and the sum keeps its order, so the result is bit-identical. Decide which bodies this applies to from the IR, and record what you refuse and why.
- **Fuse only where fusion is not slower.** Add a decision, from the IR and, if you need them, the shape values at launch, that keeps a program or a group unfused (or in a different mode) when fusing would be slower. Justify the rule by measurement, not by a round number.
- **Keep stage 3's guarantees:** bit-identical results under the exact relation, legality decided from the Tix IR before a fusion is applied, and `fuse: false` printing stage 2's lowering unchanged.
- **Not yours:** anything that reassociates a reduction (parallel tree reductions, split-K), tiling of contractions for data reuse, FMA contraction, tensor cores, fast `exp` or other intrinsics, streaming attention, autotuning. Softmax's remaining time is bound by the exactly rounded `exp`; that is a later stage.
- **Known framework gap, handled elsewhere:** a correspondence's entity lists are declared by the caller and not compared with the artifacts' entities. Another ticket fixes that in `src/framework/ir/`; do not change the correspondence code.

**What is known:**
- **Streaming bandwidth is 244 GB/s** (a `y = 2x` kernel). For `softmax` and `layernorm` at the sizes below, one read and one write of the 16 MB input take about 0.14 ms.
- **Run-to-run noise:** identical sources differ by up to about 2% between `benchmark` calls; unfused times of the same program differ by up to 5% between sessions.

**Sizes,** in the corpus programs' shape names (`corpus/tensor/<name>/main.tix`):

| Program | Sizes |
|---|---|
| matmul | M = K = N = 512 |
| softmax | N = 4096, C = 1024 |
| layernorm | N = 4096, D = 1024 |
| attention | Q = K = 1024, D = V = 64 |
| mlp | N = 1024, D = 256, H = 1024, O = 256 |
| conv2d | N = 8, C = 16, H = W = 64, O = 32 (3 × 3 kernel) |

## Tix, fixed core (unchanged)
```
program := fn+
fn      := 'fn' NAME '(' param (',' param)* ')' ':' type '{' stmt* 'return' NAME ';' '}'
param   := NAME ':' type
type    := 'f32' '[' dim (',' dim)* ']'        dim := affine expression of shape names and integers (N, D, H - 2)
stmt    := NAME '[' NAME (',' NAME)* ']' (':' type)? '=' expr ';'
expr    := expr ('+' | '-' | '*' | '/') expr | '-' expr | NUMBER | SHAPENAME | ref | call | reduce | '(' expr ')'
ref     := NAME '[' aff (',' aff)* ']'           aff := affine expression of index names and integers (y + dy)
call    := ('exp' | 'log' | 'sqrt' | 'tanh') '(' expr ')' | ('max' | 'min') '(' expr ',' expr ')'
reduce  := ('sum' | 'max') '(' NAME (',' NAME)* ')' expr
```
- **f32 meaning:** every literal, shape value, operation and function result is rounded to f32. `sum` starts at 0 and `max` at −∞, and both accumulate in increasing lexicographic order of their indices, the first listed outermost, rounding after each step.
- **Everything else** (precedence, a reduction's body extent, extent inference, shadowing, empty extents) is as in stage 1 and the base implements it.

## Fixed API (in `dist/tensor/index.js` after the build)
```ts
cudaSource(program: TixProgram, fn: string, options?: { fuse?: boolean }): string
runTixCuda(program: TixProgram, fn: string,
           inputs: Record<string, { shape: number[]; data: Float32Array }>,
           options?: { host?: string; fuse?: boolean; benchmark?: boolean })
  : Promise<{ shape: number[]; data: Float32Array; gpuMs: number }>
checkLowering(program: TixProgram, fn: string, options?: { fuse?: boolean })
  : Promise<{ accepted: boolean; relation: 'exact' | 'tolerance'; reason?: string }>
```
- **`fuse`** defaults to `true`, your lowering (stage 3's, improved). `fuse: false` is stage 2's lowering, one kernel per statement, unchanged.
- **`gpuMs`** is, as before, the time of the function's kernels on the GPU (CUDA events), without transfers or start-up.
- **`benchmark: true`** times one warm-up launch and reports the median of three timed runs, under the tool's `--timed` lock. The base's `runCudaBatch` already does this; expose it.
- **The kernel count** of a lowering is the number of `__global__` function definitions in `cudaSource`.

`compileTix`, `runTix` and `optimizeTix` keep their signatures and behaviour, and so does every function the base exports. Implementations are compared on this API, by hidden tests:
- fused results bit-identical to the f32 meaning, on the corpus and on random programs;
- `checkLowering` accepting the fused lowering as `exact`;
- kernel count;
- benchmark time at the sizes above, on the corpus programs and on variants of them (such as the "inside" placements), fused against unfused.

## Measure and report
For each corpus program, and for the "inside" variants of layernorm and attention, at the sizes above, fused and unfused, measure:
- the kernel count;
- the benchmark GPU time (median of several `benchmark` calls; say how many);
- for each block-mode kernel, which reductions use parallel terms.

Also report:
- the rule that decides between fusing and not fusing, and the measurements behind it;
- which fusions and term stagings you refused and why;
- the framework and tool changes, each with its reason;
- what the contract checks and what it costs.

Put the final report in the ticket. Say which results you measured and which you only argued.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Prettier: 110 columns, single quotes; run it only on files that were formatted before you changed them.
- **Read first:** `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/passes/define-pass.ts`, and `src/tensor/`.
- **The GPU machine** is reached only through `tools/cuda-remote.mjs` (read its header). About eleven agents share it: use `--timed` (or `benchmark`) only for measurements, and keep those runs short. Keep tests that need the GPU in their own test file, so that the other tests run without it.
- **Sandboxed sessions:** your sandbox has network access, so `ssh` works. A test that spawns `node` can fail with EPERM. Request escalation for that command.
- **Scope:** you may change `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and `src/framework/` and `tools/cuda-remote.mjs` where the stage needs it. Do not modify `src/typed/`, `corpus/projects/`, other tools or existing tests outside `tests/tensor/`, except framework tests that a framework change makes necessary. Do not run the full suite (`npm test`): other agents share this machine.
- **Scripts:** put every probe, benchmark and temporary program you write in your ticket's `scripts/` directory, numbered in the order you write them (`01-name.mjs`), and commit them. Nothing you ran should exist only in a scratch directory or a one-off command.
- **Tickets and commits:** use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-030-E:`, as you go, so that your last commit always holds working code. Do not push.
- **Outside your worktree,** use only the GPU machine.

## Final message
- the ticket, design and report paths;
- how terms are staged, and the rule that decides whether to fuse;
- the kernel counts and benchmark times, fused and unfused, per corpus program and for the two "inside" variants;
- the framework and tool changes;
- the last commit hash.
