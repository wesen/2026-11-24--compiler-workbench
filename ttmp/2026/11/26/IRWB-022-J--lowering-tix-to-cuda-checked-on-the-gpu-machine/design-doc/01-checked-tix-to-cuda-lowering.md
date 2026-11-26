---
Title: Checked Tix to CUDA lowering
Ticket: IRWB-022-J
Status: active
Topics:
    - compiler
    - ir
    - verification
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/analysis-manager.ts
      Note: Mixed-port transformation acceptance
    - Path: repo://src/framework/contracts/differential.ts
      Note: Async batch delegation and verdict reuse
    - Path: repo://src/tensor/evaluate.ts
      Note: Stage 1 f32 and f64 reference behavior
    - Path: repo://src/tensor/model.ts
      Note: Resolved tensor expressions and generated extent forms
    - Path: repo://tools/cuda-remote.mjs
      Note: GPU transport and compilation changes
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T15:11:53.450301665-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked Tix to CUDA lowering

Emit a complete CUDA translation unit from the selected function in `program.current`. Check that exact
source on the GB10 against the current revision's interpreters. Stage 1 already checks any change made by
`inline` or `split-sum`. Comparing the backend to the origin would charge the lowering for an earlier rewrite
and would use a different reduction tree after a split.

## Supported inputs and execution

Support functions from `compileTix` and `optimizeTix`, including functions returning a parameter, zero-sized
axes, nested reductions, shadowed binders and generated block/tail extents. A run takes the selected function's
named, finite, row-major `Float32Array` inputs with consistent concrete shapes and matching lengths. Affine
dimensions and accesses must be valid for the supplied shapes, with integer arithmetic exact in JavaScript
and representable in signed 64-bit CUDA index arithmetic. The materialized buffers, launch grids and kernel
arguments must fit the target. Finite input elements can yield nonfinite results.

- `cudaSource(program, fn)` is synchronous and deterministic. Its output is a complete translation unit for the
  named function. Use generated identifiers for tensors, shapes, binder IDs and temporaries, including IDs
  containing `/block` and `/lane`. Do not paste user names or decimal spellings into C expressions.
- Emit one kernel per statement. A thread checks its flat index against the result size, decodes it from the
  last dimension backward and stores one value. Affine reads use the same row-major multiply-add sequence as
  the interpreter, in integer arithmetic. The host launches statements in order on one stream, with a distinct
  buffer per definition. A zero-sized statement has a kernel definition and no launch. A parameter return
  uses the parameter buffer. Empty tensors get a valid placeholder pointer, with no transfer of elements.
- Emit each reduction as nested loops, first listed binder outermost, with a fresh accumulator for each
  expression evaluation. Start sums at +0 and maxima at −∞. Emit each split-sum level as its own reduction.
  Compute block count by quotient and remainder and lane count by `min(width, dim - width * block)`, using
  the shared `width`. Inline's composed affine addresses go through the ordinary load emitter.
- `runTixCuda(program, fn, inputs, {host}?)` stages that same source, invokes the tool as a child asynchronously,
  and returns an owned `Float32Array`, shape and event time. It executes the supplied inputs directly. The
  separate `checkLowering(program, fn)` API returns the verdict for the sampled contract, with
  `relation: 'tolerance'` and the first counterexample or execution failure in `reason` when rejected.

Specializing CUDA to each concrete shape would remove the dynamic decode but would require a source per
sample and could not implement `cudaSource(program, fn)`. Emit shape-generic kernels. A kernel IR would let a
consumer inspect or rewrite the device program independently. This stage has one emitter, one fixed mapping
and no such consumer. Use the generated CUDA text as a typed transformation output without a second v6
artifact. Temporary names and lexical emission state suffice.

### Numeric operations

Use the tool's `nvcc -O3 -arch=sm_121` policy with no fast-math flags. Emit the following operations explicitly,
without relying on the compiler's default contraction of a C multiply plus add.

| Tix operation | Emission |
| --- | --- |
| Literal | `Math.fround(Number(text))` in Node, then emit the word with `__uint_as_float` |
| Shape as scalar | `__ll2float_rn` on the bound integer |
| `+`, `-`, `*`, sum step | `__fadd_rn`, `__fsub_rn`, `__fmul_rn`, `__fadd_rn` respectively |
| `/` | Widen both operands, `__ddiv_rn`, then `__double2float_rn` |
| Unary minus | Negate the f32 operand, including zero |
| `exp`, `log`, `sqrt`, `tanh` | Call the double overload on a widened f32 operand, then `__double2float_rn` |
| `min`, `max`, max step | Explicit NaN propagation and signed-zero tie handling as in the probe, then a comparison |

Direct f32 instructions suffice for add, subtract and multiply on f32 inputs with round-to-nearest and
subnormals enabled. Widening division and the intrinsic calls follows the evaluator's double operation and
f32 conversion. CUDA double libm can differ from V8. Standard `fminf`/`fmaxf` can select a numeric operand
when the other operand is NaN, so they cannot implement the Tix policy by themselves.

## What the GPU probe established

