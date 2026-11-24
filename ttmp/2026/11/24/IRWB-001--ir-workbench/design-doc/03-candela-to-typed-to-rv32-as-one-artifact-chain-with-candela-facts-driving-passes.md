---
Title: Candela to Typed to RV32 as one artifact chain, with Candela facts driving passes
Ticket: IRWB-001
Status: draft
Topics:
    - compiler
    - ir
    - workbench
    - candela
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/code/wesen/2026-10-20--ds-js-os/compiler/typed/tape.js
      Note: Typed IR with per-opcode effect bits used to verify purity facts
    - Path: abs:///home/manuel/code/wesen/2026-10-20--ds-js-os/docs/candela-on-the-p4.md
      Note: How Candela scenes reach the P4 renderer today
    - Path: abs:///home/manuel/code/wesen/2026-10-20--ds-js-os/tools/gen/candela/typed/lower.mjs
      Note: Generator lowering that would emit correspondence and facts
    - Path: abs:///home/manuel/code/wesen/2026-10-20--ds-js-os/ttmp/2026/11/22/PICOCALC-CANDELA-TYPED--candela-s-kernel-and-scene-code-in-typed-with-the-c-kernel-as-the-benchmark/design-doc/01-candela-in-typed.md
      Note: WGSL to Typed generator; one-program dispatch; facts lost at the boundary
    - Path: abs:///home/manuel/code/wesen/2026-10-20--ds-js-os/ttmp/2026/11/23/PICOCALC-CANDELA-KERNEL-CODEGEN--candela-s-fixed-kernel-in-typed-at-c-speed-values-in-registers-measured-against-the-1-76x-baseline/design-doc/01-candela-s-kernel-at-c-speed.md
      Note: Measured gap (1.463x board) and the f32 range facts not built
ExternalSources: []
Summary: 'Yes, with conditions: put Candela at the top of the workbench''s artifact chain (scene → graph/WGSL/packed data → generated Typed → blocks → RV32), make the WGSL→Typed generator a lowering that records correspondence and exports facts, and let Typed passes need Candela facts mapped onto their entities. Exact per-scene constants make specialization sound by construction; derived facts (ranges, purity, u32) must be transferred with a verifier or guarded. Grounded in ds-js-os''s CANDELA-TYPED and CANDELA-KERNEL-CODEGEN results.'
LastUpdated: 2026-11-24T21:00:00-05:00
WhatFor: Decide whether and how Candela-level knowledge should drive optimization of the generated Typed code, and what that means for the workbench's flagship.
WhenToUse: Before choosing the workbench's first real workload; before adding a fact channel to the ds-js-os generator or compiler.
---

# Candela to Typed to RV32 as one artifact chain, with Candela facts driving passes

## 1. Short answer

**Yes.** This is the strongest use case found so far for the combined framework.

Today the pipeline from a Candela scene to RV32 crosses two compilers and a text boundary:

```
Candela scene program (JS) → Candela front end: build · compile · pack → WGSL (kernel fixedParts + per-scene sections) + packed rows
  → tools/gen/candela/typed (WGSL → Typed text) → Typed front end → tape → typed-rv32 passes → RV32
```

At the text boundary, everything Candela knew is gone. The Typed compiler sees a 10,000-line program (372 KB) and has to rediscover facts that were certain one stage earlier. The ds-js-os tickets record exactly which of those facts are missing. They also record that the remaining gap to C++ is 1.46× overall and 2.03× on kernel-bound scenes, measured on the board.

On the v6 framework, Candela becomes the *top* of the artifact chain. The generator becomes a lowering pass that records correspondence. Typed passes can then `need` Candela facts, addressed onto their own entities by composing that correspondence. Two conditions apply:

1. Exact per-scene facts make specialization sound by construction, provided the compiled artifact is keyed by the scene.
2. Derived facts (ranges, purity, `u32`) cross the boundary only as v6 *transferred* facts, with a verifier or a runtime guard. Otherwise they are just trusted declarations.

## 2. What is lost at the boundary today (from the ds-js-os record)

| Candela/WGSL knows | What the Typed compiler sees | Where this is recorded |
| --- | --- | --- |
| Which scene is being rendered, and whether it is spectral | `K.scene` and `K.spectral`: runtime fields of the kernel record. The five scene entry points dispatch through a binary tree on `K.scene` | CANDELA-TYPED design, "One program for the gallery": "Per-scene programs would save the dispatch and the spectral branches at the price of a compile per scene change" |
| The packed scene rows (≤3,664 bytes per scene) and material parameters, fixed when the scene is built | Loads from row buffers through `getF32`, with address arithmetic and range checks | KERNEL-CODEGEN refinements: frame traffic, f32 constants and `getF32` checks dominate B-01; the `rows` pass removes the checks |
| WGSL types: `u32`, vectors, structs | `i32` with `>>>`; scalarized `p__x, p__y, p__z`; record fields | CANDELA-TYPED refinements: the generator refuses unsigned comparison or division, and `f32(u32)` of a value that may exceed 2^31 |
| Value ranges: colours and roughness in [0, 1], unit normals and directions, t ≥ 0 (to be confirmed per field) | Nothing. *"Range facts and value sets for f32 functions, which skip them today"* | KERNEL-CODEGEN work item 3, "not built" |
| Sections and most kernel functions are pure, and row buffers are read-only during a pass | Generic calls and loads; value numbering has to recover the same field loads "in every inlined copy" | KERNEL-CODEGEN refinements, step 6 |

