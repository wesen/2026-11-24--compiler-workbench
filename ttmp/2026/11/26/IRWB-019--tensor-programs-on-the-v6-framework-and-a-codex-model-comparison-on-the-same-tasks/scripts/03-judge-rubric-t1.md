# Rubric: stage-1 design documents (Tix front end, IR, evaluators, contract, passes)

Each document answers the same brief (`specs/brief.md`). Score each document on its own against the brief, with the same standard for all. Quote the passage for every count and every score below 5.

## Over-engineering counts (integers)
- **R1** error conditions, statuses or diagnostics specified beyond the brief's compile errors (line:col) and shape-binding errors at call time.
- **R2** guarantees about state or behaviour outside the valid domain (invalid inputs, NaN or infinite inputs, partial results).
- **R3** language features, modes or options beyond the fixed core and API (each one counted once).
- **R4** planned tests of the program's own guards or error paths beyond one test per compile-error class.
- **R5** measurement or benchmarking plans (stage 1 has no performance goal).
- **R6** design content for later stages (CUDA, fusion, tiling, attention rewrites) beyond one line each.
- **R7** yes/no: the design works around a framework gap it identifies instead of proposing the change.
- **R8** layers of abstraction or generic machinery introduced without a present use in stage 1 (each counted once).

## Fitness scores (0-5 each)
- **A1 Semantic fidelity:** the design implements the brief's f32 meaning exactly (rounding of literals, shape values, every operation and function result; reduction start values and lexicographic order; the reduction-body rule; extent inference and the declared-type rule). Deduct for each deviation or ambiguity left open.
- **A2 The contract:** domain, observation and relation are each defined; the exact relation is bit-identity on f32; the tolerance relation is stated precisely with its reference (f64) and justified (why this bound, what it accepts and rejects); `split-sum` is rejected by exact and accepted by tolerance, and a wrong variant of each pass is rejected.
- **A3 Framework analysis:** the design identifies concrete places where `src/framework` does or does not fit tensor programs, with file or API references, and proposes minimal changes with reasons. Deduct for vague claims, or for forking the framework instead of changing it.
- **A4 Test plan:** tests are placed where the risk is (semantics, extent inference, the contract's relations, the passes' correctness), not spread evenly.
- **A5 Implementability:** concrete enough to implement without guessing; internally consistent; the IR is suitable for later loop-level lowering without designing it.

## Overall
- `over_engineering` 0-10 (0 none, 10 the document is mostly excess).
- `fitness` 0-10 (how well it serves stage 1's purpose: a working front end and contract that test the framework).

## Output
A JSON array, one object per document: `{ "doc": "doc-A.md", "counts": {"R1": n, ..., "R7": "yes"|"no", "R8": n}, "scores": {"A1": n, ..., "A5": n}, "over_engineering": n, "fitness": n, "quotes": {"R1": ["..."], "A1": ["..."], ...}, "notes": "one or two sentences" }`.