The [replay script](../scripts/02-probe-numerics.mjs) sent a standalone CUDA program through
`tools/cuda-remote.mjs` to `manuel@bling` with the default compiler policy. Run `f7f8f0762d633ff4` compiled
and returned 65,536 rows covering signed zeros, subnormals, extreme finite f32 words and seeded inputs.
The executable reported NVIDIA GB10, sm_121, CUDA runtime 13.0 and a positive CUDA event interval. An
identical retry used the current tool's compile cache and reproduced the numeric observations.
Every probed non-NaN word matched the Node 24 f32 expression, including the seven-term sum whose f32 result
is 1. The log column had 32,828 NaN word differences. For example, for `log(-1)` Node's returned word in the
probe was `0x7fe00000` and the GPU's was `0xffc00000`. Output classifications and zero signs agreed
throughout. The evidence supports the proposed operation choices and rules out claiming bit identity for
those choices. It does not exhaust operand combinations or composed programs.

For finite pairs, the largest ratio of observed error to `2e-6 + 2e-5 * abs(f64)` was about 0.003 for the
individual operations and 0.00813 for the seven-term sequential sum. A separate cancellation column for
`(2^24 + 1) - 2^24` gave CPU and GPU f32 = 0 and f64 = 1. A fixed f64 envelope on every output would
therefore reject faithful executions. Conversely, merely scaling the envelope by an arbitrarily large f32
deviation could accept a backend that changed how that cancellation behaves.

## Checked pass and evidence reuse

Use a versioned `defineTransformation` with inputs `{ input: TixIR, fn: FunctionName }` and a CUDA text
output, plus an async differential invariant binding those ports. The transformation's `run` calls the same
emitter as `cudaSource`. `checkLowering` calls `AnalysisManager.execute`, so the compiled output is the
subject of an awaited postcondition. Use a manager scoped to each check and recover rejections from its
recorded postcondition evidence, including the first counterexample. The manager may accept the output
only after the check. Record evidence as sampled. Set transformation body caching to `never` because
source emission is cheap and verdict reuse belongs to the differential checker. Raw source and execution APIs are separate entry points for inspecting source
and running user inputs. Neither is needed to publish a checked transformation.

The established `definePass` runners take one adapter/native type, enforce graph writes and describe a
same-IR edit. Reworking them for heterogeneous ports would add a second way to express a check already
supported by `defineTransformation`. No changes to `src/framework/` are proposed. The Node 24 probe used
an actual Tix artifact, a scalar output port and a Promise-returning `DifferentialSpec.decide` under
`AnalysisManager.execute`. Two applications of the same output and one changed output produced two delegate
calls in total. The changed output was rejected. This is the pass/API integration path to use.

### Contract cases and relation

Generate cases from the selected current function alone. Reuse the Stage 1 seed 20 streams of signed,
positive, half-ULP and alternating signed-zero inputs. Try shape values 0, 1, 3, 4, 7 and the mixed 3/5/7
assignment in sorted symbol order. Deduplicate shapes and filter with the Stage 1 bounded evaluation path
(4,096 elements per tensor and one million scalar/loop visits per case). Keep zero extents when their
affine shapes and accesses permit them. Precompute both f32 and f64 references on the same f32 input words.
Do not let the candidate choose eligible cases or coordinates. Require at least one valid sampled case
and require a GPU result for each eligible case.

Compare the returned shape and element count first. For an element with f64 reference `r` and f32
reference `s`, define `budget(x) = 2e-6 + 2e-5 * abs(x)`.

1. Where both references are finite and `abs(s - r) <= budget(r)/2`, require a finite GPU result within
   `budget(r)` of `r`. The half-budget threshold leaves room for CUDA/V8 differences. The constants are
   an empirical sampled comparison budget, using the probe and the Stage 1 budget as anchors.
2. Where f64 is an unsuitable oracle for the specified f32 evaluation, require a finite result within
   `budget(s)` of finite `s`, or the same nonfinite class as `s` (NaN regardless of payload, +∞ or −∞).
   This covers cancellation, overflow and undefined intrinsic arguments, including empty max.
3. Check the sign of returned zero when both the f32 and GPU values are zero.

An unconditional f32 comparison would be simpler but would drop the f64 reference even on well-conditioned
coordinates. Report the first mismatch with case, coordinate, reference values and the rule used. Count coordinates
under each rule in the benchmark report. A shape-only empty-result case has no element comparisons
and is identifiable in evidence.
Fixed large functions can have no eligible bounded cases. Report that limit without claiming agreement.
This check estimates agreement on a finite sample. Reduction structure and deliberate rounding witnesses
are also verified independently, since a numeric tolerance can hide a reordered sum.

### One remote batch per cache miss

