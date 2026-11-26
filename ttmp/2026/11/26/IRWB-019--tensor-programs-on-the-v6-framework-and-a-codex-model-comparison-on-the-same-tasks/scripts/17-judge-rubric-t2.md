# Rubric: stage-2 design documents (lowering Tix to CUDA, checked, on the GPU machine)

Each document answers the same brief (`specs/brief.md`). Score each document on its own against the brief, with the same standard for all. Quote the passage for every count and every score below 5.

## Over-engineering counts (integers; each kind of excess counted once per document)
- **R1** error conditions, statuses or diagnostics specified beyond what the fixed API and the brief require.
- **R2** guarantees about state or behaviour outside the valid domain: non-finite inputs (the brief says inputs are finite), partial results, recovery from remote failures beyond reporting them.
- **R3** features, modes or options beyond the fixed API and the stated stage: other thread mappings, launch-configuration search, multiple targets, configurable precision modes, each counted once.
- **R4** planned tests of the implementation's own guards or error paths, beyond one test per failure class the brief names.
- **R5** measurement beyond the brief's timing table: profiling plans, statistical benchmarking protocols, repeated-run designs.
- **R6** design content for later stages (fusion, tiling, shared memory, tensor cores, streaming attention, autotuning) beyond one line each.
- **R7** yes/no: the design works around a framework or tool gap it identifies instead of proposing the change.
- **R8** layers of abstraction or generic machinery without a present use in stage 2, each counted once (for example a general kernel scheduler, a plugin system for backends, a generic remote-job framework).

## Fitness scores (0–5 each)
- **A1 Fidelity to the brief:**
  - the lowering follows the fixed mapping (one kernel per statement, one thread per output element, each reduction a sequential loop in the f32 meaning's order);
  - the fixed API is implemented as specified;
  - programs from `optimizeTix` lower;
  - the three settled rules (separate tensor and index names, shadowing, zero extents) are handled.
- **A2 The lowering's contract:** the relation (exact or tolerance) is chosen with a concrete argument.
  - For exact: which operations are correctly rounded on the GPU, under which `nvcc` flags (contraction, precise division and square root, fast math), and how each intrinsic (`exp`, `log`, `sqrt`, `tanh`, `max`, `min`) matches the f32 meaning.
  - For tolerance: the reference and the bound, justified by an error argument or a measurement.
  - The design plans a probe on the GB10 that would establish or refute the relation. Deduct for an unjustified bound, or for claiming exactness without saying how each operation achieves it.
- **A3 The remote engine and the framework:** how the contract runs an expensive, remote, asynchronous engine (batching cases into few launches, reusing compiles and evidence by content), and which concrete changes `src/framework` or `tools/cuda-remote.mjs` need, with file or API references and reasons. Deduct for vague claims, or for forking the framework instead of changing it.
- **A4 Test plan:** tests are placed where the risk is (the emitted code's semantics against the f32 meaning, the relation's claim, lowering after the passes, the timing measurement), and the GPU tests are separated from the local ones.
- **A5 Implementability:** concrete enough to implement without guessing; internally consistent; the emitted CUDA is described concretely (kernel signature, index computation, launch configuration, data transfer, timing with CUDA events).

## Overall
- `over_engineering` 0–10 (0 none, 10 the document is mostly excess).
- `fitness` 0–10 (how well it serves stage 2's purpose: a checked, measured CUDA lowering that tests the framework).

## Output
A JSON array, one object per document: `{ "doc": "doc-A.md", "counts": {"R1": n, ..., "R7": "yes"|"no", "R8": n}, "scores": {"A1": n, ..., "A5": n}, "relation": "exact" | "tolerance" | "unclear", "over_engineering": n, "fitness": n, "quotes": {"R1": ["..."], "A1": ["..."], ...}, "notes": "one or two sentences" }`.
