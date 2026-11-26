---
Title: Tix semantics, tensor IR and checked rewrites
Ticket: IRWB-020-I
Status: review
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Synchronous sampled invariant with per-side execution
    - Path: repo://src/framework/ir/transactions.ts
      Note: Rebuild requirement at edit construction
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Native pass application and write checks
    - Path: repo://src/typed/project.ts
      Note: Fixed origin and per-step acceptance in the Typed pipeline
ExternalSources: []
Summary: Stage 1 design incorporating the accepted review.
LastUpdated: 2026-11-26T12:54:43.972852439-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix semantics, tensor IR and checked rewrites

**Review decision.** Keep tensor shapes, index binding, floating-point semantics and tolerance in `src/tensor/`. The framework can already store an indexed program and compare two executions at different precisions. The missing operation is applying a checked native pass synchronously. The current runner also opens a graph editor before entering a native pass, so it requires a graph-to-native rebuilder. Both changes belong in the passes layer.

## Framework change ledger

| Site | Proposed change and reason | Simpler alternative considered |
| --- | --- | --- |
| `src/framework/passes/define-pass.ts` (`applyPass`, beside `definePass`) | Add `applyNativePassSync(pass, before, verify)` for synchronous native `definePass` kernels with empty analysis needs/preservation and a mandatory synchronous meaning check. It returns a `PassResult` on acceptance. Factor the native candidate construction, structural diff, correspondence and declared-write checks out of the existing runner so both paths use them. | Calling `applyPass` directly returns a Promise, which breaks `optimizeTix`. Copying its structural checks into Tix gives two implementations of pass acceptance. |
| Same file, creation of `ctx.edit` | Acquire the graph editor on access. A native result can use a traversable, validated adapter. A pass that edits a graph still uses the real `IREdit` and its existing prepare/rollback lifecycle. Preserve the current supplied-store base/head check. | Implementing a tensor rebuilder just to discard an empty draft would add an inverse mapping that neither rewrite uses. |

The sync path takes the same pass declaration and native kernel as the async path. Its supported subset uses neither managed transformation clauses nor effects. The required `verify(before, candidate)` returns the framework's `CheckResult`. A negative verdict rejects the pass and carries its evidence. The tensor driver supplies a verifier built from v6 differential invariants. Each binds two `tensor.indexed@1` artifact ports. The baseline runs at the relation's reference precision and the subject always runs at f32. Use the existing synchronous callback check for its result and the kernel result. The sync path uses private views for the two revisions and the caller takes the accepted artifact. This needs neither a shared `IRStore` head nor a synchronous `AnalysisManager`. The existing passes barrel re-exports `define-pass.ts`.

**Evidence from this worktree.** On Node 24.18.0, a v6 expression artifact created with an adapter omitting only `rebuild` passed `validateArtifact`. An identity native pass returned a Promise and rejected with `ir.capability` before entering its body. On the same artifact, `runDifferential(differentialSpec(invariant), ports)` synchronously reported `sampled / agree / 1`. Its `run(side, …)` already distinguishes baseline from subject and `compare` already accepts a domain-specific relation. Typed's `runPipeline` keeps an origin artifact and advances its current artifact after acceptance. Tix will reuse that rule. An ordered list of two possible kernels needs only a loop, so the asynchronous strategy interpreter and the CFG/dataflow machinery add nothing here.

## Source and call domain

The surface is the supplied Tix grammar. Programs contain named functions with one or more rank-one-or-higher f32 parameters, zero or more tensor definitions and one named tensor return. Functions can return an input. At a call, every parameter has its declared rank, consistent concrete extents and row-major data of length equal to the product of its extents. Shape bindings and extents are nonnegative integers, including zero. Extents, offsets and allocations must be representable on the host, accesses in bounds and input elements finite. Only the contract's *sample* sizes are small.