Use `differential` with a baseline key containing the current revision, function and case policy. Its
reused cases carry both reference buffers. Use a subject key containing the source hash and the target and
tool policy for the pinned CUDA 13.0 GB10 session. The invariant version covers comparison policy.
`decide(inputs, cases, todo)` submits only the uncached indices in one executable invocation and returns
verdicts in the requested order. Use a process-local map of active verdict promises to coalesce
concurrent calls for the same revision/function/source/session. Remove active entries on settlement. Completed verdict reuse is delegated to the existing differential
cache. Start a new process on a target/toolchain change. No persisted
verdicts or cross-host reuse. Transport, compilation and incomplete batch failures reject the invocation
without filling the verdict cache. Retain the differential tally and its replayable case descriptions in the contract record. An invariant that independently starts SSH for every case would exercise the same
numeric relation with avoidable compilation and transport costs.

The translation unit's `main` reads `inputs/cases.bin` and writes `out/results.bin`. Use a little-endian
binary batch with a case count and ordered case records. Each case has an ID, per-parameter rank-known
u64 dimensions and f32 words. Each result contains the ID, rank-known dimensions, device event milliseconds
and f32 words. The signature determines the ranks and counts. Verify the framing, byte counts and expected
IDs when decoding. JS binds shapes by the Stage 1 plain-axis rule; the host harness derives the concrete
tensor sizes and offsets from the compiled dimensions. Run a single record for `runTixCuda`. Including
tensors as text would be simpler to inspect but would lose signed zero with common JSON encoders and
inflate the large benchmark transfers.

## Proposed tool changes

| Change to `tools/cuda-remote.mjs` | Reason and simplest alternative |
| --- | --- |
| Add an explicit standalone-source cache mode. Cache by source, arch, compile policy and nvcc identity in that mode. Keep full-bundle compilation for callers that supply includes. | The current full-directory key recompiles the same translation unit whenever sample data or benchmark sizes change. Separately passing data to the executable still needs staging and isolation. |
| Stage every invocation in its own remote directory. Compile missing executables into a temporary file under a per-key build lock, then rename into the cache. Run in the invocation directory, fetch from it and clean it up. Surface copy, compile, execution and fetch failures with the phase and diagnostic. | The existing shared `out/` and `prog` can race on identical input. A single global lock for the full lifecycle would fix races but would serialize unrelated transfers and compilation. |
| Give ordinary executable runs a shared GPU lock and retain exclusive `--timed` for benchmark executions. Keep compilation, transfers and cleanup outside that lock. | Today an ordinary run can overlap a timed run. Keeping the current policy would require a separate agreement to suspend correctness runs. The updated tool coordinates users of the same lock policy. |

The checker uses the ordinary run path. The timing harness is the only planned caller passing `--timed`.
Probe both cache hit and miss with different payloads for one source, simultaneous calls with isolated
outputs, and missing output/fetch failure handling after the tool change.

## Benchmark and validation after review

Use the original six corpus functions as the main comparison. Generate deterministic f32 inputs once per
function, with signed asymmetric values, a positive epsilon for layernorm and a recorded seed and scale.
Run GPU and local Stage 1 f32 on identical bits. Report the GB10 runtime identity, compiler policy, Node
version and commit, event milliseconds, local f32 interpreter milliseconds, their ratio, and the
comparison's maximum errors and coverage. Record the raw trials and case generation in this ticket.

| Function | Shape bindings |
| --- | --- |
| matmul | M = K = N = 512 |
| softmax | N = 4096, C = 1024 |
| layernorm | N = 4096, D = 1024 |
| attention | Q = K = 1024, D = V = 64 |
| mlp | N = 1024, D = 256, H = 1024, O = 256 |
| conv2d | N = 8, C = 16, H = W = 64, O = 32 with 3 × 3 weights |

Allocate/copy inputs and initialize the CUDA context before timing. Record CUDA events immediately before
the first launch and after the final launch on the same stream, synchronize the end event and collect its
elapsed time before copying the result. This includes inter-kernel gaps on the stream. Use zero ms when
there are no launches. For the benchmark, run one untimed warmup and five event intervals per case in one
short `--timed` invocation, with buffers and inputs reused. Report the median and range. Time `runTix`
with `performance.now()` around interpreter execution, including its allocations and input conversion.
Warm up Node with a small case and take three full-size trials on this machine in tmux (version 3.4
available in the worktree shell). A timed SSH round
trip or the tool's `runMs` would include transfers, context startup or lock wait and answer a different
question. Keep result checks outside the timers.

Build with `npm run build`. Keep GPU tests in `tests/tensor/cuda-gpu.test.mjs`, with separate local tests
for deterministic source, protocol framing and correctness of the checker with an injected batch runner.
GPU tests run the six small corpus cases and focused witnesses for affine indexing, returned inputs,
empty extents, signed zeros and nonfinites, nested and multi-axis reductions, and both optimized revisions.
Use an order-sensitive bit witness and a partial split block to check emitted folds independently of the
tolerance. Mutate a read or omit a contributing tail in a valid candidate, and verify that the actual
remote-backed postcondition rejects it. Test duplicate verdict reuse and interrupted batch retries.
Run focused tests by file, without the full suite.

Implementation, the six workload timings and their verification follow review. Omit an intermediate kernel
IR, persistent evidence storage and additional scheduling work because the source emitter and existing
transformation support cover this stage.
