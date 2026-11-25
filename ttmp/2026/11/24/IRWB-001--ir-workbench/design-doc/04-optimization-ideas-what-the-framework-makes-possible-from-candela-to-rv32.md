---
Title: 'Optimization ideas: what the framework makes possible, from Candela to RV32'
Ticket: IRWB-001
Status: active
Topics:
    - compiler
    - ir
    - workbench
    - typescript
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/specialize.ts
      Note: specialization under assumptions
    - Path: repo://src/typed/strategies.ts
      Note: strategies and metrics the ideas build on
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-24T21:02:31.513114559-05:00
WhatFor: ""
WhenToUse: ""
---

# Optimization ideas: what the framework makes possible

## 1. Where the compiler stands

The ported compiler produces the same code as Compiler Workbench. That is deliberate: every number in the prototype's book is reproduced, which is what shows the port is faithful. Against the repository's reference compiler (`typed-rv32.js`, default policy), our O2 images are smaller (5,160 bytes against 7,628 over the 44 projects) but usually slower:

| benchmark | ours, O2 | reference |
|---|---:|---:|
| Blend, 40 cells | 451 | 383 |
| Checksum, 40 cells | 366 | 292 |
| insertion sort, 10 reversed | 2,022 | 1,533 |
| Collatz, n = 27 | 1,590 | 1,486 |
| value numbering, n = 40 | 570 | 695 |

The book names two known gaps. `t7 = i` survives as a copy in every bounds-checked loop. And loops are laid out with the exit between the test and the body, so every iteration takes a `jal` back.

What changed is everything around the passes:
- every pass application is checked against r0, with recorded evidence;
- preservation claims are verified, which found false claims in the prototype;
- facts are cached per exact revision;
- provenance spans revisions and IRs;
- a pass can be checked under explicit assumptions;
- strategies are data that can fork, compare, choose, retry and repeat.

These are the capabilities the ideas below rely on.

**A first measurement of what strategies alone buy.** `chooseBest` was run on every project, choosing among four candidates by emulator instructions over seeded cases:
- O2;
- O2 run twice;
- `loops` followed by O2;
- O2 followed by `lvn`, `subst`, `dce`, `cfg` and `licm` again.

Each candidate was checked against r0 after every pass. 12 of 43 projects get faster than O2:

| project | winner | instructions |
|---|---|---|
| constants | O2 twice | −42.9 % |
| checksum | extra cleanup | −10.6 % |
| early-exit | extra cleanup | −10.3 % |
| wrong-shift | extra cleanup | −9.1 % |
| strength | extra cleanup | −7.0 % |
| ramp | extra cleanup | −6.7 % |

The corpus total drops by 2.2 %. One project (`my-analysis`) ended with an internal algorithm error under this strategy, which remains to be investigated. Its inputs include non-terminating cases. The pass ordering in O2 is a fixed choice, and a per-project search beats it without any new pass.

## 2. Ideas specific to Candela → RV32

The Candela gallery program has 332 functions and about 13,000 f32 operations; analysis/03 has the inventory. These ideas use facts that exist only above Typed.

