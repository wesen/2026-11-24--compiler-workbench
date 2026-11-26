---
Title: 'Intern guide: specializing Candela on its scene data, partial evaluation over constant memory'
Ticket: IRWB-007
Status: active
Topics:
    - compiler
    - ir
    - candela
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T10:12:52.050567464-05:00
WhatFor: ""
WhenToUse: ""
---

# Intern guide: specializing Candela on its scene data

This guide is for the person who will make the compiler specialize Candela, the gallery's path tracer, on the data that describes a scene. It explains every part of the system that work touches, the theory it rests on, a measurement made for this guide that says how much there is to gain, a design, and a phased plan in which every phase ends with a number.

Three conventions hold throughout.

- **Paths are relative to the repository root.** A number after a colon is a line number at commit `a4beda6`, the commit this guide was written against. The ticket directory, `ttmp/2026/11/26/IRWB-007--specializing-candela-on-its-scene-data-partial-evaluation-over-constant-memory/`, is abbreviated `IRWB-007/`.
- **Current and proposed are kept apart.** Everything in Part 1 exists in the code. An interface that does not exist yet is marked **Proposed**; its name is a suggestion.
- **Every number has a source.** The sources are the measurements in `IRWB-007/various/` (made by the scripts in `IRWB-007/scripts/`), the IRWB-001 implementation diary (`ttmp/2026/11/24/IRWB-001--ir-workbench/log/02-implementation-diary.md`, cited as "IRWB-001 step N"), and the IRWB-003 diary, which is not merged yet and is cited at its commit `90fed9c`.

# Summary

Candela's fixed kernel does not know which scene it renders. Before the first pixel, the host fills five buffers of rows of four floats: **U** (uniforms: camera, integrator settings, counts), **O** (one block of six rows per object), **LI** (six rows per light), **BV** (two rows per BVH node) and **SD** (extra data for media and motion). The kernel then reads them, for every ray, to find out what the scene contains. `oRow(q_k, i, k)` fetches row `k` of object `i`; `hitObj` branches on the type code in an object's first row; `traceAll` walks the BVH by reading node rows. Seen from the kernel, the buffers are a program and the kernel is its interpreter.

Specializing an interpreter on a fixed program yields a compiled version of that program. This is the **first Futamura projection** (Futamura, 1971), and it is what this ticket proposes: specialize Candela on a scene's buffers, and the result is that scene, compiled.

What exists today is a narrow case of it. The per-scene kernels of IRWB-001 specialize on one integer, `K.scene`, which selects one of 18 hand-generated scene sections. That cut the image by 58% but instructions per pixel by only 5–6% (IRWB-001 step 25), because the dispatch it removed was cheap. Everything the kernel reads from the buffers is still read, per ray, at run time.

The measurement made for this guide (§9) runs the real host protocol on the real scene rows and classifies every operation a pixel executes as static (computable from constants, `K.scene` and the frame-constant buffers) or dynamic. On B-01, the single-sphere scene:

| quantity (B-01, per pixel, evaluator operations at r0) | value | source |
|---|---:|---|
| operations a pixel executes | 3,910 | `various/03-binding-time-profile-all.json` |
| of these, depending only on the frame-constant buffers (M) | 2,002 (51%) | same |
| executed inside `oRow`, the object-table reader, all static | 1,375 (35%) | same |
| residual after ideal **polyvariant** specialization (live dynamic work) | 1,285 | same |
| bound on the gain, polyvariant | **2.7–3.0×** | same |
| bound on the gain, polyvariant but merging at every function return | 2.2–2.5× | same |
| bound on the gain, **monovariant** (offline, one version per function) | **1.1–1.2×** | same |

Over all 18 gallery scenes (`various/04-profile-summary.txt`), the polyvariant bound is at least 2× on 11 scenes (2.1× to 4.5× at its low end) and between 1.0× and 1.7× on the other 7. The 7 are the ray-marched and volume scenes (X-04, V-03, V-04, R-08, X-03, R-04, G-03), whose per-pixel cost is dynamic arithmetic: distance fields, noise and density evaluated along the ray. The monovariant bound is at most 1.7× on every scene.

The hypothesis the user proposed, per-pixel gains of multiples rather than percents, is therefore possible on this program, but only in part of the gallery and only for a specializer that makes several versions of a function or a loop when the static data differs (a **polyvariant** specializer). It holds for the scenes whose cost is the interpretation of the object table and the BVH. It is false for the scenes whose cost is arithmetic on the ray, whatever the specializer. A specializer that gives every function one binding-time classification gets percents everywhere, because the object index, the BVH node index and the light index reach the readers as dynamic values. The design follows from that:

1. **A constant-memory fact** (Proposed `typed.memory`): per scene, the words of each buffer the kernel reads, identified by the path from the kernel record (`K.bO` means the buffer whose address is in field `bO` of `K`), with each word traced back to the scene object it describes.
2. **A host promise** that, while `cdlRenderSpan` runs, those buffers hold those words. It is checked statically (no store reachable from `cdlRenderSpan` writes them; at r0 none does, §13) and dynamically (the restricted meaning contract on real-row cases, and the frame comparison, which already exists).
3. **A specializer built in four phases:** constant-address loads (U); calls and loops with static arguments (objects, leaves); the BVH walk as polyvariant program points; and splitting on values a dynamic test selects (which object a ray hit). Each phase is measured against the bound above and against IRWB-003's B-01 result of 8,267.7 instructions per pixel.
4. **A code-growth budget**, because every version costs bytes and the device is small.

# Part 1: The system

## 1. Candela, the program

