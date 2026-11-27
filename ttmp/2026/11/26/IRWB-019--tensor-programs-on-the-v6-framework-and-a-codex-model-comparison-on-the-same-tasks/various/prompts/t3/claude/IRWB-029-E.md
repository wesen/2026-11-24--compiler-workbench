You are an implementation agent in a comparison of agent configurations. Your git worktree is /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-fa-irwb-029-e (branch t3-fa/irwb-029-e). Run every command in it (cd there first), and change files only there. The task follows. Your final message is the one it specifies.

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

Tix has been built in two stages, each merged from one of several independent implementations:
- **Stage 1** (ticket IRWB-020-B): the front end, an IR as a v6 artifact, f32 and f64 evaluators, a meaning contract, and two checked passes (`inline`, `split-sum`).
- **Stage 2** (ticket IRWB-022-I): lowering to CUDA, one kernel per statement and one thread per output element, run and checked on an NVIDIA GB10.

Both tickets are under `ttmp/2026/11/26/`. Read their designs and final reports first, then the code.

Since stage 2, these changes have landed:
- the lowering is checked under the exact relation: bit-identical with the current revision's f32 meaning, NaN compared as a class;
- the stage-1 meaning gate gives every shape symbol a distinct size, and checks empty extents;
- `optimizeTix` steps carry `changed` and `reason`;
- concurrent checks share an in-flight GPU batch;
- `tools/cuda-remote.mjs` takes `--link <lib>`.

The tensor domain exists to test the framework, not to be a product. Where the framework does not fit, that is a finding. Each change you make to `src/framework/`, with its reason, is a primary result of this stage.

Your ticket is IRWB-029-E. This is an **implementation stage**, in one session. Write a short design first and commit it. Then implement, test, measure, and write a final report in the ticket.

## Stage 3 (yours): checked fusion
Stage 2 launches one kernel per statement. Every intermediate tensor goes through global memory, and the row reductions run one thread per row, with uncoalesced reads. Stage 3 fuses statements into fewer kernels **without changing any result bit.**

- **Fuse what the IR shows can be fused,** keeping each output element's evaluation order exactly as the f32 meaning prescribes. That covers:
  - elementwise chains;
  - epilogues: a pointwise statement over a reduction's result, such as `mlp`'s bias and GELU after its contraction;
  - row reductions with their producers and consumers: `softmax`'s max, exp, sum and divide, and `layernorm`'s mean, variance and normalization.
- **The thread mapping may change** where fusion needs it: for example, a block per row, with the row staged through shared memory so that loads are coalesced. Every reduction must still accumulate sequentially, in the meaning's order. Record each change and its reason.
- **Legality is decided from the Tix IR,** before a fusion is applied. A fusion that cannot be shown to keep the order is not applied. `checkLowering` checks the fused lowering on the GPU under the exact relation.
- **Decide where fusion lives,** and justify the choice: a pass on the Tix IR, a second v6 artifact (a kernel IR) between Tix and CUDA, or the emitter. The framework's correspondence may have to express many statements becoming one kernel. If it cannot, that is a finding.
- **Not yours:** anything that reassociates a reduction (parallel tree reductions, split-K), tiling of contractions for data reuse, FMA contraction, tensor cores, streaming attention, autotuning. Later stages cover them.

**What is known:**
- **The base is bit-exact,** so an order-preserving fusion can be checked under the exact relation, with no tolerance to justify.
- **Streaming bandwidth is 244 GB/s** (a `y = 2x` kernel). For `softmax` and `layernorm` at the sizes below, one read and one write of the 16 MB input take about 0.14 ms.
- **An earlier prototype** outside this repository fused `softmax` exactly (rows staged through shared memory) and ran 4.25× faster than stage 2, bit-identical.

**The stage-2 kernels,** single timed runs (they vary by up to 2×):

| Program (`corpus/tensor/<name>/main.tix`) | Sizes, in the program's shape names | Stage-2 GPU time |
|---|---|---|
| matmul | M = K = N = 512 | 0.197 ms |
| softmax | N = 4096, C = 1024 | 0.785 ms |
| layernorm | N = 4096, D = 1024 | 0.563 ms |
| attention | Q = K = 1024, D = V = 64 | 1.81 ms |
| mlp | N = 1024, D = 256, H = 1024, O = 256 | 1.05 ms |
| conv2d | N = 8, C = 16, H = W = 64, O = 32 (3 × 3 kernel) | 0.341 ms |

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
- **`fuse`** defaults to `true`, your fused lowering. `fuse: false` is stage 2's lowering, one kernel per statement, unchanged.
- **`gpuMs`** is, as before, the time of the function's kernels on the GPU (CUDA events), without transfers or start-up.
- **`benchmark: true`** times one warm-up launch and reports the median of three timed runs, under the tool's `--timed` lock. The base's `runCudaBatch` already does this; expose it.
- **The kernel count** of a lowering is the number of `__global__` function definitions in `cudaSource`.

`compileTix`, `runTix` and `optimizeTix` keep their signatures and behaviour, and so does every function the base exports. Implementations are compared on this API, by hidden tests:
- fused results bit-identical to the f32 meaning, on the corpus and on random programs;
- `checkLowering` accepting the fused lowering as `exact`;
- kernel count;
- benchmark time at the sizes above.

## Measure and report
For each corpus program at the sizes above, fused and unfused, measure:
- the kernel count;
- the benchmark GPU time;
- the bytes each kernel reads and writes in global memory, by your count;
- the time those bytes would take at 244 GB/s.

Also report:
- which fusions applied, and which legal-looking fusions you refused and why;
- the framework and tool changes, each with its reason;
- what the contract checks and what it costs.

Put the final report in the ticket. Say which results you measured and which you only argued.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Prettier: 110 columns, single quotes; run it only on files that were formatted before you changed them.
- **Read first:** `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/passes/define-pass.ts`, and `src/tensor/`.
- **The GPU machine** is reached only through `tools/cuda-remote.mjs` (read its header). About twelve agents share it: use `--timed` (or `benchmark`) only for measurements, and keep those runs short. Keep tests that need the GPU in their own test file, so that the other tests run without it.
- **Sandboxed sessions:** your sandbox has network access, so `ssh` works. A test that spawns `node` can fail with EPERM. Request escalation for that command.
- **Scope:** you may change `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and `src/framework/` and `tools/cuda-remote.mjs` where the stage needs it. Do not modify `src/typed/`, `corpus/projects/`, other tools or existing tests outside `tests/tensor/`, except framework tests that a framework change makes necessary. Do not run the full suite (`npm test`): other agents share this machine.
- **Scripts:** put every probe, benchmark and temporary program you write in your ticket's `scripts/` directory, numbered in the order you write them (`01-name.mjs`), and commit them. Nothing you ran should exist only in a scratch directory or a one-off command.
- **Tickets and commits:** use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-029-E:`, as you go, so that your last commit always holds working code. Do not push.
- **Outside your worktree,** use only the GPU machine.

## Final message
- the ticket, design and report paths;
- where fusion lives, and why;
- the kernel counts and benchmark times, fused and unfused, per corpus program;
- the framework and tool changes;
- the last commit hash.