## 3. The chain on the framework

```
candela.scene ──build──▶ candela.graph ──compile──▶ candela.wgsl ──gen──▶ typed.project ──frontend──▶ typed.tape ──lift──▶ typed.blocks ⟲ ──▶ rv32.*
 (scene program)          (scene + material      (kernel fixedParts,  (generated .typed      (spans)              (r0 … rN)
                           graphs)                 per-scene sections)   files + layout.json)
                          candela.packed ─────────────────────────────────────┘ (rows: data the specialization may fold)
```

The new artifact kinds each get a v6 `defineIR` and adapter:

- **`candela.graph`:** scene objects, materials and fields as entities.
- **`candela.wgsl`:** functions, locals and module tables as entities.
- **`candela.packed`:** row buffers as entities with typed fields.

The stages reuse ds-js-os code unchanged: Candela's own front end, `tools/gen/candela/typed`, and the Typed front end. Each is wrapped as a v6 compiler task (design-doc/02 §3).

**The generator records correspondence.** This is the one real change. The lowering already has the structure, since it names leaves systematically (`p__x`, `h.P__x`, the `K` fields, the `F_<fn>` frames). It then reports:

```ts
ctx.derive(wgsl, { from: ['fn:tracePath/local:p'], to: ['typed:tracePath/p__x', 'typed:tracePath/p__y', 'typed:tracePath/p__z'], relation: 'scalarized' });  // v6
ctx.derive(wgsl, { from: ['module:rows'], to: ['typed:K.rows0', /* … */], relation: 'bound-as-buffer' });
ctx.derive(graph, { from: ['material:B-01/floor.roughness'], to: ['packed:row3.f7'], relation: 'packed-as' });
```

From there, existing pieces carry the chain down. Typed's spans map statements to ops, and CW-style lifting maps ops to statements and values. So a Candela entity can be followed to the exact `typed.blocks` values and the RV32 instructions that cover them, and back again.

## 4. Facts, and how each may cross the boundary