The project compiles **Typed**, a statically typed subset of JavaScript, to RV32 machine code for the PicoCalc. Candela is the largest program it compiles: the gallery's path tracer, generated as Typed from Candela's own sources (`corpus/candela-gallery/`, five source files concatenated in `app.json`'s order). Lifted, it has 332 functions, 12,358 statements and 37,220 values at r0 (IRWB-002 guide, §16). For the compiler's vocabulary (artifacts, revisions, passes, the meaning contract, `why`), read Part 1 of the IRWB-002 guide (`ttmp/2026/11/24/IRWB-002--*/design-doc/01-*.md`); this guide assumes it.

The program has three layers, and the difference between them is the subject of this ticket.

- **The fixed kernel** (`kernel.typed`, 155 functions with `math.typed`): ray generation, intersection, the BVH walk, BSDF sampling, light sampling, the path loop. It is the same for every scene. It learns what the scene contains by reading buffers.
- **The scene sections** (`scenes.typed`, 177 functions named `s<k>_…`): for each of the 18 scenes, its materials (`s0_mat_0`, `s0_mat_1`, …), its user distance fields, height fields, densities and custom integrator, as Typed code with the scene's constants written in. Candela's generator produced them from each scene's material graph, so they are **staged by hand**: the generator did, for materials, exactly the specialization this ticket wants the compiler to do for the rest.
- **Five dispatchers** (`evalMaterial` at `kernel.typed:2782`, `sdUser` :2855, `heightAt` :2928, `densityOf` :3001, `customKernel` :3074) read `q_k.scene` and binary-search to the scene's section.

Scene 0's material 0, as generated (`scenes.typed:30–64`, abridged):

```js
function s0_mat_0(h__N__x: f32, …, uIn: f32): Lobe {
    const m1: f32 = (0.5 * 0.08);
    const f0_1: f32 = fresnelDielectric(…, ((1.0 + Math.sqrt(…m1…)) / (1.0 - Math.sqrt(…m1…))));
    if ((u < f0_1)) { …; L.kind = 3; …; L.ax = Math.max((0.4 * 0.4), 0.0005); … }
    else            { …; L.kind = 1; L.c0__x = 0.57758045; L.c0__y = 0.09084171; L.c0__z = 0.046665087; … }
    …
}
```

The albedo is a literal. Nothing about the material is read from a buffer, so the ordinary passes fold it. What the generator did not stage, the kernel reads at run time: which material an object has, where the object is, what shape it is, where the lights are, what the BVH looks like, what the camera does. Those are the targets.

The program has four **entries**, the functions the host calls (`corpus/candela-gallery/glue.typed`):

| entry | line | what it does |
|---|---:|---|
| `cdlLayout(out)` | 5 | describes the arena the host must lay out (pointer fields and buffer sizes) |
| `cdlInit(q_k)` | 22 | writes the 256-entry GGX albedo table `K.etab` |
| `cdlSky(q_k)` | 283 | builds the 64 × 64 × 3 sky table `K.sky` from U's sun and sky rows (`skyBuild`) |
| `cdlRenderSpan(q_k, out, y, x0, x1, frame)` | 287 | renders pixels `x0 … x1−1` of row `y`, 12 floats each, into `out` |

## 2. The host protocol and the memory it lays out

The host is the code that calls the entries over a memory image. In this repository it is `CandelaHost` in `src/typed/candela-render.ts:74–144`, a port of ds-js-os's `tools/gen/candela/typed/host.mjs` (read, never run). Its sequence, which the frame comparison and every per-scene experiment use, is:

```text
CandelaHost(engine)                         candela-render.ts:82
  layout()                                  :98
    buffer(256, 1024); cdlLayout(256)       the entry describes the arena in 12 cells
    write K's pointer fields and the two table headers at ARENA = 4096
    out buffer after the arena (12 floats × 160 pixels); scene rows after it
    cdlInit(ARENA) must return 1            fills the GGX table
bind(scene)                                 :117
    copy U, O, LI, BV, SD into five buffers; K words 0–4 point to them
    K.scene = index (word 7); K.spectral (word 8); K.skyOn = 0 (word 9)
    cdlSky(ARENA); K.skyOn = 1              fills the sky table
span(y, x0, x1, frame)                      :137
    cdlRenderSpan(ARENA, out, y, x0, x1, frame); read 12 floats per pixel from out
```

A **buffer** in Typed is a capacity word followed by data: the capacity, in UTF-16 units, at byte 0, and the data from byte 4. A row of four f32 is 16 bytes, so a buffer of `r` rows has capacity `8r` (`candela-render.ts:123`). The kernel record `K` (`types.typed:148–166`) is 17 words:

| word | field | written by | per frame |
|---:|---|---|---|
| 0–4 | `bU`, `bO`, `bL`, `bB`, `bS` | host, `bind` | constant pointers to the five scene buffers |
| 5 | `etab` | host, `layout` | constant pointer to the GGX table (arena word 17) |
| 6 | `sky` | host, `layout` | constant pointer to the sky table (arena word 274) |
| 7 | `scene` | host, `bind` | constant, the scene index (what IRWB-001 binds) |
| 8 | `spectral` | host, `bind` | constant |
| 9 | `skyOn` | host, `bind` | constant 1 while rendering |
| 10 | `rngS` | `renderPixel`, `rnd` | the RNG state, rewritten per pixel |
| 11–16 | `gTime`, `gLam`, `gTau`, `gTri`, `gBary__x`, `gBary__y` | `renderPixel`, `hitMesh` | scratch, rewritten per pixel |

The arena is `cdlLayout`'s 12,563 words (`glue.typed:7`: cells 0 and 1 hold 12,563 and 0). The memory map during rendering, with B-01's sizes:

```text
 byte address      contents                                          during cdlRenderSpan
 ------------      --------                                          --------------------
     256           layout buffer (cdlLayout's output)                unused
    4096  ARENA    K: 17 words                                       words 0–9 constant, 10–16 scratch
    4164           etab buffer: header + 256 f32 (cdlInit)           constant
    5192           sky buffer: header + 12,288 f32 (cdlSky)          constant
   54348           out buffer: header + 12 × 160 f32                 written: the pixels
   62032  rows     U  buffer: header + 41 rows                       constant
                   O  buffer: header + 12 rows (2 objects × 6)       constant
                   LI buffer: header +  6 rows (placeholder: 0 lights) constant
                   BV buffer: header +  2 rows (1 node)              constant
                   SD buffer: header +  1 row                        constant
 1 MiB             end of guest memory (MEMORY_BYTES, :70)
```

The addresses follow from `layout()`: `ARENA + 4·17` is the etab header, `ARENA + 4·274` the sky header, `ARENA + 4·12,563` the out buffer, and the rows start 4 + 48·160 bytes after it (`candela-render.ts:107–113`).

The point of this map for the design: during every `cdlRenderSpan` call of a frame, everything above marked "constant" holds the same bytes. 248 words of B-01's scene data, plus 256 words of GGX table and 12,288 words of sky table, all fixed before the first pixel. The host knows them; the kernel reads them as if they could change.

## 3. What the scene buffers hold

Measurement 1 (`scripts/01-scene-table-inventory.mjs`) reads the vendored scene table `corpus/candela-gallery/candela_gallery_scenes.c` as data (digest-checked against `VENDOR.json`, parsed by `parseSceneTable`, `candela-render.ts:34`; nothing of Candela runs) and decodes each buffer with the meaning the kernel gives its words. The meaning comes from the kernel functions that consume them:

| buffer, rows | meaning | consumer |
|---|---|---|
| U row 0 | resolution x, y; samples per pixel in `.w` | `renderPixel` (`kernel.typed:2599`) |
| U row 5 | `maxDepth` in `.y`, Russian-roulette start `.z`, flags `.w` (NEE, MIS) | `tracePath` (:2117) |
| U words 76–79 | `nObj`, `nLights`, first object outside the BVH, `nNodes` | `traceAll` (:962), `nLightChoices` (:1882) |
| U words 31, 32 | sun on (> 0.5); environment mode | `nLightChoices`, `neeAt` (:2001) |
| U word 87 | integrator mode (0 path tracing, 9 custom, 20 ids) | `renderPixel` |
| O, 6 rows per object | row 0: type, material, light, flags; rows 1–3: the world-to-local affine transform; row 4: shape parameters; row 5: random id, id, motion base + 1 | `oRow` (:403), `hitObj` (:642), `finishHit` (:777) |
| LI, 6 rows per light | position, radiance, shape | `lRow` (:1556), `sampleLight` (:1603) |
| BV, 2 rows per node | (min x, y, z, first object or left child), (max x, y, z, object count; 0 means inner node) | `traceAll` |

B-01, "Hello, sphere", is the running example of this guide. Its 248 words decode to:

```text
U   row 0  (160, 160, 0, 1)          160 × 160, 1 sample per pixel
    row 5  (1, 5, 2, 3)              maxDepth 5, roulette after 2, NEE and MIS on
    row 19 (2, 0, 2, 1)              nObj 2, nLights 0, first unbounded object 2, nNodes 1
O   object 0: type 0 (sphere), material 0, no light; transform rows (1,0,0,0) (0,1,0,−1) (0,0,1,0);
              radius 1                                    -> a unit sphere centred at (0, 1, 0)
    object 1: type 1 (plane), material 1; identity transform; side 30
LI  6 rows of zeros (no lights; the sun is on, U word 31)
BV  node 0: min (−15, −0.001, −15), max (15, 2, 15), first 0, count 2   -> one leaf with both objects
```

Across the gallery (`various/01-scene-table-inventory.txt`):

| measure | range over the 18 scenes |
|---|---|
| scene data | 224 – 916 words (6,496 words, 25,984 bytes in all) |
| objects | 1 – 24 (R-05 has 24) |
| lights | 0 – 2 |
| BVH nodes, leaves, objects per leaf, depth | 1 – 15, 1 – 8, at most 3, at most 4 |
| trips of the loop over objects outside the BVH | 0 or 1 |
| triangle meshes (type 13) | none in any scene |

These sizes bound the code a specializer can create. Unrolling every loop over objects and every BVH walk in the largest scene makes at most 24 copies of an intersection test and 16 states of a walk. The analysis in §16 relies on that.

## 4. How the kernel reads the buffers

Measurement 2 (`scripts/02-r0-buffer-reads-and-loops.mjs`) lifts Candela to r0 (0.7 s) and scans it without executing anything (`various/02-r0-buffer-reads-and-loops.txt`).

**A buffer read is a checked address and a load.** `q_bO.getF32(i)` lifts to `loadf32[caddr(q_bO, 2i + 1) + 2]`. Here is `oRow` at r0, printed by `listing` (`src/typed/listing.ts:108`):

```text
function oRow(q_k: K, i: i32, k: i32): V4f
bb:oRow.0  -> []
    s:oRow.0     q_bO = load32[q_k+4]
    s:oRow.1     q_t0 = (((i * 6) + k) * 4)
    s:oRow.2     t5 = ((q_t0 << 1) + 1)
    s:oRow.3     t6 = (((q_t0 + 1) << 1) + 1)
    s:oRow.4     t7 = (((q_t0 + 2) << 1) + 1)
    s:oRow.5     t8 = (((q_t0 + 3) << 1) + 1)
    s:oRow.6     return (loadf32[caddr(q_bO, t5)+2], loadf32[caddr(q_bO, t6)+2], …, loadf32[caddr(q_bO, t8)+2])
```

`load32[q_k+4]` is the pointer field `K.bO`. `caddr(r, p)` traps unless `p <u capacity(r)` and otherwise yields `r + 2p` (`src/typed/evaluate.ts:429–436`); `loadf32[a + 2]` reads the four bytes at `a + 2`. So position `2i + 1` and offset 2 reach byte `r + 4 + 4i`, the i-th float. Folding one such read needs three facts: what `K.bO` points to, what the buffer's capacity is, and what word sits at that position.

**Who reads what.** Of 559 checked addresses at r0:

| buffer | sites | positions | functions |
|---|---:|---|---|
| U (`bU`) | 174 | all constant | 31, from `renderPixel` to `traceAll` and 8 scene sections |
| O (`bO`) | 4 | variable | `oRow` only |
| LI (`bL`) | 4 | variable | `lRow` only |
| BV (`bB`) | 8 | variable | `traceAll` only |
| SD (`bS`) | 79 | variable | 7 (`finishHit`, `poseQ`, `poseT`, `mRow`, `hitMesh`, `hdriTexel`, `hdriSample`) |
| GGX table (`etab`) | 256 + 4 | 256 constant (`cdlInit`'s writes), 4 variable (`ggxE`) | 2 |
| sky table (`sky`) | 6 | variable | `skyBuild`, `skyTexel` |

The two halves of this table need different machinery. U is read at constant positions, so a rule that folds a load at a constant address into a constant memory region folds all 174 sites, in any function, with no change to control flow. O, LI and BV are each read by exactly one small function, always at a position computed from an index argument (`(i·6 + k)·4` for `oRow`). Those reads fold only where the index is known, and the index is known only in a version of the function made for it.

**Loops whose shape comes from the scene.** Of 19 natural loops, eight have exit conditions that read scene data and seven are bounded by constants or the contents of a frame array. The ones that matter per ray are in `traceAll` (`kernel.typed:962–1035`, abridged):

```js
function traceAll(q_k: K, ro…, rd…, tmax: f32, shadow: bool): TraceR {
    const cnt: V4f = V4f(q_bU.getF32(76), q_bU.getF32(77), q_bU.getF32(78), q_bU.getF32(79));
    const nObj = i32(cnt.x), nB = i32(cnt.z), nNodes = i32(cnt.w);
    for (let i = nB; i < nObj; i = i + 1) { … hitObj(q_k, i, …) … }        // objects outside the BVH
    if (nNodes > 0) {
        const stack = new Int32Array(40); let sp = 1; stack[0] = 0;
        while (true) {
            if (sp <= 0) break;
            sp = sp - 1; const ni = stack[sp];
            const a = <BV row 2·ni>, b = <BV row 2·ni + 1>;
            if (!hitAABB(ro, inv, a.xyz, b.xyz, r.t)) continue;               // dynamic: depends on the ray
            const cntN = i32(b.w);
            if (cntN > 0) {                                                   // a leaf
                for (let k = 0; k < cntN; k = k + 1) {
                    const oi = i32(a.w) + k;
                    … const t_1 = hitObj(q_k, oi, …, r.t);
                    if (t_1 < r.t) { r.t = t_1; r.obj = oi; }                 // dynamic: selects the object
                }
            } else if (sp < 38) { stack[sp] = i32(a.w); stack[sp + 1] = i32(a.w) + 1; sp = sp + 2; }
        }
    }
    return TraceR(r.t, r.obj);
}
```

The BVH loop's own control is static: `sp` starts at 1 and changes by constants, and the node indices it pushes come from BV rows. But it runs under a dynamic test, `hitAABB`, that depends on the ray. Whether a specializer can keep `sp` static there is the central question of §16.

**What `cdlRenderSpan` writes.** The same scan classifies every store reachable from each entry. From `cdlRenderSpan`, the stores are into the output buffer, into K's scratch fields (`rngS` by `renderPixel` and `rnd`; `gTime`, `gLam`, `gTau` by `renderPixel`; `gTri`, `gBary__x`, `gBary__y` by `hitMesh`) and into frame arrays (the BVH stacks of `traceAll` and `hitMesh`). None writes a scene buffer, the GGX table or the sky table, and no store has an unclassified address. `cdlInit` writes only the GGX table and `cdlSky` only the sky table. This is the fact the host promise of §13 checks statically.

## 5. Specialization today

`src/typed/specialize.ts` (143 lines) is the project's whole specializer. Read it before anything else in this ticket; the design extends each of its pieces.

**The fact.** A specialization fact is an artifact of the IR `typed.bindings` (`BindingsIR`, `specialize.ts:49–65`):

```ts
export interface Binding {                // specialize.ts:27–41
  readonly fn?: string; readonly param?: string;      // parameter form: fn's parameter is `value`
  readonly record?: string; readonly field?: string;  // field form: that field of every such record parameter
  readonly value: number;
  readonly entity: string;                // the outer entity that establishes it, e.g. 'scene/B-01'
  readonly note?: string;
}
export interface Bindings { readonly formatVersion: 1; readonly source: string; readonly bindings: readonly Binding[] }
```

The artifact's revision hash makes the fact citable: `factRef(art, b)` (`:68`) is `fact:typed.bindings:<id>@<revision prefix>#<entity>`, and every edit made on the strength of the fact carries it as its `because`. `Program.why` on anything the specialization removed reaches the scene.

**The pass.** `specialize` (`:71–143`) is an ordinary `typedPass` that writes only values. For the field form it reads the record layout from the front end (`st.frontEnd.records.K.scene.offset` is 28), finds every `load32[get p + 28]` where `p` is a K parameter whose only reaching definition is itself, and replaces it by the constant. Before rewriting, it refuses (`TxError('unsupported')`) when the function stores to that field through such a parameter (`:99–109`): a static check that the fact cannot be falsified inside the function. The ordinary passes then do the rest: `constprop`, `fold` and `cfg` resolve the dispatchers' comparisons and branches, and `dce` removes the dead arms.

**The assumption.** Specializing changes what the program means for inputs that violate the fact, so the contract changes with it. `Program.specialize(bindings)` (`src/typed/program.ts:186–196`) first calls `Program.assume` (`:166–184`), which records, for every function with a K parameter `q_k`, the assumption `q_k.scene = v`. The `inputs` getter (`:142–161`) turns a dotted assumption into the case specification `{ record: { scene: { oneOf: [v] } } }` inside that parameter's spec, so the meaning check compares the program with r0 only on inputs where the field holds the value. Each revision records the assumptions it was made under (`Revision.assumptions`, `:63–64`).

**Entries and dead functions.** `Program`'s option `entries` (`:94–98`) names the functions the host calls. When it is given, the contract compares only those (`MeaningParams.roots`, `evaluate.ts:562–572`), so a function only they call may change or disappear. `dfe` (`src/typed/passes.ts:876–958`) removes the functions no call from the roots reaches.

**The per-scene pipeline and what it bought.** IRWB-001's `scripts/12-candela-per-scene.mjs` opens Candela with the four entries and `candelaInputs`, applies `specialize` with `{ record: 'K', field: 'scene', value, entity: 'scene/<id>' }`, runs `constprop, fold, cfg, dce, cfg`, then `dfe`:

| result | value | source |
|---|---|---|
| functions kept per scene | 135–147 of 332 | IRWB-001 step 26 |
| statements per scene | 5,317–5,965 of 12,358 (−51.7% to −57.0%) | IRWB-001 step 26 |
| frames | all 18 bit-identical to the reference `kernel` image's, at stride 8 | IRWB-001 step 26 |
| B-01 image | 183,324 → 76,244 bytes (−58.4%) | IRWB-001 step 25 |
| B-01 instructions per pixel, our general → our scene image | 11,200.4 → 10,494.4 (−6.3%) | IRWB-001 step 25 |
| the same after O2+ | 10,435.0 | IRWB-001 step 27 |
| B-01 under IRWB-003's `speed` pipeline and three backend options | **8,267.7** (reference `kernel` image: 8,501) | IRWB-003 diary step 13, commit `47ba752` |
| R-01, the same | 18,186.7 (`kernel`: 15,655.9) | IRWB-003 diary step 14, commit `90fed9c` |

IRWB-003's `speed` pipeline inlines (`src/typed/inline.ts` on its branch: single-call-site and small callees, record results turned into locals), and its backend options rotate loops, coalesce copies and keep float constants in registers. Its 8,267.7 is the baseline every phase of this ticket is measured against. It is not merged; if its number changes before the merge, use the merged one.

## 6. Checking: the meaning contract, Candela's cases and the frame comparison

Every pass application is accepted only if the new revision agrees with r0 on generated cases (`meaningKept`, `evaluate.ts:587`; the contract `optimizationContract`, `passes.ts:222`). For Candela, the cases come from `candelaInputs` in `tools/candela.mjs:27–38`:

```js
const rows = n => ({ floats: [n, n], range: [0, 4] });
export const kSpec = (sky = 512) => ({ record: {
    bU: rows(512), bO: rows(512), bL: rows(512), bB: rows(512), bS: rows(512), etab: rows(512), sky: rows(sky),
    scene: { oneOf: [0, 1, …, 17] }, spectral: { bool: true }, skyOn: { bool: true }, rngS: [1, 2147483647], … } });
```

Every K in a case gets buffers of 512 random floats in [0, 4]: counts and indices read from them stay small, so cases mostly run. They are not scene data. A case of `cdlRenderSpan` with such rows renders a nonsense scene, and with random `x0` and `x1` it renders many pixels and often hits the step limit (2·10⁴ statements by default, `evaluate.ts:593`). IRWB-001 recorded this: the entry-only contract is weak for the internal functions, and "the decisive evidence for a scene kernel is the frame comparison" (IRWB-001 step 19).

**The frame comparison** is the check that ties a specialized program to the general one on real data. IRWB-001's `scripts/11-candela-render-compare.mjs`, `12-…` and `13-…`, and IRWB-003's `scripts/08-candela-scene-speed.mjs`, render the scene with the specialized program (evaluator or our image on the emulator) and with the reference compiler's `kernel` image on the emulator, and compare every output float bit for bit. At stride 8 it covers 400 pixels of a 160 × 160 scene and 100 of an 80 × 80 one, one sample each; that is 1.6% of the pixels. The design of §13 keeps it as the decisive check and adds a stronger sampled check on real rows.

The input specification already supports exact buffer contents: `{ cells: [...] }` makes a buffer with exactly those UTF-16 cells (`evaluate.ts:142`). A word of scene data is two cells. The case generator can therefore produce K records whose buffers hold a scene's real rows without any change to `makeValue`.

## 7. What a specializer can build on

**The evaluator's memory semantics** (`evaluate.ts:351–536`) are the specification every fold must respect:

- `load` reads a 32-bit word at `arg + imm`; `load16u` reads 16 bits. An f32 is its bit pattern as an i32, so a folded load yields `const` with `type: 'f32'` and the word's bits.
- `caddr(r, p)` reads the capacity at `r`, traps unless `p <u capacity`, and yields `r + 2p`. A fold of `caddr` with a constant receiver region and a constant position is valid only if `p` is below the region's capacity; otherwise the trap must stay.
- `store` writes 32 or 16 bits at `addr + offset`. Frame arrays live in a stack area above guest memory (`STACK_BYTES`, `evaluate.ts:332`); `aaddr off` is `frame + off`, and `zero` clears part of the frame.
- `agrees` (`:554`) compares results and the memory both runs wrote.

**SSA and SCCP** (IRWB-006). `ssaOf(st, f)` (`src/typed/ssa.ts:59`) computes single-assignment form as a fact: every `get` maps to the SSA name it reads, every join has phis. `sccpOf` (`src/typed/sccp.ts:47–115`) is Wegman and Zadeck's sparse conditional constant propagation over it: a lattice value per name (⊤, a constant, ⊥) and an executable flag per edge, propagated together. Its `evalTree` (`:61–72`) treats every operator outside `FOLDS` as ⊥, which includes `load` and `caddr`. Extending exactly that function with an abstract memory is Phase 1 of the plan. `sccp` is not in `PASSES`; it runs through `runPasses` (`:186`), with the pipeline `O2-sccp`.

**Inlining** (IRWB-003, unmerged). A call inlined at its site is the simplest form of a specialized version: one copy of the callee per call site, exposed to the caller's constants. `oRow` (7 statements) and `lRow` (7) are below IRWB-003's default size limit of 16 statements (its diary, step 8), so after inlining, a call `oRow(q_k, 0, 1)` with constant arguments becomes four loads at constant positions, which Phase 1's rule folds.

# Part 2: Partial evaluation, and how much there is to gain

## 8. The concepts

A **partial evaluator** takes a program and some of its inputs, and produces a **residual program** that, given the remaining inputs, computes what the original would have computed on all of them. The inputs given in advance are **static**; the others are **dynamic**. Each value and operation of the program then has a **binding time**: static if it can be computed from static inputs alone, dynamic otherwise. The partial evaluator computes the static operations and emits code only for the dynamic ones. The standard reference is Jones, Gomard and Sestoft's book (1993); the terms below are theirs.

For Candela:

```text
 program      the fixed kernel (and the hand-staged sections)
 static       the scene: U, O, LI, BV, SD; the GGX and sky tables; K.scene, K.spectral, K.skyOn; K's pointers
 dynamic      the pixel (y, x0, x1), the frame index, the RNG state and everything computed from them
 residual     a kernel that renders this one scene
```

The **first Futamura projection** states that specializing an interpreter on a program yields a compiled program (Futamura, 1971). The two further projections, specializing the specializer on the interpreter (a compiler) and on itself (a compiler generator), are not needed here. What matters is the first: the kernel interprets the scene buffers, so the residual is the scene compiled. The quality of the result depends on how much of the interpretation the specializer can make static, and that is what the measurement in §9 estimates.

The terms the design uses:

- **Offline and online.** An *offline* partial evaluator first runs a **binding-time analysis** (BTA) that labels every operation static or dynamic from the binding times of the inputs, then specializes by following the labels. An *online* one decides during specialization, looking at the actual static values. Offline is predictable and fast; online can exploit a value that happens to be static on one path but not another. IRWB-006's SCCP is online in this sense: it folds what turns out to be constant on the executable edges.
- **Monovariant and polyvariant.** A *monovariant* analysis gives each function (or program point) one binding-time signature. A *polyvariant* specializer makes several versions of a function or a program point, one per distinct combination of static values that reaches it. `oRow` called with object 0 and with object 1 needs two versions to fold both; a monovariant analysis must call its index argument dynamic, because one of the calls has a dynamic index.
- **Unfolding and memoization.** Unfolding a call replaces it by the specialized body (inlining is unfolding). Memoization keeps a table from (function, static arguments) to a residual function, so that equal static arguments share one version. It also makes recursion and loops terminate.
- **Program-point specialization and generalization.** A loop head reached with different static states (`sp = 1`, then `sp = 2`, …) can be specialized into one residual block per state. If the set of states can grow without bound, the specializer must **generalize**: give up on some static values at that point (make them dynamic) so that the states repeat. Choosing what to generalize is the termination problem.
- **The Trick.** A dynamic value known to lie in a small static set (an object index in `{−1, 0, …, nObj − 1}`) can be made static by a dynamic test per possible value: `switch (r.obj) { case 0: <version for 0> … }`. Jones, Gomard and Sestoft call this "The Trick". It trades code for static information.
- **Code growth.** Every version, unrolled iteration and case of The Trick is code. A specializer that never generalizes may not terminate; one that never splits gains nothing. Budgets decide.

## 9. Measurement 3: how much of a pixel is static

Before designing anything, this guide measured how much of Candela's per-pixel work a specializer could remove at best. `scripts/03-binding-time-profile.mjs` does it in three steps.

1. **Bind a real scene.** It runs `CandelaHost` on the evaluator at r0: `cdlLayout`, `cdlInit`, `bind`, `cdlSky`, exactly as the frame comparison does.
2. **Execute each pixel with a shadow interpreter.** For each pixel at stride 8, it executes `cdlRenderSpan(K, out, y, x, x + 1, 0)` with a copy of the evaluator's loop that also carries a **binding-time tag** for every local, every result leaf and every byte of memory. The tags are ordered C < K < M < X < D:
   - **C:** computed from literal constants only.
   - **K:** depends on `K.scene` (what IRWB-001 already binds).
   - **M:** depends on the frame-constant memory a host promise would cover: the five scene buffers, the two tables, K's pointer words, `K.spectral`, `K.skyOn`.
   - **X:** a load from that memory at a dynamic address (a table lookup The Trick could split on).
   - **D:** depends on the pixel, the RNG state or anything computed from them.

   An operation's tag is the largest of its operands'. Every executed value node except `const`, `get`, `result`, `tuple` and `aaddr`, plus every `store` and every conditional branch, is one **operation**, counted with its tag. Calls are counted separately. The shadow run's 12 output floats per pixel are compared bit for bit with the evaluator's own run of the same call: 0 differed in any scene or mode, so the profile describes the real execution.
3. **Model three specializers.**
   - **data (polyvariant):** tags follow data only. A value assigned under a dynamic test stays static if the assigned value is. This is what a specializer sees that splits the continuation of every dynamic test and makes a version for every static state: an upper bound on what any partial evaluator that keeps the arithmetic can make static.
   - **gen (polyvariant within a function):** as `data`, but a static value that a dynamic test selected (the object a hit test chose, say) becomes dynamic when it is returned from a function. The specializer may split continuations inside a function body but merges them at its return.
   - **control (monovariant):** in addition, a local assigned while a dynamic test's region is active (from the test to its immediate post-dominator) is dynamic, and so is a local the region may assign, at the join. This approximates an offline monovariant BTA.

   In the two polyvariant modes the script also computes a **dynamic slice**: the dynamic operations an output depends on, through data, memory, the dynamic tests that control them, and the tests that select a value they read. Dynamic work outside the slice would be dead in the residual program. For example, the local hit point that `finishHit` computes for materials that never read it.

The **bound** is the work today's per-scene kernel still executes, divided by the work the residual program would execute. Today's kernel has removed the K operations. Whether it has removed the C operations depends on whether O2 folded them, so the bound is reported as a range. The low end counts every C operation as already gone, the high end counts none as gone:

```text
 bound_lo = (M + X + D) / residual        bound_hi = (C + M + X + D) / residual
 residual = live X/D operations of the slice (data, gen)   or   X + D (control)
```

**B-01 in detail** (`various/03-binding-time-profile-all.json`, 400 pixels):

| | C | K | M | X | D | residual | bound |
|---|---:|---:|---:|---:|---:|---:|---:|
| data | 485.2 | 7.3 | 2,001.7 | 38.3 | 1,377.9 | 1,284.7 | 2.66–3.04 |
| gen | 402.4 | 7.3 | 1,656.7 | 126.1 | 1,717.9 | 1,581.4 | 2.21–2.47 |
| control | 279.5 | 7.3 | 402.4 | 406.8 | 2,814.4 | 3,221.2 | 1.12–1.21 |

(Operations per pixel; 3,910.4 in all. The evaluator itself counts 3,139.4 statements per pixel.)

Where the static work is, in the data mode:

- **The object table.** `oRow` runs 59.8 times per pixel and executes 1,374.7 operations per pixel, all static: 35% of everything. They are four loads from O, four checked addresses, and the index arithmetic.
- **Loads.** 432.6 static loads per pixel: O 239.1, U 82.7, BV 19.8, K's pointer and flag words 91.1. Checked addresses: 353.5 static per pixel. The sky table is the only dynamic-address lookup (X 25.5 per pixel), indexed by the ray direction.
- **Calls.** 200.1 calls per pixel. 102.9 of them have only static arguments (C 25.6, M 77.3) and would disappear entirely.
- **Float arithmetic** is mostly dynamic: 970.3 of 1,185.2 f32 operations per pixel. Of the dynamic f32 additions, subtractions and multiplications, 213.3 per pixel have a static operand equal to ±0 or ±1, mostly the zeros and ones of identity transforms. They are not counted as removable (§10.4).

And in the control mode: the object index reaches `oRow` as a dynamic value inside the BVH walk, so the O loads become X (239.1 per pixel) and the work around them D. What stays static is what does not depend on any index: U at constant positions (73.1 loads per pixel) and K's words. That is the monovariant specializer's 1.1–1.2×.

**All 18 scenes** (`various/04-profile-summary.txt`):

| scene | pixels | operations per pixel | M share | bound, data | bound, gen | bound, control | `oRow` share |
|---|---:|---:|---:|---:|---:|---:|---:|
| B-01 | 400 | 3,910 | 51.2% | 2.66–3.04 | 2.21–2.47 | 1.12–1.21 | 35.2% |
| R-01 | 400 | 9,940 | 67.3% | 4.51–4.94 | 3.29–3.56 | 1.06–1.10 | 46.8% |
| L-03 | 400 | 2,825 | 45.7% | 2.36–2.77 | 2.08–2.38 | 1.52–1.68 | 26.9% |
| G-01 | 400 | 7,592 | 59.1% | 3.16–3.51 | 2.53–2.77 | 1.07–1.12 | 39.4% |
| E-02 | 400 | 3,341 | 67.2% | 4.31–4.80 | 3.20–3.53 | 1.08–1.14 | 44.5% |
| W-02 | 400 | 12,196 | 56.0% | 2.98–3.34 | 2.49–2.76 | 1.05–1.10 | 33.0% |
| F-01 | 400 | 4,810 | 55.6% | 2.91–3.26 | 2.39–2.63 | 1.11–1.18 | 41.0% |
| V-02 | 400 | 12,838 | 63.8% | 3.77–4.12 | 2.85–3.09 | 1.10–1.15 | 42.4% |
| G-02 | 400 | 7,969 | 44.3% | 2.10–2.35 | 1.78–1.97 | 1.12–1.19 | 24.9% |
| X-04 | 100 | 8,544 | 30.9% | 1.56–1.69 | 1.40–1.49 | 1.06–1.10 | 19.5% |
| S-02 | 100 | 12,032 | 55.4% | 2.87–3.16 | 2.17–2.35 | 1.07–1.12 | 38.4% |
| R-05 | 100 | 12,798 | 58.6% | 3.06–3.38 | 2.46–2.68 | 1.07–1.11 | 38.6% |
| V-03 | 100 | 29,143 | 7.4% | 1.09–1.15 | 1.08–1.13 | 1.02–1.06 | 4.6% |
| V-04 | 100 | 41,355 | 6.0% | 1.07–1.13 | 1.07–1.11 | 1.04–1.08 | 3.6% |
| R-08 | 100 | 33,971 | 13.1% | 1.17–1.23 | 1.08–1.14 | 1.01–1.05 | 5.1% |
| X-03 | 100 | 137,984 | 2.8% | 1.04–1.30 | 1.03–1.28 | 1.00–1.23 | 1.8% |
| R-04 | 100 | 271,871 | 1.7% | 1.02–1.20 | 1.01–1.18 | 1.00–1.17 | 0.5% |
| G-03 | 100 | 415,316 | 0.9% | 1.01–1.19 | 1.00–1.18 | 1.00–1.18 | 0.2% |

Geometric means over the 18 scenes: data 2.08–2.33, gen 1.79–1.98, control 1.08–1.16. 0 output floats differed between the shadow runs and the evaluator in any scene or mode. The 80 × 80 scenes have 100 pixels at stride 8. The whole run took 5 min 55 s in one process capped at 14 GB, with a resident maximum of 425 MB.

What the table says:

- **Two kinds of scene.** In the first twelve scenes but X-04, most of a pixel's work reads the scene: the M share is 44–67% and `oRow` alone is 25–47%. There the polyvariant bound is 2.1–4.5×. In the ray-marched and volume scenes, a pixel executes 30,000 to 415,000 operations, almost all dynamic: distance-field and noise evaluation at every step of a march, density along the ray. Their M share is 1–13%, and no specializer that keeps the arithmetic gains more than 1.3×. X-04, the Menger sponge, is between the two: a distance field, but with a quarter of its work in the scene's tables.
- **Polyvariance is the whole difference.** The control mode never exceeds 1.68×, and its geometric mean is 1.08–1.16×. A monovariant specializer gets percents on every scene.
- **Merging at returns costs a quarter of the gain.** The gen mode keeps most of the data mode's bound (geometric means 1.79–1.98 against 2.08–2.33). Continuation splitting beyond function boundaries (§17) is worth having but is not where most of the gain is.
- **The high end is not free.** Where the bound's two ends differ much (X-03 1.04–1.30, G-03 1.01–1.19), the difference is C operations: loop counters and constant arithmetic in the noise and fbm loops, which O2 does not remove because it does not unroll. They count only if the specializer unrolls those loops.

## 10. The four classic problems, on this program

### 10.1 Binding-time analysis over memory

A BTA over variables asks whether a variable's value depends on dynamic inputs. Over memory, the question is whether the bytes a load reads were written by static operations, which depends on every store that might alias them. In general that requires an alias analysis and is the hardest part of partial evaluation for imperative programs.

Candela's case is easy for three reasons that the measurements establish:

- **The regions are named by access paths.** Every scene buffer is reached through one pointer field of `K` (`load32[q_k + 0…24]`), and each local holding one is assigned once per function (§4). A region can be identified by its path, `K.bO`, without knowing its address.
- **Nothing writes them during the frame.** No store reachable from `cdlRenderSpan` targets them, and no store there has an unclassified address (§4, measurement 2). A BTA can treat the regions as read-only for the whole entry.
- **The writable memory is small and typed.** What `cdlRenderSpan` writes is K's scratch words, the output buffer and frame arrays. The BVH stack is a frame array whose address never escapes `traceAll`, which is the case IRWB-002's item E5 (frame arrays into locals) handles.

### 10.2 Termination and generalization: the BVH walk

`traceAll`'s walk keeps a stack in a frame array. With the node rows static, the stack's contents and `sp` are static by data. But the walk runs under `hitAABB`, which is dynamic, so the sequence of static states depends on dynamic tests. A monovariant BTA must make `sp` dynamic at the loop head (the control mode does), and then every node index and every node load is dynamic.

A polyvariant specializer instead specializes the loop head per static state. For a tree, the state when a node is popped is a function of that node alone: the stack below it holds the pending left siblings on its path. The number of states is therefore at most the number of nodes plus one (the empty stack). R-01's BVH, decoded from its rows:

```text
 node 0  inner -> 1, 2
 node 1  inner -> 3, 4             node 2  inner -> 5, 6
 node 3  leaf: objects 0, 1        node 5  leaf: objects 4, 5
 node 4  leaf: objects 2, 3        node 6  leaf: objects 6, 7

 static states at the loop head (stack, top last):
   [0]  [1 2]  [1 5 6]  [1 5]  [1]  [3 4]  [3]  []        8 = 7 nodes + 1
```

The walk terminates because every state is a proper suffix of the traversal, and the specializer terminates because the memo table on states is finite. In the gallery, 16 states is the most any scene needs (R-05, 15 nodes). The guard `if (sp < 38)` is static in every state.

Generalization still matters elsewhere. `tracePath`'s bounce loop runs up to `maxDepth + 1` times (6 for B-01) and carries state that dynamic events select: the current medium, whether the last bounce was specular, whether the AOV outputs are done. Specializing each iteration separately multiplies the loop body (934 statements at r0) by the trip count. The data mode's bound includes that; a practical specializer generalizes at the bounce loop's head.

### 10.3 Polyvariance

The three modes differ only in polyvariance, and the bound moves from 1.1–1.2× (control) to 2.2–2.5× (gen) to 2.7–3.0× (data) on B-01. Three places carry most of the difference:

- **Functions of an index:** `oRow(q_k, i, k)`, `lRow`, `hitObj(q_k, i, …)`, `xfP`, `mBase`. One version per object (or inlining at each site) makes their reads static.
- **Program points under dynamic tests:** the BVH walk (§10.2).
- **Values selected by dynamic tests:** `r.obj` after `traceAll`. In the data mode, `finishHit(q_k, r.obj, …)` is specialized per object, because every continuation is split. In the gen mode `r.obj` becomes dynamic at `traceAll`'s return, and the loads in `finishHit` become X (B-01: X rises from 38.3 to 126.1 per pixel). The Trick on `r.obj` (§17) recovers them for `nObj + 1` versions of the continuation.

### 10.4 Code growth, and what the bound does not count

Every version costs bytes. The scene sizes of §3 bound the versions: at most 24 per-object versions of an intersection test, at most 16 BVH states, at most 3 objects per leaf. §18 turns this into a budget.

The bound counts operations, not instructions, and it assumes the specializer keeps the arithmetic. Three effects lie outside it:

- **Float identities.** 213.3 dynamic f32 operations per pixel on B-01 have an operand that is ±0 or ±1, mostly from identity transforms. Folding `0 · x` to `0` is wrong for infinite or NaN `x`, and `x + 0` to `x` is wrong for `x = −0`, so these stay unless a fact proves the operands finite (IRWB-002's item C6, float ranges) or a tolerance contract is accepted (IRWB-011).
- **Instruction weights.** Static work is load- and check-heavy (B-01: 432.6 loads and 353.5 checked addresses per pixel); in our images a load is one instruction and a checked address several. Calls with static arguments (102.9 per pixel) disappear with their call sequences. How the operation ratio translates into instructions is not measured; Phase 1 measures it.
- **The bounding box tests.** `hitAABB` is dynamic and stays. In B-01 the single leaf's box contains both objects, so the test could be dropped only if the compiler could prove that no ray it rejects would hit either object. That is a geometric fact about floats, not a program fact the compiler has. The design keeps the test (decision D4, §21).

# Part 3: The design

## 11. Overview

```text
   scene table row data                     Candela r0 (or the per-scene revision)
          │                                              │
          ▼                                              │
   ┌──────────────────────────────┐                      │
   │ static prefix on the         │  cdlLayout, cdlInit, │
   │ evaluator (CandelaHost)      │  bind, cdlSky        │
   └──────────────┬───────────────┘                      │
                  │ memory snapshot                      │
                  ▼                                      │
   ┌──────────────────────────────┐                      │
   │ typed.memory fact artifact   │──── factRef ───┐     │
   │ (regions by access path,     │                │     │
   │  words, provenance)          │                ▼     ▼
   └──────────────┬───────────────┘        ┌──────────────────────────┐
                  │ assume (promise)       │ Program                   │
                  ▼                        │  specialize K.scene       │
   ┌──────────────────────────────┐        │  P1 load folding (SCCP+M) │
   │ checks                       │◄───────│  P2 versions, unrolling   │
   │  static: no store reaches    │        │  P3 BVH program points    │
   │   a promised region          │        │  P4 The Trick, generalize │
   │  sampled: meaning-kept on    │        │  O2+ / speed, dfe         │
   │   real-row cases             │        └────────────┬─────────────┘
   │  frame: bit-identical render │                     │ residual revision
   └──────────────────────────────┘                     ▼
                                              lowerToImage -> image per scene
```

The pieces, in order of dependency: a fact artifact that describes the constant memory (§12), a promise that makes the fact an assumption of the contract and is checked (§13), and four specialization phases that use it (§14–§17), under a budget (§18), each keeping provenance (§19).

## 12. The constant-memory fact artifact (Proposed)

The fact generalizes `typed.bindings` from "this field holds this integer" to "this buffer holds these words".

```ts
// Proposed: src/typed/memory-facts.ts
export interface MemoryRegion {
  /** The access path from the entry's record parameter: 'K.bO' is the buffer whose address is in K.bO. */
  readonly path: { readonly record: string; readonly field: string };
  /** Capacity in UTF-16 units, as at byte 0 of the buffer (8 per row of four f32). */
  readonly units: number;
  /** The data words, as i32 bit patterns (an f32 is its bits). */
  readonly words: readonly number[];
  /** Word ranges and the outer entity each describes, e.g. { from: 24, to: 47, entity: 'scene/B-01#O/obj1' }. */
  readonly entities: readonly { readonly from: number; readonly to: number; readonly entity: string }[];
  /** 'data': copied from the scene table. 'computed': the program computed it (cdlSky), at that revision. */
  readonly origin: { readonly kind: 'data' } | { readonly kind: 'computed'; readonly fn: string; readonly rev: string };
}
export interface MemoryFacts {
  readonly formatVersion: 1;
  readonly source: string;                         // 'candela gallery'
  readonly scene: string;                          // 'B-01'
  /** The entries the promise holds for: the host calls them only with memory as described. */
  readonly entries: readonly string[];             // ['cdlRenderSpan']
  /** Scalar fields, as typed.bindings field bindings. */
  readonly fields: readonly { readonly record: string; readonly field: string; readonly value: number; readonly entity: string }[];
  readonly regions: readonly MemoryRegion[];
}
export const MemoryIR = defineIR<MemoryFacts>({ id: 'typed.memory', version: '1', /* validate: words are i32, ranges in bounds */ });
```

**How it is made.** A builder (Proposed `memoryFacts(program, scene)`) runs the static prefix of the host protocol on the evaluator at r0 (`CandelaHost` with `evaluate`) and reads the regions back through K's pointer words. This is exactly what measurement 3 does at its start (`scripts/03-binding-time-profile.mjs`, the `regions` array). The scene buffers are `kind: 'data'` with entities from the scene table's rows: object `i` is words `24i … 24i + 23` of O, light `j` words `24j …` of LI, node `n` words `8n … 8n + 7` of BV. The GGX table is computed by `cdlInit` and the sky table by `cdlSky`, so they are `kind: 'computed'` with the function and the revision.

For B-01 the artifact holds 248 words of scene data, 256 of GGX table and 12,288 of sky table, about 51 KB as JSON. Its revision hash names the scene's data exactly; two scenes with equal rows have equal facts.

**Why access paths, not addresses.** The host places buffers where it likes; `CandelaHost` puts the rows after the output buffer, and the device's host may not. The kernel never computes a buffer's address; it only loads it from K. A region named by its path is independent of the layout. The fold rule (§14) recognizes the path the same way `specialize` recognizes `K.scene`.

## 13. The host promise and its checks

A fact is useful only if it is true while the code that relies on it runs. The **host promise** (Proposed) is the statement:

> During every call of an entry in `facts.entries`, the K record passed to it has, in each region's path field, a pointer to a buffer holding exactly the region's capacity and words, and each scalar field holds its value; and no code the entry runs writes them.

The first half is the host's obligation; the second half is the program's, and the compiler checks it. Three checks, in increasing strength:

1. **Static: no store reaches a promised region.** For every function reachable from the entries, classify every `store` by its address, as measurement 2 does: through a checked address on a local holding a K buffer, into a K field through a K parameter, into a frame array, or unclassified. Refuse the specialization (`TxError('unsupported')`, as `specialize.ts:99–109` does for a field) if a store targets a promised region or if any store is unclassified. At r0 the check passes: `cdlRenderSpan` reaches stores into the output buffer, K's scratch fields and frame arrays only. The check must be re-run on every revision the specializer works on, because a later pass could in principle introduce a store; it is cheap (one walk over statements).
2. **Sampled: the restricted meaning contract on real rows.** `Program.assume` gains a region form (Proposed `assumeMemory(facts)`). For each promised entry, its K parameter's spec gets `{ cells: <the region's words as UTF-16 cells> }` for each path field, `{ oneOf: [v] }` for each scalar field, and the pixel arguments get one-pixel spans inside the image (`y ∈ [0, h)`, `x0 ∈ [0, w)`, `x1 = x0 + 1`). Then every pass is checked against r0 on cases that are real pixels of the real scene. Two practical points: a pixel costs 3,139 evaluator statements on B-01 and up to about 220,000 on G-03 (IRWB-001 step 26: 22 million statements for 100 pixels), so the contract's step limit must be raised for these cases; and a case is a pixel the frame comparison may not cover, which makes the two checks complementary.
3. **The frame comparison** stays the decisive check. It runs the whole protocol on the specialized program and compares every output float with the reference image's, bit for bit.

**An optional runtime guard** (Proposed variant). The promise can also be checked by the residual program itself. A guard at the entry compares the regions with the promised words and calls the general kernel on any difference. With the guard, the specialized image means what the general one means on every input, and no contract restriction is needed (this is IRWB-002's item E2, guarded specialization, applied to memory). Its cost per call is a comparison of B-01's 248 scene words. The sky table's 12,288 words are better covered by comparing the U rows `cdlSky` reads, since `cdlSky` is deterministic. Spread over a span of 160 pixels at about 8,000 instructions each, that is far below 1%; for one-pixel spans it is not. Whether the guard is worth its code is a decision for the device integration (§23).

**Scope.** The promise is per entry, unlike the field binding, which applies to every function with a K parameter. `cdlInit` and `cdlSky` write the GGX and sky tables, so the promise cannot hold for them; they stay general (they run once per bind). This is a deliberate difference from `Binding`'s field form (decision D2).

## 14. Phase 1: folding loads from constant memory

The first phase folds every load whose address is a constant position in a promised region. It needs no new versions and no change to control flow, and it covers U's 174 constant-position sites and every read of K's words.

**Abstract pointers.** Extend SCCP's lattice (`sccp.ts:23–26`) with one more kind of value:

```ts
// Proposed, in sccp.ts or a new memory-sccp.ts
type Lat = { k: 'top' } | { k: 'const'; v: number; t: 'i32' | 'f32' } | { k: 'ptr'; region: string; off: number } | { k: 'bot' };
```

`ptr` means "the address `off` bytes into the region". `evalTree` gains three cases:

```text
evalTree(load32[get p + o])       where p is a K parameter never reassigned, o = offset of a path field F
    -> ptr(region K.F, 0)                       (and for a scalar field: const value)
evalTree(caddr(r, q))             r -> ptr(R, 0), q -> const c
    if c <u R.units:  -> ptr(R, 2c)             the check folds: the position is in range
    else:             -> bot                    keep the trap
evalTree(load[a + imm])           a -> ptr(R, off), off + imm = 4 + 4w
    -> const(R.words[w], f32 if the load is f32)
anything else on a ptr            -> bot
```

The rewrite then replaces each folded `load` by its constant and each folded `caddr` by nothing (its users read the folded load). Every replacement carries `because: [factRef(memoryFacts, region entity of word w)]`. After it, `fold`, `cfg` and `dce` do what they do after `specialize`: `nNodes > 0`, `spp`, `mode === 20`, `q_k.spectral` and the sun and fog flags become constant branches, and their dead arms go.

On B-01, Phase 1 should remove the branches `renderPixel` takes on U (mode, spectral, motion), the U reads of `cameraRay`, `tracePath`'s settings and `traceAll`'s counts. That is the control mode's static share: about 10% of the operations (`memoryShare` 10.3 in the control mode). Phase 1 is necessary groundwork, and by itself it is a percent result.

**What to watch.** The `caddr` fold must compare the position with the region's capacity, not assume it; a wrong fold here turns a trap into a read past the buffer. The meaning contract's real-row cases exercise it.

## 15. Phase 2: calls and loops with static arguments

The second phase makes versions. Two mechanisms produce them, and the plan uses the cheaper first.

**Inlining** (IRWB-003's `inline`) unfolds a call at its site. After `inline`, `oRow(q_k, 0, 1)` is seven statements in the caller with `i = 0, k = 1`, and Phase 1 folds them. Inlining is polyvariance with one version per call site and no sharing. That suits `oRow`, `lRow`, `mBase` and `hitAABB`, which are small.

**Cloning with a memo table** (Proposed) makes one version per distinct static-argument vector and shares it between call sites. It suits functions too large to copy at every site: `hitObj` (285 statements at r0), `finishHit` (362), `xfP` (41).

```text
specializeCall(call g(args) in f):                    # Proposed: a program pass 'clone'
    sa <- static arguments of the call (SCCP values: const or ptr), as a canonical key
    if no argument is static: leave the call
    key <- (g, sa)
    if memo has key: replace the call by a call to memo[key]; return
    name <- g + '·' + hash(sa)                         # e.g. hitObj·obj0
    memo[key] <- name
    copy g to name with the static parameters replaced by their constants   # tx.cloneFunction (E2)
    run SCCP with memory, fold, cfg, dce on name        # may find more static calls: recurse, bounded
    replace the call
```

This needs what IRWB-002's item E2 lists: a write kind for functions (the write kinds in `src/typed/tx.ts:27` are `values`, `stmts`, `locals`, `cfg`) and `tx.cloneFunction(name, newName)` with origins from the original's entities. `dfe` then removes originals no entry reaches.

**Unrolling loops with static trip counts.** After Phase 1, `traceAll`'s loop over objects outside the BVH has constant bounds (`nB` and `nObj` from U), and so has `renderPixel`'s sample loop (`spp`, 1 in every gallery scene). A loop with a constant trip count `n` below a budget is replaced by `n` copies of its body with the induction variable constant in each (IRWB-002's item G3, unrolling, as a `chooseBest` candidate). Every copy's calls then have a static object index and fall to the cloning rule. On B-01 the loop over unbounded objects runs from 2 to 2 and disappears; on L-03 it runs once.

**Termination.** Cloning recurses: a clone of `hitObj` for object 0 calls `xfP(q_k, 0, …)`, which is cloned in turn. The recursion is bounded because static arguments come from scene data of bounded size (§3), and Typed has no recursive calls (its front end refuses call cycles; IRWB-003 diary, step 8). The memo table makes equal requests share a clone. A budget on the number of clones per function (§18) bounds the rest.

## 16. Phase 3: the BVH walk as polyvariant program points

The leaf loop over `k < cntN` and the leaf's object indices `a.w + k` become static only if the node index `ni` is static, which requires the walk's state `(sp, stack[0 … sp))` to stay static under `hitAABB`. The phase specializes the walk by executing its static part at compile time and emitting a residual block for each static state.

```text
specializeWalk(traceAll, facts):                       # Proposed, on one version of traceAll
    pending <- [ (head, state0 = { sp: 1, stack: [0] }) ];  done <- {}
    while pending not empty:
        (pc, s) <- pop pending
        if (pc, s) in done: continue;  done[(pc, s)] <- new residual block B(pc, s)
        if |done| > budget.states: GENERALIZE (keep the generic walk for this version) and stop
        execute from pc with static state s:
            static statements (sp, stack, node loads, leaf counts)   -> computed, no code
            dynamic statements (hitAABB, hitObj calls, t < r.t)      -> emitted into B(pc, s)
            a dynamic branch -> emit `if cond goto B(then, s') else B(else, s'')`, push both
            reaching the loop head with state s' -> emit `goto B(head, s')`, push it
```

The state is static memory (the stack is a frame array), so the phase depends on treating `traceAll`'s stack as values. IRWB-002's item E5 replaces a frame array whose address never escapes, and whose accesses have constant offsets, by one local per slot. Here the offsets are `4·sp`, constant in each state. So the scalarization must happen per state, inside this phase, not as a separate pass before it.

**B-01's residual walk.** One node, a leaf with objects 0 and 1:

```js
// residual traceAll for B-01, non-shadow version (sketch, after Phases 1–3)
r.t = tmax; r.obj = -1;
const inv = safeInv(rd);
if (hitAABB(ro, inv, -15, -0.001, -15, 15, 2, 15, r.t)) {
    const t0 = hitObj·obj0(ro, rd, r.t);  if (t0 < r.t) { r.t = t0; r.obj = 0; }   // the sphere
    const t1 = hitObj·obj1(ro, rd, r.t);  if (t1 < r.t) { r.t = t1; r.obj = 1; }   // the plane
}
return TraceR(r.t, r.obj);
```

Gone: the loop over unbounded objects (0 trips), the stack, `sp`, every BV load and check, the leaf count, `oRow` for the shadow flag (flags are 0), and the type dispatch inside each `hitObj` version. Remaining: one box test and two intersection tests, each with constant shape parameters. This is what "drop the BVH traversal for tiny scenes" means once it is made precise: the traversal machinery goes, and the box test stays (§10.4).

**R-01's residual walk** has the eight states of §10.2: a tree of seven box tests with four leaves of two intersection tests each, and no loop.

**Generalization.** If a scene's walk has more states than the budget, the phase gives up on that version and keeps the generic walk with Phase 1's folds. In the gallery the most is 16 states (§10.2), so the budget only matters for scenes outside it.

## 17. Phase 4: values a dynamic test selects

After the walk, `r.obj` is the object a dynamic test chose. `traceScene` passes it to `finishHit(q_k, r.obj, …)` (`kernel.typed:1037–1043`), which reads that object's rows through `oRow`: its material, its transform, its shape parameters. In the gen mode of measurement 3, which merges at returns, those reads are X (dynamic index, constant table). Two ways to make them static:

- **The Trick at the call** (Proposed). `r.obj` is in `{−1, 0, …, nObj − 1}`, a static set. Emit a chain of tests and call a version of `finishHit` per object:

  ```js
  // residual traceScene for B-01 (sketch)
  const r = traceAll·primary(…);
  if (r.obj === 0) return finishHit·obj0(ro, rd, r.t);
  if (r.obj === 1) return finishHit·obj1(ro, rd, r.t);
  return noHit();
  ```

  Each `finishHit·objN` has the object's type, material and transform constant; the material dispatch (`h.mat`) that `s0_evalMaterial` does at run time becomes static in the continuation too, if the split extends that far.
- **Continuation splitting** (the data mode's assumption). Split everything after `traceAll` per object, up to the end of the bounce. This is the larger version of the same idea, and its cost is the per-bounce shading code times the number of objects.

The choice is a budget decision per scene. On B-01 the difference between gen and data is 1,581.4 against 1,284.7 residual operations per pixel (§9). The Trick at `finishHit` is the first step, and the bounce loop's head is where every split is generalized (§10.2).

## 18. Code growth and budgets

Each phase creates code, and the image must fit the device. The relevant sizes today:

| image | bytes | source |
|---|---:|---|
| general program at r0, our backend | 183,324 | IRWB-001 step 25 |
| B-01 per-scene program, our backend | 76,244 | IRWB-001 step 25 |
| B-01 per-scene, O2+ | 74,044 | IRWB-001 step 27 |
| B-01 per-scene, `speed` with three options | 94,828 | IRWB-003 diary step 13 |
| reference compiler, `kernel` policy, general | 434,996 | IRWB-001 design-doc 05 §9 |

The device's limit on code is not recorded in this repository's documents. The gallery's `app.json` gives the compiled module a 20,971,520-byte heap, but whether code is placed in that heap is not stated there. Until it is known, the budget is relative: **a scene's image may grow to at most twice its per-scene size after IRWB-003's pipeline**, about 190 KB for B-01, which is still well under the reference compiler's general image.

Budget mechanics (Proposed):

- **Counters per phase.** Clones per function (default 32), BVH states per walk (default 64), unrolled iterations per loop (default 32), cases of The Trick per call (default 32). These limits exceed every gallery scene (24 objects, 16 states), so in the gallery the bytes budget is the binding limit.
- **Bytes as a strategy constraint.** Each phase is a candidate in a strategy: `chooseBest` over {without the phase, with it}, minimizing instructions per pixel under `bytes ≤ budget`, the way the IRWB-002 guide's §12 describes for any size-for-speed trade. The metric `instructions` today runs ten seeded cases per function (`strategies.ts:66`); for a scene program it must instead run real pixels (a few frames at stride 8), which is the frame comparison's harness.
- **Accounting by version.** A clone's cost is its statements after cleanup. Its benefit is the calls it serves times the operations saved per call, which the profile of §9 measures per function. A scene with many objects and few hits per object (R-05: 24 objects) is where the budget will bite first.

## 19. Provenance back to scene objects

Every folded constant, every clone and every residual block cites the fact that justified it, so `why` on a residual instruction can name the scene object it came from:

```text
 instruction in hitObj·obj0           flw ft0, …   (a constant radius 1.0)
   ← value made by memory-sccp at r3: load of K.bO word 16 folded
       because fact:typed.memory:gallery@3f2a…#scene/B-01#O/obj0/row4      object 0 (sphere), shape row
   ← clone hitObj·obj0 made by clone at r4 from hitObj
       because fact:typed.memory:gallery@3f2a…#scene/B-01#O/obj0/row0      object 0's type
```

(Illustrative: the revision hash and statement names will differ.) Three pieces carry this:

- **Entities in the fact.** `MemoryRegion.entities` maps word ranges to entities like `scene/B-01#O/obj0/row4`, so `factRef` can name the row, not just the scene.
- **Origins on clones.** `tx.cloneFunction` gives every copied entity an origin from the original and the fact reference as its `because`. An entity of a clone therefore has two parents, the original entity and the fact. Correspondence today keeps only an entity's first origin (IRWB-002 guide, §11), so IRWB-002's item I3 (multi-origin correspondence) is a dependency of good provenance here, though not of correctness.
- **Residual blocks of the walk.** Each block `B(pc, s)` records its state, so `why` on a box test can say "node 2 of the BVH, reached after the root's test".

## 20. Hand staging against automatic specialization

The gallery's generator already specialized Candela by hand for part of each scene: the materials, user distance fields, height fields, densities and custom integrators are emitted per scene as the `s<k>_` sections, with constants written in (§1). The rest stays in buffers. The same program therefore contains both approaches side by side, which allows a comparison that is rarely possible: hand staging and automatic specialization on one program, judged by one measure.

Measurement 3 already separates the two parts. Per pixel, in the data mode (`various/04-profile-summary.txt`, last table):

| scene | operations in `s<k>_` sections | share of the pixel | operations in the kernel |
|---|---:|---:|---:|
| B-01 | 26.3 | 0.7% | 3,884.2 |
| R-01 | 43.2 | 0.4% | 9,896.3 |
| W-02 | 82.8 | 0.7% | 12,112.7 |
| G-02 | 658.6 | 8.3% | 7,310.6 |
| X-04 | 1,741.0 | 20.4% | 6,802.7 |
| R-08 | 3,293.8 | 9.7% | 30,677.2 |

The generator staged the parts of a scene that cost little per pixel. In the object-and-BVH scenes the sections are at most 3% of a pixel's operations; even in the distance-field scenes they are at most 20%. What it left to the kernel, the object table and the BVH, is where the static work is. The sections themselves are dynamic for the most part, as hand-staged code should be once O2 has folded its literal arithmetic (B-01: of 26.3 operations, 13.3 are C, and the residual is 7.3). The hand staging is thus well done but aimed at the wrong place for speed: it removed the variety of materials from the code, which matters for size and for writing the kernel once, and left the per-ray interpretation in place.

**The experiment to set up** (Proposed, Phase 5):

1. **Measure the two parts separately** after each phase, with the profile of §9 on the specialized revision: operations, static and residual, in `s<k>_` functions and in kernel functions. Automatic specialization succeeds where the kernel's residual fraction approaches the sections'.
2. **Undo the staging for one material.** Write a small Typed interpreter for one material kind (a lobe chosen by a table row of parameters instead of literals), give scene 0's two materials as rows in a new region, and specialize. If the specializer reproduces `s0_mat_0`'s code (the same residual operations per call, the same constants), it has matched the generator on its own ground. This needs no Candela tooling, only a corpus project, and it is the cleanest test of the claim that the compiler can do the generator's job.
3. **Report the division.** Compare the generator's binding-time division (what it put in code, what in buffers) with the specializer's (what its BTA or its online run found static). A place where the specializer finds static work inside a section is something the generator left on the table.

## 21. Decisions

| | decision | alternatives | reason | status |
|---|---|---|---|---|
| D1 | regions are named by access path from K (`K.bO`), not by address | absolute address ranges | layout-independent; the kernel only reaches buffers through K; matches how `specialize` recognizes `K.scene` | proposed |
| D2 | the promise holds per entry (`cdlRenderSpan`), not for every function | every function with a K parameter, as the field binding does | `cdlInit` and `cdlSky` write the tables; a promise for them would be false | proposed |
| D3 | an online specializer (SCCP extended with memory, then versions) rather than an offline BTA first | offline BTA with annotations | measurement 3: a monovariant offline division is worth 1.1–1.2×, the polyvariant one up to 2.7–3.0× on B-01 | proposed |
| D4 | the bounding-box tests stay | drop them for one-leaf scenes | no program fact proves them redundant in float arithmetic; the frame comparison would test one frame, not prove it | proposed |
| D5 | inlining first, cloning with a memo table second | cloning only | inlining exists (IRWB-003) and covers the small readers (`oRow`, `lRow`); cloning needs a new write kind | proposed |
| D6 | the static prefix (`cdlLayout`, `cdlInit`, `bind`, `cdlSky`) runs on the evaluator at compile time to produce the fact | recompute the tables in the specializer by partial evaluation of `cdlSky` | the evaluator is the specification; the tables are computed facts with provenance; `cdlSky` runs once per bind and is not hot | proposed |
| D7 | budgets are relative to the per-scene image (≤ 2×) until the device's code limit is known | an absolute limit | the limit is not recorded (§18) | open |

# Part 4: Risks, falsification and the plan

## 22. Risks

- **Compile time.** Candela passes cost seconds to minutes (B-01's whole `speed` pipeline: 139.9 s; IRWB-003 diary step 13). Cloning adds functions, and every function is checked by the contract. Each phase must report its compile time on Candela next to its gain (IRWB-002's rule 4).
- **The sampled check on real rows is expensive.** A pixel is thousands to hundreds of thousands of statements (§13), so real-row cases are few. The frame comparison at stride 8 covers 1.6% of the pixels with one sample each. A wrong fold that affects only rare pixels (grazing rays, the sky's edge) could pass both. Mitigations: compare more pixels for the final images (stride 4 or 1 for one scene), and add the evaluator-against-evaluator per-function check IRWB-001 used after O2+ (step 27), with the memory assumption in every function's inputs.
- **The promise can be broken by the host.** On the device, the host binds a scene and renders; if it ever rebinds without recompiling, the specialized image computes the old scene. The runtime guard (§13) turns that into a fallback instead of a wrong frame. Without it, the per-scene image must be keyed by the fact's revision hash.
- **Float semantics limit folding.** Constant rows fold loads, not the arithmetic around them (§10.4). If the hypothesis needs `0 · x` gone, it needs float range facts first.
- **Code growth.** On R-05 (24 objects, 15 nodes) the clones and states may exceed the budget before the gain arrives; the bound for such scenes may not be reachable.
- **Interactions with IRWB-003.** Inlining before cloning changes what is cloned; inlining after cloning may undo the sharing. The phase order must be chosen by measurement.

## 23. The hypothesis and what would falsify it

**Hypothesis.** Specializing Candela on a scene's constant memory reduces instructions per pixel by a factor, not a percentage. Concretely: on B-01 and R-01, the per-scene program after this ticket's phases executes at most half the instructions per pixel of IRWB-003's per-scene results (8,267.7 and 18,186.7), with frames bit-identical to the reference.

**What has already been tested.** Measurement 3 tests the hypothesis's precondition, in operations at r0, and it has already decided part of it.

- **Monovariant specialization is excluded.** Its bound is at most 1.68× on any gallery scene (L-03) and 1.12–1.21× on B-01. No design that keeps one version per function can reach a factor of 2.
- **The ray-marched and volume scenes are excluded.** On X-04, V-03, V-04, R-08, X-03, R-04 and G-03 even the polyvariant bound is below 1.7×. Their cost is dynamic float arithmetic, which no specializer that keeps the arithmetic removes. For them the hypothesis is false; their gains, if any, come from elsewhere (IRWB-003's code generation, inlining, float facts).
- **For the other 11 scenes the hypothesis is open.** Their polyvariant bound is 2.1–4.5× at its low end. On B-01 it is 2.66–3.04×, so a factor of 2 needs about 70% of the ideal; on R-01 (4.51–4.94×), less than half. The gen mode (merging at returns) gives 2.21–2.47× on B-01, so on B-01 the factor of 2 without continuation splitting needs nearly all of the gen bound, while on R-01 (gen 3.29–3.56×) it does not.

**What would falsify it from here:**

1. **Phases 2 and 3 leave B-01 above 6,000 instructions per pixel** (73% of 8,267.7). These phases carry most of the polyvariant gain: `oRow` alone is 35% of B-01's operations and the walk most of the rest. If they leave more than that, Phase 4 cannot close the gap to 4,134.
2. **The operation bound does not transfer to instructions.** Phase 1 measures how many instructions the folded operations were worth. If static operations turn out to be cheaper than average in our images, the instruction bound is below the operation bound, and the factor of 2 is out of reach on B-01 even if it remains within reach on R-01.
3. **The budget binds first.** If, on the scenes with the most objects (R-05, 24 objects; W-02, 15), the versions needed for the gain exceed twice the per-scene image, the hypothesis holds only for small scenes.
4. **Correctness costs.** If the real-row contract or the frame comparison rejects a phase and the fix keeps dynamic what was folded, the bound moves down.

## 24. The phased plan

Every phase ends with the same three measurements on B-01 and R-01, unless stated: **operations per pixel** (the profile of §9, run on the phase's output revision), **instructions per pixel** and **bytes** of the image (IRWB-003's per-scene script), and a **bit-identical frame** at stride 8 against the reference. The baselines are §5's and §9's tables.

**Phase 0: the measuring harness.** Move `scripts/03-binding-time-profile.mjs` into `tools/` as a profile any revision can be given (it takes the store to execute). Add the per-scene instruction measurement for a saved head, which IRWB-003's `scripts/08-candela-scene-speed.mjs` already does. *Acceptance:* the profile of the per-scene revision after `specialize` and `dfe` agrees with the r0 profile minus the K operations, and reproduces 0 differing floats.

**Phase 1: the fact, the promise, constant-address loads.** `typed.memory`, `memoryFacts(program, scene)`, `assumeMemory` with `{ cells }` specs and one-pixel spans, the static no-store check, and the memory extension of SCCP (`ptr` values, folded `load` and `caddr`) as a pass `memory-sccp` in `SSA_PASSES`. *Acceptance:* every U read at a constant position and every read of K's words 0–9 folded in every function reachable from `cdlRenderSpan` (count 0 remaining), each fold with a `because` to a region entity; the contract accepts on real-row cases; frames bit-identical; instructions per pixel reported against 8,267.7. Expected from the control-mode profile: about 10% of operations.

**Phase 2: versions and unrolling.** `inline` (IRWB-003) for `oRow`, `lRow`, `mBase`, `hitAABB`; the write kind `fns`, `tx.cloneFunction`, and a `clone` pass with a memo table for `hitObj`, `finishHit`, `xfP`, `xfD`, `xfN`; full unrolling of loops with constant trip counts under the budget. *Acceptance:* no `oRow` call remains with a static object index; no loop with a constant trip count below the budget remains; clones per function and bytes reported; operations per pixel compared with the gen bound; instructions per pixel.

**Phase 3: the BVH walk.** Program-point specialization of `traceAll`'s walk with the stack as per-state values, and generalization when the states exceed the budget. *Acceptance:* in every gallery scene, the walk is replaced by a tree of box tests with as many blocks as the walk has states (B-01: 2 = 1 node + 1; R-01: 8); BV loads per pixel 0; frames bit-identical; instructions per pixel. Falsifier 1 of §23 is checked here.

**Phase 4: The Trick and generalization.** The Trick on `r.obj` at `finishHit`, and on the light index at `sampleLight`; generalization at `tracePath`'s bounce head. *Acceptance:* operations per pixel compared with the data bound; X loads per pixel in `finishHit` 0; bytes against the budget.

**Phase 5: the gallery, the budget and the comparison.** All 18 scenes, each phase as a `chooseBest` candidate under the bytes budget, and the hand-staging experiment of §20. *Acceptance:* a table per scene of instructions per pixel, bytes and the chosen phases; the material experiment's residual against `s0_mat_0`; the hypothesis judged by §23.

```text
 Phase 0 harness ──► Phase 1 fact, promise, loads ──► Phase 2 versions ──► Phase 3 walk ──► Phase 4 Trick ──► Phase 5
                         │ needs: SCCP (IRWB-006)        │ needs: inline (IRWB-003),         │ needs: frame arrays
                         │ { cells } specs (exists)      │ fns write kind, clone (E2)         │ as values (E5, per state)
```

## 25. API reference

**Existing** (at `a4beda6`, except where marked):

| symbol | file:line | role here |
|---|---|---|
| `Binding`, `Bindings`, `BindingsIR`, `factRef`, `specialize` | `src/typed/specialize.ts:27, 42, 49, 68, 71` | the fact, its citation and the pass this ticket generalizes |
| `Program` options `entries`, `inputs`; `assume`, `specialize`, `apply` | `src/typed/program.ts:94–98, 142, 166, 186, 248` | the assumption and the entry-only contract |
| `dfe` | `src/typed/passes.ts:876–958` | removes originals and unreached clones |
| `bcm` | `src/typed/passes.ts:697` | merges checked addresses; its linear-position reasoning is what `caddr` folding generalizes |
| `typedPass`, `optimizationContract`, `PIPELINES` | `src/typed/passes.ts:166, 222, 1046` | how a pass and its contract are declared |
| `MeaningParams.roots`, `meaningKept`, `casesFrom`, `agrees` | `src/typed/evaluate.ts:562, 587, 232, 554` | the sampled check, cases, the verdict |
| `evaluate` (`load`, `caddr`, `store`, frames) | `src/typed/evaluate.ts:351–536` | the semantics every fold must keep |
| input spec `{ cells }`, `{ floats, range }`, `{ record }`, `{ oneOf }` | `src/typed/evaluate.ts:111–190` | real-row cases without new code |
| `ssaOf`, `sccpOf`, `sccp`, `runPasses`, `SSA_PIPELINES` | `src/typed/ssa.ts:59`, `src/typed/sccp.ts:47, 141, 186, 171` | the base of Phase 1 |
| `loopsOf`, `cfgOf`, `dominatorsOf` | `src/typed/analyses.ts:207, 75, 140` | loops for unrolling, the CFG |
| `CandelaHost`, `parseSceneTable`, `renderScene`, `MEMORY_BYTES` | `src/typed/candela-render.ts:74, 34, 166, 70` | the host protocol, the scene data, the frame |
| `candelaInputs`, `kSpec`, `candelaSource` | `tools/candela.mjs:27, 18, 41` | today's synthetic K cases |
| `inline` (`makeInline`), `speed` | `src/typed/inline.ts`, `src/typed/passes.ts` on IRWB-003's branch, `90fed9c` | unfolding; the baseline pipeline |

**Proposed** (names are suggestions):

| symbol | where | role |
|---|---|---|
| `MemoryRegion`, `MemoryFacts`, `MemoryIR` (`typed.memory`) | `src/typed/memory-facts.ts` | the constant-memory fact (§12) |
| `memoryFacts(program, scene)` | same | runs the static prefix, reads the regions back, attaches entities |
| `memoryRef(art, entity)` | same | the `because` of a fold, like `factRef` |
| `Program.assumeMemory(facts)` | `src/typed/program.ts` | the promise as an assumption: `{ cells }`, `{ oneOf }`, one-pixel spans (§13) |
| `checkNoStores(program, facts)` | `src/typed/memory-facts.ts` | the static half of the promise (§13) |
| `memory-sccp` | `src/typed/sccp.ts` or `memory-sccp.ts`, in `SSA_PASSES` | Phase 1 (§14) |
| write kind `fns`, `tx.cloneFunction(name, newName, opts)` | `src/typed/tx.ts` | versions with origins (§15) |
| `clone` | a program pass like `dfe` | Phase 2's memo-table specializer (§15) |
| `walk` | a pass on one function | Phase 3 (§16) |
| `trick` | a pass on call sites | Phase 4 (§17) |
| `tools/candela-profile.mjs` | `tools/` | Phase 0's profile of any revision |

## 26. File reference

| file | why you will open it |
|---|---|
| `src/typed/specialize.ts` | the specializer that exists; the model for the field and fact handling |
| `src/typed/program.ts` | `assume`, `inputs`, `entries`, `specialize`, `apply`: the contract a promise changes |
| `src/typed/sccp.ts`, `src/typed/ssa.ts` | the lattice and propagation Phase 1 extends |
| `src/typed/evaluate.ts` | memory semantics; the case generator's `{ cells }` |
| `src/typed/passes.ts` | `dfe` (a program pass), `bcm` (checked-address reasoning), `typedPass` |
| `src/typed/tx.ts` | where `fns` and `cloneFunction` would go |
| `src/typed/candela-render.ts` | the host protocol and the memory map |
| `tools/candela.mjs` | Candela's synthetic case specifications |
| `corpus/candela-gallery/kernel.typed` | `oRow` :403, `hitObj` :642, `finishHit` :777, `traceAll` :962, `traceScene` :1037, `lRow` :1556, `tracePath` :2117, `renderPixel` :2599, `evalMaterial` :2782 |
| `corpus/candela-gallery/scenes.typed`, `glue.typed`, `types.typed` | the hand-staged sections, the entries, record `K` |
| `corpus/candela-gallery/candela_gallery_scenes.c` | the scene rows (data only, never compiled) |
| `IRWB-007/scripts/01–04` and `IRWB-007/various/01–04` | this guide's measurements and their outputs |
| IRWB-001 `scripts/12-candela-per-scene.mjs`, `13-candela-per-scene-images.mjs` | the per-scene pipeline and the frame comparison |
| IRWB-003 `scripts/08-candela-scene-speed.mjs` (branch `90fed9c`) | per-scene instructions per pixel under `speed` |

## 27. Related work

- Yoshihiko Futamura, "Partial evaluation of computation process: an approach to a compiler-compiler", *Systems, Computers, Controls*, 1971. The three projections; this ticket is the first.
- Neil D. Jones, Carsten K. Gomard and Peter Sestoft, *Partial Evaluation and Automatic Program Generation*, Prentice Hall, 1993. Binding-time analysis, online and offline specialization, polyvariance, generalization, The Trick.
- Brian Guenter, Todd B. Knoblock and Erik Ruf, "Specializing shaders", SIGGRAPH 1995. Specialization applied to rendering code, with parameters as the static input.
- Walid Taha and Tim Sheard, "Multi-stage programming with explicit annotations", PEPM 1997; Tiark Rompf and Martin Odersky, "Lightweight modular staging", GPCE 2010. Staging by the programmer, the counterpart of the gallery's hand-staged sections.
- Thomas Würthinger et al., "Practical partial evaluation for high-performance dynamic language runtimes", PLDI 2017. The first projection applied to interpreters at scale (Truffle and Graal).
- Mark N. Wegman and F. Kenneth Zadeck, "Constant propagation with conditional branches", TOPLAS 1991. The algorithm in `sccp.ts`, which Phase 1 extends.
- Hiralal Agrawal and Joseph R. Horgan, "Dynamic program slicing", PLDI 1990. The slicing method of measurement 3, including the treatment of statements not executed.

## 28. Glossary

- **Access path:** the way a region is reached from an entry's parameters, e.g. `K.bO`.
- **Binding time:** whether a value is static (known at specialization time) or dynamic.
- **Bound (measurement 3):** operations today's per-scene kernel executes per pixel, divided by the residual operations of an ideal specializer of a given kind.
- **Frame comparison:** rendering a scene with the program under test and with the reference image, and comparing every output float bit for bit.
- **Host promise:** the statement that promised regions hold promised words during an entry's calls (§13).
- **Polyvariant / monovariant:** several versions per function or program point, or one.
- **Region:** a buffer the fact describes, named by its access path.
- **Residual program:** what a specializer emits: the dynamic part of the original.
- **The Trick:** making a dynamic value from a small static set static by testing each possible value.