1. **Per-scene kernels.** Bind `K.scene` from the Candela scene artifact. `specialize`, then `fold`, `cfg` and `dce`, removes the other seventeen scenes' code, under a contract restricted to that scene. The mechanism is built and tested on `match-enum`. Candela needs the f32 lifter that is in progress. Measure image size and instructions per sample against the general kernel and against the reference compiler.
2. **Guarded specialization instead of assumed specialization.** Clone the kernel per scene and dispatch once at entry with `if (scene == k) kernel_k() else general()`. The program keeps its full meaning, so the contract stays unrestricted. A `chooseBest` constraint on bytes decides how many clones are worth their code size.
3. **Row-layout facts for the 559 checked text addresses.** Candela knows each scene's packed row count and layout. As outer facts, these let `bce` prove row reads in bounds and fold row offsets into constant displacements. The check runs under the scene's assumptions.
4. **Range facts for floats, seeded from Candela.** Colours lie in [0, 1], normals have unit length, and a ray's parameter t is non-negative. An f32 interval analysis started from those facts can remove clamps. The program has 964 `min_num`/`max_num` operations, and many guard values already known to be in range.
5. **Fused multiply-add under a tolerance contract.** The program has 2,050 `f32.mul` and 994 `f32.add`. RV32F's `fmadd.s` rounds once, so fusing changes results in the last bit; a bit-exact contract must reject it. A differential invariant whose compare accepts an ulp bound, or a per-pixel error bound on a rendered tile, makes the trade explicit and recorded. The vendored interpreter executes `fmadd`/`fmsub`/`fnmadd` with single rounding, so the check is real.
6. **Fast-math as a candidate, not a switch.** Fork between the exact kernel and approximate variants (reciprocal-multiply for division, approximate square root followed by one refinement step). `chooseBest` minimizes instructions subject to an image-error constraint. A metric algorithm renders a small tile on the emulator and compares it with the exact render.
7. **Frame traffic as the objective.** The PicoCalc reports found that on the P4 the kernel's cost is dominated by stack-frame traffic, which goes to PSRAM. An emulator metric counting loads and stores, rather than instructions, lets strategies sweep allocation options (register budget, spill heuristic, hint order) and choose the variant with the least memory traffic.
8. **An incremental scene edit.** With Candela's scene as a framework artifact at the top of the chain, editing one scene invalidates only the artifacts that depend on it, through v6's exact-revision caching. Measure the host recompile after a one-scene edit. The device compiles the gallery in 85 s today.

## 3. Ideas the framework enables in general

9. **Search per function, not per program.** Extend the experiment above with `forEach` over functions and a small beam search over pass orderings, keeping each function's best checked chain.
10. **Exact checking where it is cheap.** Sampled differential checks give "checked-sampled" assurance. For straight-line value trees, bit-vector equivalence by exhaustive evaluation over small domains, or symbolic evaluation, gives "checked-exact". The framework records which one a pass application got. A strategy can then require exact assurance for risky rewrites and accept sampled assurance for routine ones.
11. **Discovered peephole rules.** Enumerate small value trees (size ≤ 4 over the IR's operators), find equivalent cheaper ones by exhaustive i32 checking on small widths followed by random full-width cases, and register the survivors as v6 `rewrite()` rules. Each rule's evidence (cases, method) travels with it, and every application names the rule in `because`.
12. **Closing the book's two gaps.** Add copy coalescing for `t = i` and loop rotation as passes, then measure against the reference compiler's 383 / 292 / 1,533 / 1,486.
13. **Fused multiply-add and other tiles (E7).** Express instruction selection as rewrite rules over a machine IR, so a strategy can choose among tilings. This is the remaining framework extension.
14. **Profile-guided choices.** Heat (instructions per source line) is already computed from covers. As an analysis, it lets a strategy spend expensive passes only on hot functions, or specialize on observed argument values behind a guard.
15. **A cross-target oracle.** The reused front end also emits Wasm. A differential invariant between the Wasm module and the RV32 image is an independent check of the backend.
16. **Compile-time budgets.** Add compile milliseconds to the metrics and constrain them, so a strategy can choose to skip ranges on a 3,000-line kernel function.

## 4. Projects to add

Each idea becomes a corpus project, with a source, `project.json`, a `strategies/` file and notes at tile width:

| project | demonstrates | first measurement |
|---|---|---|
| `scene-spec` | ideas 1–2 on a small dispatch kernel, before Candela itself | bytes and instructions, assumed against guarded |
| `fma-tolerance` | idea 5 on a dot product and a lerp | instructions against ulp error |
| `fast-rsqrt` | idea 6 on vector normalization | instructions against error bound |
| `order-search` | idea 9 on the corpus | projects beating O2, total instructions |
| `peephole-zoo` | idea 11 | rules found, applications in the corpus |
| `rotate-loops` | idea 12 | Blend, Checksum and sort against the reference |
| `frame-traffic` | idea 7 | loads and stores per call across allocation options |

## 5. Suggested order

1. `order-search` (idea 9), because it needs no new pass and the measurement above already shows the gain.
2. Candela per-scene kernels (ideas 1–2), as soon as the f32 lifter merges. This is the experiment the artifact chain was built for.
3. Rotation and coalescing (idea 12), because they close a measured gap against the reference compiler.
4. Tolerance contracts (ideas 5–6), because they make approximate floating-point optimization checkable at all.
