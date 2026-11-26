---
Title: Tix stage 1 design
Ticket: IRWB-020-V
Status: review
Topics:
    - compiler
    - ir
    - typescript
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Existing synchronous differential relation runner
    - Path: repo://src/framework/ir/adapters.ts
      Note: Native artifact validation and projection
    - Path: repo://src/framework/ir/transactions.ts
      Note: Rebuild requirement of the edit path
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Native candidate preparation and the proposed extraction
    - Path: repo://src/typed/project.ts
      Note: Managed pass pipeline and origin comparison
ExternalSources: []
Summary: Design for the Tix front end, tensor artifact, evaluators, sampled contract and checked native passes.
LastUpdated: 2026-11-26T14:46:28.140592166-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix stage 1 design

Tix uses a tensor-definition IR with scalar expression trees. The fixed synchronous API in `dist/tensor/index.js` returns a runnable program after each checked pipeline. The one proposed framework change extracts native pass preparation from `applyPass`, so Tix and Typed can share artifact validation, change tracking and write enforcement.

## Source and shape checking

The supported source is the fixed Tix grammar, including multiple functions, optional statement types, affine dimensions and subscripts, and lexical reduction binders. Calls to `runTix` supply each named parameter as a dense row-major tensor with nonnegative integer extents and finite values in either supported array type. Shapes and element counts must fit the host representation. Zero extents produce empty axes and empty reductions use their stated identities. Shape names resolve per function and each used shape name must appear as a bare input dimension somewhere. A name that can only be recovered by solving an affine input equation is reported during compilation at its use.

- Use a lexer with one-based line and column spans and a precedence parser. Reduction bodies parse at the lowest precedence, up to the enclosing delimiter. Both `max` forms share a prefix. A complete two-argument scalar call with shape names takes priority before a binary `-`, where both parses can otherwise apply. A parenthesized reduction body immediately after the binder list expresses the other reading. A call with expressions in its arguments uses the ordinary scalar call syntax.
- Check functions in source order independently. Introduce tensor definitions after checking their right-hand sides, so each read resolves to a parameter or an earlier statement. Check unique function names, tensor definitions and names within a binder list, and resolve the returned name and type. Give each index binder a distinct ID so inner reductions can shadow an outer name without capture.
- Normalize affine forms to a constant and ordered coefficient terms. Bind every bare index in a subscript to the referenced dimension and require all plain uses of the same scoped index to agree. Use the declared axis for a left-hand binder with no plain use. A reduction binder without a plain use has no declaration to supply its extent. Compare inferred and declared dimensions and the return signature as normalized symbolic expressions.
- Compile reference bounds into affine inequalities using the minimum and maximum over the active index box. Each coefficient selects a corner from zero and extent minus one. An empty enclosing loop imposes no load bound. This proves ordinary convolution windows by simplification, for example `(H - KH + 1 - 1) + (KH - 1) = H - 1`. Reject source-known contradictions at compilation. When an inequality depends on the actual shapes, keep it with its span. Specialize shapes from the bare parameter axes at the start of `runTix`, confirm the other parameter dimensions and evaluate retained shape constraints before reading elements. This shape-check phase handles inconsistencies that cannot be known from source alone.
- Report an ordinary `Error` with `line:col` and a concrete message at the offending token or retained constraint, for example `index y needs a declared extent`, `conflicting extents for j`, or `subscript may leave axis 2 of x`.

A parser that directly runs indexed expressions would be smaller for the interpreter alone. The checked tree resolves binder identities and materializes extents once, and supplies the same representation to both passes and both precisions. Exact integer affine normalization supports equivalent spellings and corner arithmetic without an integer solver.

## Artifact and execution

`TixProgram` holds the current `Artifact<TensorProgram>` and its original artifact. `compileTix` creates the same artifact for both using `defineIR`, `defineAdapter` and `createIRArtifact`. Keep the original across optimization calls. Use kind `tensor.tix` and schema version `1`. The native JSON contains ordered functions, parameters, definitions, return IDs, shape constraints and source spans. Definitions carry their output shape, ordered loop binders and scalar tree. Scalar nodes represent literal text, shape values, affine loads, unary and binary operations, calls, ordered reductions and an internal blocked sum. Use decimal strings for affine coefficients, with BigInt for exact shape arithmetic, and keep typed arrays and computed floating-point values outside the artifact. This preserves literal information through canonical JSON, which normalizes numeric signed zero and rejects nonfinite numbers.

Project one entity per function, parameter and tensor definition, using stable IDs. Include the checked scalar tree in the statement attributes, order in the containing function and dependency edges for tensor reads. Reuse one validator for the IR definition and adapter. Validate the tree tags, binder and tensor references, ranks and extent constraints on native candidates. Keep the original input shape constraints when inlining removes a definition. Its consumer substitutes only coordinates valid for the producer, so the composed loads fit under those same constraints. The adapter supports inspection and diffs by projecting native values. A node-per-expression graph with a reverse builder would add editing and reconstruction for trees that each pass already rewrites locally. The native tree keeps explicit iteration order, extents and subscript arithmetic for subsequent loop-level consumers.