- **Parsing.** Lex names, decimal numbers (including fractional and exponent forms), punctuation and `//` comments with one-based line and column. Parse prefix minus above left-associative product/division above addition/subtraction. A reduction parses its body at the lowest precedence and stops before the enclosing semicolon, closing parenthesis or argument-separating comma. Thus `sum(d) x[i,d] / D` contains the division. By contrast, `(sum(d) x[i,d]) / D` does the division once. A normal high-precedence prefix parse for reductions would give the wrong tree.
- **The two meanings of max.** A reduction header must consist of index declarations followed by a body. A binary call takes two scalar expressions. For the overlap `max(a,b) - …`, select the reading whose operands and bound indices type-check. If both readings succeed, prefer the binary call with shape values as arguments. References with brackets in the argument list unambiguously denote a call. Test both readings, one-index and multi-index reductions and nested binders.
- **Shapes.** Normalize affine forms to a constant and sorted integer coefficients. Addition, subtraction and multiplication by an integer constant preserve affinity. Keep the syntactic plain-name flag until extent inference is done. Each shape name needs a bare parameter-axis anchor. Bind it directly to that input extent. Other dimensions may use affine combinations of anchored names. Bare names in scalar expressions must resolve to shape values.
- **Checking definitions.** Build the tensor environment in source order. Check unique function, parameter and definition names in their respective scopes, prior definition at each read, subscript rank, distinct LHS axes and reduction binders within each list, lexical scope, and the returned tensor's declared shape. Give each binder a fresh ID. Each plain RHS subscript on a known tensor supplies its axis's symbolic extent to that binder. All supplies and any declared result axis must agree as affine forms. For an LHS axis with no plain use, its corresponding annotation supplies the extent. A reduction has no result axis of its own. An affine-only reduction index with no independent plain use is an uninferable extent and a compile error.
- **Affine bounds.** For each tensor access compute its minimum and maximum over the nonempty enclosing index ranges by coefficient sign. Substituting the bounds often cancels all symbols. For example, an output axis `H-2` and a three-tap kernel give `(H-3)+2 = H-1`. Reject statically inconsistent shapes, impossible subscripts and uninferable ranges at their source spans. Instantiate the proposed case sizes and discard illegal concrete shapes directly. Shape disagreements between two plain uses are source errors even if a caller could choose numerically equal sizes. Lexer, parser and checker errors from `compileTix` include `line:col`.

## Artifact and execution

Use `tensor.indexed@1`, a single `defineIR` for an ordered collection of checked functions. Each function has a shape signature, tensor parameters, ordered definitions and a returned tensor ID. A definition has an ID, result shape, ordered free axes with extents and one scalar expression. Expression variants are literal spelling, shape value, indexed read, unary/binary operator, scalar call and ordered fold. Reads contain affine subscripts over **binder IDs**. A fold carries its operator, ordered index ranges and body. Source ranges belong to parser/checker nodes. The executable artifact needs only resolved operands. For example, the body of a matmul definition is:

```text
C[i:M, j:N] =
  fold sum(k:0..K) { mul(read(A, [i,k]), read(B, [k,j])) }
```

Ranges are half-open. Surface-language loops start at zero. For the internal split, bounds also admit a constant-size block count and a clamped upper endpoint depending on an outer binder. Keeping a typed index expression tree makes substitution, loop order and accumulation boundaries explicit. Keeping only source text would require reparsing candidates. A CFG would first have to recover the tensor accesses and reductions that these passes operate on.

Use the same native validator for `defineIR` and `defineAdapter`. It checks signature, tensor dependency order, ranks, shapes and scoped, typed expressions/ranges on each candidate. `createIRArtifact` hashes and freezes that data. Project functions, parameters and definitions as entities with stable IDs, definition axes/body as attributes, ordered membership as containment, reads as dependencies and returns as bindings. A changed fold is visible to `diff` as a definition update. Keep scalar expressions inside the definition until an operation needs independent graph edits. Inline declares writes to definition entities, membership and read edges. Split-sum writes definition bodies. Preserve the IDs of surviving definitions and record the removed producer's correspondence to its consumer.

