---
Title: 'Next phase: O2+, framework performance, the f32 backend, caddr bounds checks and per-scene Candela kernels'
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
    - Path: repo://corpus/candela-gallery/kernel.typed
      Note: the scene dispatchers
    - Path: repo://src/framework/core/data.ts
      Note: 'canonical encoding, freezing and hashing: the cost on Candela'
    - Path: repo://src/typed/backend/regalloc.ts
      Note: linear scan to extend with an f register class
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-24T22:25:14.985701277-05:00
WhatFor: ""
WhenToUse: ""
---

# Next phase: O2+, framework performance, the f32 backend, caddr bounds checks and per-scene Candela kernels

## 1. Where the compiler stands

After the f32/Candela merge (commit fcb155f), this is the state of the work:

- **Corpus.** The compiler reproduces Compiler Workbench's book: the same revisions, provenance, images and checks.
- **Ordering search.** 12 of 44 projects get faster than O2. Eleven of those gains are a single extra `subst` after O2 (diary step 9).
- **Candela on the kernel.**
  - All 332 functions lift.
  - The evaluator agrees with the reference compiler's `stock` image on every decided case.
  - O2 makes 13 checked revisions and cuts statements by 23 %.
- **Missing for Candela:**
  - An RV32 image, because the backend handles i32 only. Candela's results can therefore be measured only in statements, not in instructions.
  - Fast passes. A pass costs about two minutes, almost all of it in the framework's generic encoding, hashing and freezing.

This document designs the next six pieces of work, in the order they unblock each other.

| task | work | who |
|---|---|---|
| 4c1o (P4.4) | `O2+` pipeline | coordinator |
| 9rcu (P4.6) | framework performance on large artifacts | coordinator |
| owi2 (P4.5) | the f32 RV32F backend | subagent, own worktree and diary |
| t4dq (P4.7) | `caddr`-aware bounds-check elimination | coordinator |
| gxe6 (P4.8) | Candela oracle against the `kernel` policy | coordinator |
| ckco (P4.3) | per-scene Candela kernels | coordinator, after 9rcu, t4dq and owi2 |

## 2. O2+ (P4.4)

`O2+` is O2 followed by one `subst`. O2 itself stays as it is, because O2 is what reproduces the book. The new pipeline joins `PIPELINES` and the workbench's pipeline list. Acceptance:
- the eleven projects reach the instruction counts measured in step 9;
- the corpus checks agree;
- a test pins Checksum at 1,260 instructions over its 10 measurement cases.

## 3. Framework performance on large artifacts (P4.6)

### 3.1 Where the time goes

`createIRArtifact(adapter, id, value)` does the following:

```
snapshot = immutable(value)              # canonical(value), JSON.parse, deepFreeze
contentHash = fingerprint(snapshot)      # canonical(snapshot), sha256
revision = fingerprint({kind, schemaVersion, value: snapshot})   # canonical again, sha256
artifact = immutable({..., value: snapshot})                     # canonical again, parse, freeze
project(adapter, artifact.value)         # per entity: canonical(validateEntity(resolve(id))) and canonical(entity)
```

That is five canonical encodings of the whole value, two SHA-256 hashes over the full text, and two encodings per entity. On Candela the value has 235,000 records, and the profile in the f32 agent's diary (Step 8) attributes 38 s of self time to `encode`, 17.6 s to its helper, 11.9 s to `sha256`, 5.9 s to `immutable` and 3.3 s to `deepFreeze`.

### 3.2 Design: cache what deep freezing already guarantees

A value produced by `immutable` is deep-frozen and already in canonical form: keys sorted, −0 normalized, no accessors. Its canonical text can never change. Three changes follow:

1. **A registry of canonical values.** `immutable` records the root and every object it freezes in a module-level `WeakSet`, `CANONICAL`, because it built them from canonical JSON.
2. **An encoding cache.** `canonical(v)` consults a `WeakMap<object, string>` for objects in `CANONICAL` and stores the text it computes for them. Encoding `{kind, schemaVersion, value: snapshot}` then reuses the snapshot's text.
3. **A short circuit.** `immutable(v)` returns `v` itself when `v` is in `CANONICAL`. This is valid because `JSON.parse(canonical(v))` would be structurally identical and also frozen.