One interpreter uses the selected precision for the same scalar operations and loop traversal.

- In f32 mode, round input cells, literals, numeric shape values and every arithmetic, call and accumulation result with `Math.fround`. Store tensors in `Float32Array`. Use a fixed quiet NaN encoding at tensor storage so bit comparisons have a defined representation for computed NaNs. Preserve signed zeros.
- In f64 mode, load the supplied cells into double storage and evaluate the original operations with JS double arithmetic. For an optimized artifact, interpret its recorded reduction schedule in f64 too. The reference for acceptance always runs the original artifact.
- Visit output cells in row-major order. Visit reduction indices lexicographically with the first binder outermost. Sum starts from positive zero and max starts from negative infinity. Use `Math.max` for the max combine, and the corresponding JS `Math` operations for the source calls.

Two interpreter implementations would duplicate binder, storage and schedule semantics. The precision choice belongs at numeric operations and storage boundaries.

## Passes and acceptance

The versioned passes run in input order. Inline declares tensor definition and containment and read edge writes, and maps the removed definition to the surviving consumer. Split declares tensor definition writes and retains definition IDs and read edges. A pass with no applicable rewrite is accepted as an identity. A rejected candidate leaves the current artifact selected for the next pass. Signature and function-set equality are prerequisites for either relation. For each changed function the gate observes the entire returned shape and row-major tensor on the same inputs. Use one `differential()` invariant per relation and call its existing synchronous runner with the corresponding spec. Preserve case descriptions and the first mismatched output coordinate with its expected and actual value or bits in internal evidence. The public API reports the requested pass name and its Boolean verdict.

**Sample domain.** Derive shapes from the original signature. Try the shared anchor values `0`, `1`, the block width `B`, `2B` and `2B + 1` to cover empty, singleton, one full block, two full blocks and an odd tail. Also try staggered versions by adding each anchor's zero-based position to distinguish axes, and use a fixed-shape signature directly. Deduplicate concrete parameter shapes and discard those that fail the original shape constraints. For each valid shape, include a positive coordinate-varying fill and a signed fill including both zero signs, keeping values bounded by one. Use simple deterministic dyadic values, with parameter and axis positions contributing to the fill. Include a cancellation or reassociation fill on reduction-sized parameter axes. In particular, a length-five axis gets the vector below in the first test, and a small integer ramp for the dropped-tail test. The regression fixtures must be checked through the gate. The shape recipes cover the stated cases and give reproducible rejections. There is no claim about untested shapes or values.

**Exact.** Compare candidate f32 with the immediate input revision in f32, by inspecting each stored word as an unsigned 32-bit integer. This preserves the current bits even after a tolerance-accepted split. Before any split, exact checks therefore preserve the original f32 result on the sample domain. Numeric equality would hide signed-zero differences.

**Tolerance.** Compare candidate f32 against the original f64 output on each sampled case with a finite, nonempty reference tensor. A nonfinite or shape-mismatched candidate fails a decided case. Original nonfinite and empty results supply no numerical evidence for this relation. Each changed function must have a decided case, and all decided cases must agree. Use the same case generation for exact and tolerance so an exact step following a split preserves the sampled tolerance verdict. Each later split checks the original again, which avoids budgeting error separately for each pass.

For each decided lane with f64 reference `r`, require

```text
|candidate - r| <= 5 * (gamma(3, 2^-24) + gamma(4, 2^-53)) * max(1, |r|)
gamma(k, u) = k*u / (1 - k*u)
```

The coefficient is about `8.94e-7`. For the short direct-sum fixture of up to five f32-representable terms of magnitude at most one, a term in the split has at most one rounded addition inside its pair and two between blocks. The reference sequential sum has at most four rounded additions after the first addition to zero. With normal intermediates, multiplying the per-addition rounding factors and taking the sum of magnitudes bounds the direct-sum error by the coefficient. The unit floor covers cancellation in that fixture. Relative scaling also handles outputs larger than one. For longer reductions and arbitrary downstream expressions, the formula is an output acceptance budget measured against the oracle, with no full-program error guarantee. An ill-conditioned program or larger sum can fail this budget. Per-operation error propagation would support more programs at substantially greater complexity. Comparing directly with the original f32 could punish a reassociation that improves accuracy.