| Fact | Source | Kind | How it crosses soundly | Passes it enables |
| --- | --- | --- | --- | --- |
| `K.scene = id`, `K.spectral = b` | Scene build | **Exact**, per artifact | **Specialization**: compile a per-scene artifact whose key includes the scene digest (ds-js-os's compile cache is keyed by source digest and policy) | constprop and cfg delete the dispatch tree and the spectral branches; more inlining |
| Packed row contents | `pack` | **Exact**, per scene | Same, as specialization inputs: the rows become constants of that artifact | Constant-fold `getF32` loads; fold material parameters into the section code |
| `x ∈ [lo, hi]`, unit length, `t ≥ 0` | Candela graph and WGSL analysis | **Derived** | v6 `preserves … mode: 'transfer'` with a verifier: seed Typed's range analysis and require consistency, or insert a guard and keep a fallback | f32 range facts (not built today): drop NaN and clamp paths, accept `floor` via `i32` and `f32(u32)` without refusals |
| `u32`-ness | WGSL types | **Derived** (type) | Transfer as a non-negativity range fact, checked by the integer range analysis the RV32 backend already has | Unsigned compare and divide, `>>>` forms the generator currently refuses |
| Purity, read-only rows | WGSL and module structure | **Derived** (effects) | v6 effects: declare the rows read-only for the pass and verify with the tape's effect bits (`LOADS`/`STORES`/`CALLS`) | CSE and LICM of loads and calls across inlined copies |
| "These three locals are one vec3" | Correspondence (`scalarized`) | Structural | Correspondence itself, no assurance needed | Vector-aware scheduling or SIMD *if* a backend can use it (PIE for f32 is unverified) |

Two kinds of facts, kept apart:

- **Exact facts** are inputs to a specialized artifact. Their soundness comes from identity: the artifact is valid only for that scene digest.
- **Derived facts** are claims about values. In v6's vocabulary they must be *checked*, *transferred* with a verifier, or *guarded*. Otherwise they stay *declared* and cannot authorize a rewrite.

## 5. What it looks like in passes

```ts
export const candelaFacts = imported({                                          // NEW: facts mapped through correspondence
  id: 'candela.facts', version: '1', from: ['candela.graph', 'candela.wgsl', 'candela.packed'],
  onto: blocksAdapter, via: ['scalarized', 'bound-as-buffer', 'packed-as', 'lifted-from'],
});

export const specializeScene = definePass({                                     // design-doc/02 E3
  id: 'candela.specialize', version: '1', over: blocksAdapter,
  about: 'replace K.scene / K.spectral reads by this artifact’s exact scene constants',
  needs: { facts: candelaFacts }, writes: ['value'],
  contract: perSceneContract,                                                    // image agrees with the generic program
  run(fn, tx, { facts }) {
    for (const v of fn.values().op('load').where(v => facts.isSceneField(v)))
      tx.replace(v, tx.const(facts.exact(v), { because: [facts.ref(v)] }));      // because: fact:candela.scene@<scene digest>
  },
});
// cfg and constprop then remove the dispatch tree and spectral branches; licm and lvn see pure section calls
```

```ts
export const f32Ranges = dataflow({                                              // design-doc/02 E4
  id: 'typed.ranges.f32', version: '1', direction: 'forward', over: BlocksIR,
  lattice: lattice.map(lattice.interval()), widen: widenAtLoopHeads,
  seed: ({ facts }) => facts.ranges(),                                           // NEW: seeded by Candela, but…
  transfer: f32RangeTransfer,
  verifySeed: 'consistent',      // … a seed that the analysis' own result contradicts invalidates the fact (transfer fails)
});
```

The contracts are the ones ds-js-os already applies:

- image error E_rel ≤ 0.02 against the C++ arm
- Wasm vs RV32 bit identity on all 18 scenes
- the host digests through the renderer core

Each becomes a v6 invariant (design-doc/02 §6). They gate every specialized or fact-driven artifact, so a wrong Candela fact fails visibly.

## 6. Strategy: one program or per-scene programs

ds-js-os chose one program (all 18 scenes) because a compile costs 115 s and 13.6 MB on the device. That is now an explicit strategy decision with recorded evidence:

```ts
chooseBest('candela/arm', fork('candela/fork', [
  { name: 'one-program', strategy: compileGallery() },
  { name: 'per-scene',   strategy: forEach('scenes', specializeAndCompile(), { maxItems: 18 }) },
]), { metric: 'cyclesPerSample', direction: 'min' },
  { metrics: algorithm('candela.board-or-host-metrics'),
    constraints: [{ metric: 'imageErrorRel', op: '<=', value: 0.02 }, { metric: 'compileSecondsCold', op: '<=', value: BUDGET }] });
```

A cache hit (compile-cache, keyed by digest) removes most of the per-scene compile cost after the first visit to each scene. The strategy trace shows that trade-off for every scene.

## 7. Where the work lands

- **Workbench (this repo).** The whole chain becomes inspectable: select a material parameter in the Candela graph and follow it through WGSL, the Typed field, the blocks value and the RV32 instruction, then see which pass used it and why. This is the experiment platform for deciding which facts pay.
- **Production (ds-js-os).** Facts that pay are ported to the shipping pipeline. The generator emits a side table of facts and correspondence keyed by Typed function and local. `typed-rv32` passes, the 84-digest harness and board studies decide what is kept, as AGENTS.md requires ("a claim that it is faster needs a board study"). The workbench does not replace the device compiler. It runs the same stages on the host, with evidence.

## 8. Effect on the plan (design-doc/01)

- **Flagship.** Keep CW's Typed → RV32 compiler and its 44 projects as the unit corpus for the kernel. Make **Candela the first real workload**: it has a measured gap, named missing optimizations, independent oracles (the C++ arm and the Wasm build) and an existing measurement protocol.
- **New phase, after kernel parity.** Wrap Candela's front end, the generator and the Typed front end as tasks. Add generator correspondence. Then try three experiments in order:
  1. Per-scene specialization (exact facts only).
  2. Read-only rows and purity (effects).
  3. f32 ranges seeded by Candela (transferred facts with verification).

  Measure each on the host first, then with a board study.
- **Inventory first.** The facts in §4 are inferred from ds-js-os's design docs and diaries, not yet from Candela's source. The first task is to list what Candela's `build`, `compile` and `pack` actually know: material parameter ranges, constant fields, which sections each scene uses.

## 9. Risks

- **Sound fact transfer is the hard part.** A range claimed at the Candela level can be invalidated by a WGSL-level computation. Without a verifier, a wrong fact produces wrong pixels that only the image-error gate catches, and only on the scenes tested.
- **Compile budget on the device.** Per-scene artifacts multiply compile work. They are realistic only with the compile cache and a cold-compile budget.
- **Two compilers.** Insights move from the workbench's reimplementation of the passes to `typed-rv32.js` by porting. Keeping a byte-identity check between the two on shared programs helps, using CW's reference-compiler oracle the other way round.