Hashes stay the same by construction: the cached text is the text the encoder would produce. Values constructed outside `immutable` are encoded exactly as today. The projection check `canonical(validateEntity(resolved)) !== canonical(entity)` benefits when the adapter returns frozen canonical records. The typed adapter does, through `storeOf`'s cache, but only if those records went through `immutable`. If not, the projection's per-entity check is the next target: it can compare against a precomputed `Map` of entity texts built once per graph.

### 3.3 Acceptance

- **Hashes unchanged:** every corpus project's r0 hash, O2 head hash and image hash, and the framework tests.
- **Speed:** `applyPass` on Candela r0 for a pass that changes nothing (`simplify` at r5) measured before and after; target at least 3× faster.
- **The full O2 run on Candela** is timed again.

## 4. The f32 RV32F backend (P4.5, subagent)

### 4.1 Scope

The backend gains the RV32F extension so that every Candela function compiles to an image that agrees with the evaluator. What has to be lowered:

| IR construct | lowering | reference |
|---|---|---|
| `fadd fsub fmul fdiv fsqrt` | `fadd.s` … `fsqrt.s`, rm = RNE (static) | typed-rv32.js:839–841 |
| `fneg fabs fcopysign` | `fsgnjn.s`, `fsgnjx.s`, `fsgnj.s` | tape.js:89 |
| `fmin fmax` | `fmin.s`, `fmax.s` (RISC-V F 2.2 semantics match the evaluator's) | rv32-interp.js:149 |
| `feq flt fle` (`fgt fge` swapped, `fne` as `feq` then `xori 1`) | `feq.s`, `flt.s`, `fle.s` | rv32-interp.js:158 |
| `f2i f2u` | `fcvt.w.s` and `fcvt.wu.s`, rm = RTZ (saturating) | typed-rv32.js:937 |
| `i2f u2f` | `fcvt.s.w`, `fcvt.s.wu` | tape.js:102 |
| `floor ceil trunc` | the reference compiler's `round(rm)` sequence | typed-rv32.js:954 |
| `f2bits bits2f` | `fmv.x.w`, `fmv.w.x` | |
| f32 constants | `lui`/`addi` to an x register, then `fmv.w.x` (0 via `fmv.w.x f, zero`) | |
| f32 loads and stores | `flw`, `fsw`, with the offset folded in | |
| `caddr(r, p)` | the checked-address sequence | typed-rv32.js:349, :1334 |
| `aaddr off`, `zero off n` | frame array base (sp-relative) and a zeroing loop or unrolled `sw` | typed-rv32.js:1346, :1354, :1396 |
| `eval call f(…)` + `result#k`, `return tuple(…)` | ilp32f result locations: a0–a7 and fa0–fa7 per class, stack words beyond | typed-rv32.js:41, :59; `src/typed/reference.ts` |
| f32 arguments | fa0–fa7, then a free x register (bits), then stack words | `argumentRegisters` |

### 4.2 Register classes

The allocator gets two classes. Every virtual register has a class, and an interval only ever receives a physical register of its own class:

| class | caller-saved pool | callee-saved pool | argument registers | spill scratch |
|---|---|---|---|---|
| x | t0–t4 (+ a0–a7 in leaves) | s1–s11 | a0–a7 | t5, t6 |
| f | ft0–ft11 (+ fa0–fa7 in leaves) | fs0–fs11 | fa0–fa7 | two f registers reserved, e.g. ft10, ft11 |

Spills of f registers use `fsw`/`flw`. The prologue and epilogue save the callee-saved f registers that are used, as they do for `s` registers. The existing options (`registers`, `order`, `spill`, `hints`) apply per class.

### 4.3 Acceptance

1. **The i32 corpus is unchanged:** 5,160 bytes over the corpus, the chapter 14 table, and `IRWB_FULL=1` parity.
2. **Every Candela function compiles**, at r0 and at the O2 head.
3. **Each Candela image agrees with the evaluator** on 100 cases per function, using `imageAgrees` extended to f32 and multi-value results. That is the evaluator as oracle; the reference image is the second oracle.
4. **Report per function and in total:**
   - bytes and instructions per case at r0 and at O2;
   - the reference compiler's `stock` and `kernel` policies for the same functions.

The subagent keeps its own diary, `log/06-f32-backend-agent-diary.md`, with a step at every significant action.

## 5. caddr-aware bounds-check elimination (P4.7)

On the tape, a checked text address is one value, `caddr(r, p)`. It traps unless `p <u load32[r]`, and otherwise yields `r + (p << 1)`. Candela has 559 of them. `bce` recognizes only the Wasm-level pattern (a branch to a trap block), so it removes none.

The new rule: if a branch condition `p <u load32[r]` (or `p < load32[r]` with `p ≥ 0` from ranges) dominates the `caddr`, then replace it by the unchecked `add(r, shl(p, 1))`. This needs the same receiver and position, and no write to `p`'s local, or a store that may alias `r`'s capacity word, between the two. The unchecked form is pure, so `licm`, `lvn` and `subst` can then work on it. That is a second-order gain, because `caddr` is impure and blocks all three today.

The proof sources, in order of strength:
1. A dominating test in the program itself. This is the existing `bce` argument.
2. Ranges: `p ∈ [0, c)` together with a capacity known to be at least `c`. That needs a fact about the buffer's capacity.
3. Candela row-layout facts, through `typed.bindings`. This is the outer-fact path of design-doc 03.

The first is implemented now, the others when measured counts justify them. The meaning contract checks every application: a wrong removal turns a trap into a value, and the check catches it.

Acceptance:
- the number of `caddr` removed in Candela;
- no corpus change;
- a test with a removable and an unremovable check.

## 6. Candela oracle against the `kernel` policy (P4.8)

The reference pass groups (inline, loops, kernel) are vendored now. `tools/candela-oracle.mjs` gains a `--policy` option, and the oracle runs with `kernel`, the policy the device uses, on 100 cases per function. Acceptance: zero disagreements, or a documented explanation of each.

## 7. Per-scene Candela kernels (P4.3)

### 7.1 What the program does

The gallery compiles 18 scenes into one module. 177 of its 332 functions are scene sections, named `s<k>_…`. Five dispatchers read `q_k.scene` from the kernel record `K` and binary-search to the scene's section:

```
function evalMaterial(q_k: K, …): Lobe {
    const q_s: i32 = q_k.scene;
    if (q_s < 9) { if (q_s < 4) { if (q_s < 2) { if (q_s < 1) { return s0_evalMaterial(…); } …
```

No statement writes `K.scene`. A device rendering scene 3 executes the code of only one scene, but carries all 18.

### 7.2 Design

1. **Field bindings.** `typed.bindings` gains a field form: `{ param: 'q_k', type: 'K', field: 'scene', value: 3, entity: 'scene/G-01' }`. It applies to every function with a parameter of type `K`. The `specialize` pass replaces `load32[q_k + offset(scene)]`, where `q_k` is that parameter, by the constant. The edit's `because` is the fact reference, as for parameters.
2. **Assumptions over fields.** The program's assumptions gain `{ K: { scene: 3 } }`. Case generation sets the field in every constructed `K` (`candelaInputs`), so the restricted contract compares with r0 only on scene-3 inputs.
3. **Dead-function elimination**, a new pass `dfe`. It removes functions that no call from the program's entry points reaches.
   - The entry points come from the project (for Candela, the functions `link.js` binds), so the pass needs them as a parameter or a project fact.
   - The meaning contract compares only functions present in both programs. A removed function is checked indirectly, by every remaining function that could have called it.
4. **The pipeline:** `specialize`, then O2, then `dfe`, then `O2+`.

### 7.3 Measurements

For each of the 18 scenes, and for the general kernel:
- functions, statements, image bytes;
- instructions per pixel on a fixed set of pixels, from the f32 backend;
- the same for the reference compiler's `kernel` policy.

The guarded variant of design-doc 04 (clone per scene, dispatch once) follows if the per-scene numbers justify it.

## 8. Order of work

```
4c1o O2+ ──────────────────────────────┐
9rcu framework performance ───┐        │
t4dq caddr bce ───────────────┼──► ckco per-scene kernels ──► R3 report
owi2 f32 backend (subagent) ──┘        │
gxe6 kernel-policy oracle ─────────────┘
```

O2+ and the oracle are small. Framework performance comes first among the large items, because every Candela experiment after it costs a tenth as much. The backend runs in parallel in its own worktree. The diary gets a step at every significant action, and R3 is written when the per-scene numbers exist.