Implement `compileTix`, `runTix` and `optimizeTix` as the specified synchronous exports from `src/tensor/index.ts` (built to `dist/tensor/index.js`). The opaque program holds the compiled origin and current artifact. This retains the same reference even across repeated optimize calls. `runTix` evaluates the current artifact. Typed buffers live only at execution time. The artifact format accepts finite plain data, normalizes numeric negative zero, and rejects typed arrays. Literal text plus explicit negation preserves source arithmetic without extending the format.

One loop interpreter with two precision modes enumerates each definition's result in row-major order, loads earlier tensors by strides and writes a fresh result buffer. Each fold visits its axes in increasing lexicographic order, first listed outermost. Start sum at +0 and max at −∞, including empty folds. Use JS arithmetic, `Math.exp/log/sqrt/tanh/max/min`, and `Math.max` for max accumulation. In f32 mode convert inputs on entry and round **each** literal, shape value, unary/binary operation, call and accumulation with `Math.fround`. A multiply followed by an add rounds twice. In f64 mode use the supplied input numbers and JS doubles throughout, including intermediate buffers. Return a `Float32Array` by default and a `Float64Array` for f64. Observe the f32 words the interpreter actually stores, including signed zero and any NaN produced from finite inputs. Hand-computed examples test the shared indexing independently of the two modes.

## Sampled meaning contract

The observation for a case is the named function's **entire returned shape and row-major output**. Every function is callable. Generate cases from the origin signature alone and run both sides on the same f32 inputs. Temporary tensors are private. Version the sampler and both `differential` definitions together with the constants below. Counterexamples identify the function, shape assignment, fill/seed, first differing element and both words or numerical values. Keep check evidence plain and finite (hex or text for exceptional values).

| Part | Stage 1 decision |
| --- | --- |
| Shapes | Per function, assign every symbol 1, then 8, then 9, then cycle 3, 5, 9 across successive symbols in signature order. Instantiate fixed/affine dimensions, retaining legal cases with nonempty outputs. This covers singleton, complete and partial blocks and asymmetric dimensions. Constant-only signatures use their actual sizes. Require a case for every function before acceptance. |
| Values | Per retained shape use all ones, the repeated flat motif `[1,0,0,0,2^-24,2^-24,0,0]`, and signed f32 values from `seededRandom(20)` mapped to `[-1,1)` in parameter/element order. For parameters declared exactly `f32[1]`, use positive scalar values (1, 2⁻¹⁰ and 2⁻⁵ respectively) so the cases vary an explicit layernorm epsilon while keeping its scale valid. The evaluator itself accepts general finite inputs. |
| Exact | Require equal shapes and identical 32-bit words for every f32 output element, including signed zero. JS numeric equality would miss its sign. |
| Tolerance | For each candidate f32 value `c` and original f64 value `r`, require both finite and `abs(c-r) <= 1e-5 + 1e-5*abs(r)`. Require equal shapes. Every case must agree. The absolute term covers cancellation near zero, the relative term scales with a large result. Unit roundoff is about `6e-8`. The allowance accommodates several rounded operations and short grouped sums at order-one scale. It is a sampled acceptance threshold, not an error bound for arbitrary programs or sizes. |

A changed `inline` must agree **exactly with its immediate input**. The same origin-derived cases make a second exact check redundant. A changed `split-sum` must meet the tolerance against **origin evaluated in f64**. Run named passes in order. An identity step succeeds without evaluating the contract. Each step reports `{pass, accepted}`. On meaning rejection the next step uses the last accepted artifact. Wrong-pass tests use the same gate with an internal kernel or relation override. Only `inline` and `split-sum` are public names.

## Rewrites and decisive tests