| Pass | Rewrite and safety condition |
| --- | --- |
| `inline` | Count syntactic tensor loads and returns. Find a reduction-free statement with one load in a later consumer and no return use. Substitute the load's affine subscripts for the producer's binders, composing affine loads by binder ID, even if the consumer load is inside a reduction. Retain arithmetic order and producer-result rounding, and remove the unused definition. Check exact. |
| `split-sum` | Replace each eligible one-index `sum` with an internal blocked sum carrying the original binder, extent, scalar body and block width `B = 2`. Evaluate `ceil(extent / B)` partial sums in order from zero, each with original indices from `B*b` to `min(B*(b+1), extent)` exclusive, then sum the partials from zero in increasing block order. Skip already-blocked sums. Two is the smallest block width that can change association. Check tolerance. |

Inlining by textual substitution can capture a reduction binder and discards the checked load mapping. Substitution on binder IDs preserves both. A pair of ordinary reductions for split would need a way to encode the dependent tail bound and original-index map. The internal blocked node expresses both and can be traversed by the same interpreter. Cases where no source sum changes association are still legal native rewrites, with acceptance decided by the appropriate relation.

## Proposed framework change

| File | Change and reason |
| --- | --- |
| `src/framework/passes/define-pass.ts` | Extract and export a synchronous `prepareNativePassCandidate` used by the native-result arm of `applyPass` and by the Tix pipeline. Given the pass identity, adapter and declared writes, the opened base view and a native result, create and validate the candidate artifact, diff its projection, form correspondence, and check the declared writes. Return prepared candidate data for the calling acceptance path. Share the write check with the edit-result arm. The existing asynchronous entry point keeps its analysis, edit and managed-contract lifecycle. |

The fixed `optimizeTix` return type requires synchronous preparation and a synchronous verdict. Today even returning `NativeResult` from `applyPass` requires opening an edit transaction, so a projection-only adapter fails before the pass body. A Tix-local copy of native preparation would duplicate framework rules. A generic synchronous manager or a second checker would expand the framework beyond the actual gap. Tix uses a native pass descriptor with a synchronous kernel and the shared preparation function. It uses the existing differential invariant runner for acceptance and selects the resulting artifact only after the verdict. Managed analysis, effect and publication records remain features of the asynchronous path.

The Node 24.18.0 probes after `npm run build` confirmed that a read-only adapter can be opened and throws `is not Rewritable` on edit, that `applyPass` returns a promise, that `runDifferential(differentialSpec(invariant), ports)` gives a synchronous verdict that distinguishes signed zeros, and that BigInt affine coefficients round-trip as strings through `immutable`. The tested Node build also stored `Math.fround(NaN)` as the quiet NaN word `0x7fc00000`.

## Corpus and review checks

Each directory below carries `main.tix` and gets a small asymmetric fixture with a handwritten or independently computed expected output. Asymmetric shapes catch transpositions that square examples would leave invisible.

| Directory in `corpus/tensor/` | Tix operations exercised |
| --- | --- |
| `matmul` | Row/column contraction with a one-index sum. |
| `softmax` | Row maximum shift, exponentials and normalization. |
| `layernorm` | Mean, squared deviations, epsilon before square root, and per-channel gamma and beta. Pass epsilon as a length-one tensor and load cell zero. |
| `attention` | Single-head query/key dot product, scale by square root of the head dimension, max-shifted softmax, and value contraction. |
| `mlp` | Affine projection with bias, tanh-GELU and output projection. Express the cube with multiplications. |
| `conv2d` | NCHW, stride one, no padding, explicit output shape and affine window loads with a multi-index reduction. |

Test through the public build exports. Cover reduction precedence, both `max` forms, binder scope, affine checking and line/column diagnostics, empty axes, signed zero, lexicographic accumulation, and different f32 and f64 storage. Test accepted/rejected pipeline continuation, an exact step after a split, and retained origin across calls. For native pass preparation, test declared writes, malformed native output and correspondence with a projection-only adapter. Following implementation run `npm run build`, `node --test tests/tensor/`, `node --test tests/framework/` and the affected Typed suites `node --test tests/typed/{passes,audit,meaning-memo,parallel}.test.mjs`.

The same gate will check the real passes and test-only mutant kernels.

| Case | Expected acceptance |
| --- | --- |
| Inline a single-use producer accessed through a permuted affine load. | Exact accepts and f32 bits stay identical. |
| Inline mutant substitutes swapped indices for a square producer, using coordinate-distinct values. | Exact rejects while rank and bounds still validate. |
| Split a direct sum of `[1, 0, 2^-24, 2^-24, 2^-24]`. | Exact rejects and tolerance accepts the same native candidate. Node reports f32 words `0x3f800000` and `0x3f800002`. The f64 reference is `1.0000001788139343` and the candidate error is `2^-24`. |
| Split mutant drops the odd tail for `[1, 2, 3, 4, 5]`. | Tolerance rejects 10 versus 15. The even length prefix also checks the full-block loop. |

## Later

- Shape names inferable only by solving affine input equations require a binding solver. The stage 1 examples all have bare input anchors.
- GPU execution, CUDA lowering, fusion, tiling and attention-specific rewrites belong to later stages and have no design here.