**Inline.** Within a function, count read occurrences and the return use. For a reduction-free producer with exactly one read and no return use, substitute the consumer's affine subscript tuple simultaneously for the producer's free binder IDs throughout its expression. For instance, reading `t[j,i]` swaps the producer axes even under a consumer's reduction over a source name also spelled `i`. Remove the producer after substitution. Keep the expression's operation tree and each rounding boundary. Walk definitions in source order and refresh uses after a substitution. A deliberately wrong kernel drops the minus from `t[i] = -x[i]; y[i] = t[i] + 1;`. With input one it returns two instead of zero. The candidate is well-shaped and must fail the exact gate.

**Split-sum.** Rewrite each original single-axis sum site once per application, including any nested sites, using fixed block size four. Tag generated folds in the IR so a later split pass skips them. For extent `K` the candidate contains the following two folds, each with its own rounded accumulator:

```text
fold sum(b:0..ceil(K/4)) {
  fold sum(k:4*b..min(4*b+4,K)) { original body(k) }
}
```

The inner binder still denotes the global index. The clamped bound includes the final partial block without padding or an out-of-bounds read. Multi-axis reductions and max keep their specified order. An opaque evaluator flag would hide the new iteration structure from the IR.

For `y[i] = sum(k) x[i,k]`, give one row the eight-element motif above. The measured serial f32 result is `0x3f800000` (1). The blocked result is `0x3f800001` (1 + 2⁻²³), exactly the f64 reference. The *same changed candidate* must fail exact and pass tolerance. A wrong split using only full blocks returns 8 on nine ones. The reference is 9 and the permitted error is 0.0001. Test that it fails tolerance. Assert the structural rewrite and the returned program's execution alongside the verdict so an identity kernel cannot pass as an optimization.

## Corpus and verification after review

Each row is a `corpus/tensor/<name>/main.tix` fixture. Execute both precisions against a small independent oracle, then check the optimized outputs under the selected relation.

| Name | Observable check |
| --- | --- |
| `matmul` | Rectangular `A[M,K] B[K,N]`. Compare each dot product and output axis order. |
| `softmax` | Subtract row max before exponentiation. Large equal logits give a finite uniform row. |
| `layernorm` | Per-row mean and centered variance, explicit `gamma[D]`, `beta[D]`, `eps[1]`. Constant rows give beta, nonconstant rows exercise gamma and epsilon. |
| `attention` | Single-head scaled QKᵀ, max-shifted softmax, weighted V. Equal keys give the mean of the values. |
| `mlp` | Two affine layers around tanh-GELU, using `0.5*x*(1+tanh(sqrt(2/π)*(x+0.044715*x³)))` expanded into Tix operations with a decimal coefficient. Select nonzero weights and biases. |
| `conv2d` | NCHW input, OIHW 3×3 weights, stride one, no padding. Declare output `[N,O,H-2,W-2]`. A nonsymmetric kernel and distinct pixels expose a flipped tap, exchanged axis or wrong stride. |

Use Node tests in `tests/tensor/` importing the built API. Cover token positions after comments, reduction precedence, two meanings of max, normalized shape equality, inferred/annotated extents, affine-only reduction errors, single assignment, and affine shape binding. Use hand-derived results for row-major reads, empty folds, multi-axis order, signed zero and per-operation rounding (`4097*4097 - 16785408` gives 0 in f32 and 1 in f64). Exercise both orders of passes, repeated optimize calls, rejection followed by another pass, the two mutants, and a second callable function so one agreeing function cannot authorize a bad program.

The framework test should exercise a tiny native pass with an adapter without `rebuild`, compare sync/async structural results on the same revision, and cover verifier rejection and an undeclared write. The existing framework edit-style tests cover the other editor path. Run `npm run build`, `node --test tests/tensor/*.test.mjs`, `node --test tests/framework/*.test.mjs`, and Typed's `passes`, `inline`, `strategies` and `audit` tests for the shared runner. Use escalation if the sandbox denies a test's child Node process. During implementation, update the ledger with each actual framework file, reason and exercising test.

## Later

- CUDA lowering and GPU execution belong to a later stage.
- Fusion, contraction tiling and attention-specific rewrites belong to later optimization stages.
