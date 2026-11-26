---
Title: 'Intern guide: a function-incremental framework for the IR Workbench'
Ticket: IRWB-009
Status: active
Topics:
    - compiler
    - ir
    - performance
    - workbench
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/core/runtime.ts
      Note: the task runtime with early cutoff that the query engine builds on
    - Path: repo://src/framework/dataflow/analysis.ts
      Note: solveArtifact solves and freezes every region; solveRegion is the proposed per-part entry
    - Path: repo://src/framework/ir/adapters.ts
      Note: createIRArtifact and its eager projection (lazy and per part in the design)
    - Path: repo://src/framework/passes/define-pass.ts
      Note: applyPass; diff and makeCorrespondence are the whole-program work of a small pass
    - Path: repo://src/typed/parts.ts
      Note: function parts, part hashes and closure keys; code hashes are proposed here
    - Path: repo://src/typed/passes.ts
      Note: typedPass runs every function and builds every fact view eagerly
ExternalSources: []
Summary: 'What a pass, an analysis and the browser do on the IR Workbench today and what each costs on the 332-function Candela program (measured), then the design of a function-incremental framework: analyses per function part with demand-driven facts, validation per part, a lazy per-part projection, diff and correspondence, adoption on the page in slices, a persistent content-addressed store with a trust model, and a query engine with early cutoff on the existing task runtime; every revision hash unchanged; a phased plan with acceptance measurements and "cost per edit independent of program size" as a measured invariant.'
LastUpdated: 2026-11-26T10:30:00-05:00
WhatFor: Onboarding an intern to the framework's incremental machinery and implementing IRWB-009.
WhenToUse: Before changing createIRArtifact, applyPass, the analysis manager, the dataflow layer, the task runtime, or the workbench's engine worker.
---

# Intern guide: a function-incremental framework for the IR Workbench

This guide has two jobs. The first is to explain the parts of the IR Workbench that decide what an edit costs: how a program revision gets its identity, how a pass is applied and checked, how analyses are computed and cached, how the meaning check reuses work, what the browser does on its main thread, and what the framework's unused task runtime already provides. The second is to lay out a design in which the cost of an edit follows what the edit changed, and the program's size enters only through one small, unavoidable term. The design keeps every revision hash bit-for-bit identical.

The guide is self-contained for this topic. The broader account of the compiler (its passes, backend, strategies and provenance) is the IRWB-002 guide, `ttmp/2026/11/24/IRWB-002--research-agenda-*/design-doc/01-*.md`, and the account of the previous performance milestone is the IRWB-004 guide, `ttmp/2026/11/25/IRWB-004--*/design-doc/01-*.md`. Where this guide summarizes something explained there, it says so.

Four conventions hold throughout.

- **Paths are relative to the repository root.** A number after a colon is a line number at commit `a4beda6`. Line numbers drift; the symbol next to them does not.
- **Numbers are measurements with a source.** "(01)" to "(06)" refer to this ticket's measurement files `various/01-*.json` … `various/06-*.json`, produced by the scripts of the same number in `scripts/`; the diary (`log/01-irwb-009-diary.md`) records each run. "IRWB-004 `various/NN`" and "IRWB-004 step N" refer to that ticket's files and diary. All Candela runs here were made on a shared machine at load averages between 4.8 and 8.9, so absolute times vary by up to 2× between runs (IRWB-004 step 12 measured the same); comparisons are made within one run.
- **Part 1 describes code that exists. Part 2 describes code that does not**, and every new interface in it is marked **Proposed**.
- **"Candela"** is the 332-function path tracer the compiler is measured on; "the corpus" is the 44 small projects whose numbers come from a book and are regression tests (§1).

# Part 1: The system as it is

## 1. What the system is, and the problem in one table

The project is a compiler from **Typed**, a small statically typed language with TypeScript-like syntax, to **RV32** machine code. It is built on a framework, **IR Workbench v6**, that treats each step of compilation as inspectable data:

- each version of the program is an immutable **artifact** whose name, its **revision**, is the SHA-256 hash of its content;
- each optimization is a **pass** that declares what it reads and writes, and the framework checks the declaration every time the pass runs;
- each fact about a program (the interval a variable lies in, which assignments reach a read) is an **analysis** result cached for one exact revision;
- each pass application is accepted only if the new program still **means** what the original meant, judged by running both on generated inputs.

Two workloads exercise it. The **corpus** is 44 projects with 70 functions, inherited from a JavaScript prototype together with a book whose exact numbers are tests. **Candela** is a path-tracing renderer: 332 functions, 2,409 blocks, 12,358 statements and 37,220 values at r0 (IRWB-002 guide §16). Every operation that touches the whole program is invisible on the corpus and takes seconds on Candela.

Two terms recur. **O2** is the standard pipeline of sixteen pass applications (`cfg, fold, simplify, constprop, fold, simplify, dce, cfg, licm, lvn, strength, bce, subst, subst, dce, cfg`; IRWB-002 guide §9.4). **r0, r1, …, r13** number the revisions of one program: r0 is the program as lifted from source, and each pass application that changes the program adds one, so O2 on Candela ends at r13 (three of its sixteen applications change nothing).

Milestone IRWB-004 made the main path much cheaper without changing a hash: a record a pass did not change stays the same frozen object in the next revision, function **parts** group a function's records, and the meaning check replays verdicts for functions whose code it already checked. O2 on Candela went from 12 min 6 s to 3 min 27 s (IRWB-004 step 10). What is still whole-program shows in four measurements, from that milestone's final runs and this ticket's:

| what | time on Candela | where it goes | source |
|---|---:|---|---|
| a pass that changes nothing (`strength`), first time | 4,295 ms | the `ranges` analysis solved from scratch 2,362 ms, of which freezing its result 1,510 ms; the rest is `typedPass.run` and the edit's maps (655 ms in all on a second run, with `ranges` solved) | IRWB-004 `various/23` |
| a pass that changes 2 of 332 functions (`cfg`, r12 → r13), no meaning check | 6,256 ms and 8,362 ms in two runs | mostly `makeCorrespondence` (93,138 entries; 11.1 s when timed alone); `createIRArtifact` 1.8 s; `pass.run` 0.8 s | (03), (05) |
| opening Candela in the browser | 8,608 ms, one task | `createIRArtifact` 5.5 s, of which the eager projection 3.0 s | IRWB-004 `various/20` |
| `cfg` in the browser | 21,319 ms, one task | the pass, the artifact, the check, all on the main thread | IRWB-004 `various/20` |

The common shape is that each step computes something about the whole program even when the edit is small. The second row is the clearest: that pass rewrote 4 of 82,660 records (03) and still cost six seconds before any meaning check.

**The goal of IRWB-009** is a framework in which the cost of an edit is proportional to the parts it changes. The direction approved for it has four pieces: analyses keyed by function part; a lazy projection; a persistent content-addressed store, so that results survive across sessions and can be shared between agents and the browser; and demand-driven compilation on the framework's task runtime, with early cutoff on content hashes. The hard requirement is that every revision hash stays identical. The research framing is to make "cost per edit independent of program size" a *measured invariant*, on realistic edit streams.

Part 1 explains the machinery in the order the code runs (§2–§9) and ends with a table of what each step is proportional to (§10). Part 2 is the design (§11–§19; §11.4 is its map), the risks and what would falsify the approach (§20), the phased plan with acceptance measurements (§21), the API (§22), related work (§23) and open questions (§24).

## 2. Artifacts, canonical text and revisions

### 2.1 The artifact record

Everything the compiler produces is an artifact (`src/framework/core/types.ts:10`):

```ts
export interface Artifact<T = unknown> {
  readonly id: string;            // a logical name, e.g. 'candela'
  readonly revision: string;      // SHA-256 of canonical({ kind, schemaVersion, value })
  readonly contentHash: string;   // SHA-256 of canonical(value)
  readonly kind: string;          // which IR, e.g. 'typed.blocks'
  readonly schemaVersion: string;
  readonly value: T;              // finite, acyclic, deep-frozen JSON
}
```

The value must be finite JSON: plain records, arrays, strings, booleans, `null` and finite numbers. Two artifacts with equal content have equal revisions, whoever made them and whenever. A revision is therefore a name for the program itself, and anything computed from an artifact can be stored under its revision forever without invalidation. That property is what every cache in this guide, and the persistent store in particular, relies on.

### 2.2 The functions that implement identity

They are in `src/framework/core/data.ts`:

| function | line | what it does |
|---|---:|---|
| `canonical(value)` | 67 | the one text encoding of a value: keys sorted, `-0` written as `0`, non-finite numbers, cycles, accessors and non-plain objects refused |
| `immutable(value)` | 133 | a deep-frozen canonical copy; returns a value it built itself unchanged, and shares the canonical parts of a new value |
| `fingerprint(value)` | 195 | `sha256(canonical(value))`, cached per canonical object (`HASH`, `:194`) |
| `revisionOf(kind, schemaVersion, value)` | 210 | `fingerprint({ kind, schemaVersion, value })` hashed from three pieces, cached per canonical value (`REVISION`, `:204`) |
| `validateOnce(validator, value)` | 235 | runs a validator once per canonical value it accepted (`VALIDATED`, `:228`) |
| `isCanonical(value)` | 253 | whether `immutable` built this object (membership in `CANONICAL`, `:9`) |

A small example makes the definition concrete. For the value `{ b: 1, a: [2, -0] }`, `canonical` gives the text `{"a":[2,0],"b":1}`. An artifact of kind `typed.blocks`, schema `1`, with that value has the revision `sha256('{"kind":"typed.blocks","schemaVersion":"1","value":{"a":[2,0],"b":1}}')`. Nothing else enters the hash: not the artifact's id, not how the value was built, not its history.

### 2.3 The caches, and the rule that makes them safe

IRWB-001 step 12 and IRWB-004 added caches keyed on objects that cannot change:

| cache | where | key | value |
|---|---|---|---|
| `CANONICAL` | `data.ts:9` | an object `immutable` built | membership |
| `TEXT` | `data.ts:15` | a canonical object of at least 64 characters (`RECORD_MIN`, `:16`) | its canonical text |
| `HASH`, `REVISION` | `data.ts:194`, `:204` | a canonical object | its fingerprint; its revision per kind and schema |
| `VALIDATED` | `data.ts:228` | (validator, canonical value) | accepted |
| `VERIFIED`, `PROJECTED` | `src/framework/ir/adapters.ts:122`, `:127` | an artifact; (adapter, canonical value) | hashes checked; the projection (§4) |
| `RECORD_ENTITIES`, `RECORD_RELATIONS` | `src/typed/ir.ts:329–330` | a frozen record | its entities and relations |
| parts, part texts, part hashes, closure keys | `src/typed/parts.ts:32–34`, `:90`, `:113`, `:236` | a frozen value, a part object | §3.3 |

**The rule: a cache is keyed only on values that cannot change.** A deep-frozen canonical object cannot change, so its text, hash and validity are fixed; a captured adapter is frozen; a revision names exactly one value. Such a cache can make a computation faster but cannot make it return something different. Every key proposed in Part 2 obeys the same rule; the persistent store extends it with one more ingredient, the code that computed a result (§17.4).

### 2.4 Why the revision costs time proportional to the program

The revision is the SHA-256 of one specific string, the canonical text of the whole value. For Candela r0 that string has 18,178,949 characters (IRWB-004 step 3). Its keys are sorted, so the `counters` table comes near the start (at 3.6%) and every pass changes `rev` and usually `counters`; the text of a new revision therefore differs from its input's within the first 4%, and SHA-256, which processes its input from first byte to last, must process nearly all of it again (IRWB-004 guide §2.4). With identical hashes required, **computing a new revision is unavoidably proportional to the size of the program's text**.

What can be made small is the constant. Assembling the text from cached record texts and hashing it with `node:crypto` costs 288 ms for a value whose records are all cached (02, `warm.contentHash`), of which the hash itself is 24–54 ms for 18 MB (IRWB-004 `various/05`, `various/22`). The portable streaming SHA-256, which the browser uses, hashes 16.3 MB in 358 ms in Node (05). Part 2 calls this the **identity term** and treats it separately from all other work (§11).

## 3. The native value, the Store and function parts

### 3.1 `TypedBlocks`

The native value of one revision is `TypedBlocks` (`src/typed/model.ts:199`): id-keyed tables `fns`, `blocks`, `stmts`, `values` and `ops`, plus `counters`, `fnOrder`, `frontEnd`, `program` and `rev`. Three facts about it matter here.

- **Ids carry the function name.** A block is `bb:tracePath.12`, a statement `s:tracePath.40`, a value `v:tracePath.301`, a front-end operation `op:tracePath#35`, and every record has a `fn` field. Ids are allocated per function from `counters` entries such as `v:tracePath` (`store.fresh`, `model.ts:284`; `lift.ts:476`), so ingesting the program again after an edit to one function gives every other function the same ids.
- **The tables are program-wide.** There is one `stmts` table with the statements of all 332 functions, sorted by id in the canonical text.
- **Front-end operations carry absolute source positions.** Each `op` record has `at: { line, col, start, end }` (`lift.ts:183`), and each local in a function record has an `at` too. All 40,916 of Candela's operations have one (04). An edit that moves text moves the positions of every later function (§3.4).

### 3.2 `Store`: the working copy, and records that keep their identity

Passes never edit a frozen value. `Store.from(native)` (`model.ts:306`) copies every record into a mutable map, and `store.toNative()` (`model.ts:375`) writes the current state back. Since IRWB-004, `toNative` gives back the base value's frozen record wherever the working record still equals it (`keep`, `model.ts:379`), so a pass's output shares every record it did not change. Across O2 on Candela the number of records that are *not* the previous revision's objects ranges from 2 to 4,199 per changing pass, out of 82,660 to 92,353 (03). The copy at the start is still whole-program: `Store.from` alone takes 207 ms on Candela (05).

`storeOf(v)` (`src/typed/ir.ts:525`) is a read-only store over a frozen value (`Store.view`, `model.ts:329`), cached per value, used by the evaluator, printing and the analyses.

### 3.3 Function parts and closure keys

A **function part** (`src/typed/parts.ts:23`) is a derived, frozen grouping of one function's records in one revision:

```ts
interface FunctionPart {
  readonly name: string;
  readonly fn: FnRec & { readonly blocks: readonly string[] };
  readonly blocks: readonly BlockRec[];   // each list in id order
  readonly stmts: readonly StmtRec[];
  readonly values: readonly ValueRec[];
  readonly ops: readonly OpRec[];
}
```

Parts are not part of the canonical value and change no hash. The API:

| function | line | what it does |
|---|---:|---|
| `partsOf(v)` | 43 | the parts of a value, by function name in `fnOrder`; returns the *previous* part object for a function whose records are all the same objects (identity stability) |
| `partText(p)`, `partHash(p)` | 92, 115 | `[fn,[blocks],[stmts],[values],[ops]]` as canonical text from the records' cached texts; its SHA-256, once per part object |
| `calleesOf(p)` | 123 | the functions its `call` values name |
| `closureOf(v, f)` | 139 | the functions reachable from `f` by calls, `f` included |
| `closureKey(v, f)` | 241 | SHA-256 of the sorted lines `name:partHash` over `closureOf(v, f)`, plus whether any function has frame arrays |
| `partsRef`, `parsePart`, `assembleParts`, `missingParts` | 169, 189, 193, 224 | a program named by its part hashes, and its reconstruction from parts (used by the worker pools and the engine worker) |

What identity stability buys is easiest to see on one pass. `cfg` applied to Candela r0 changes 110 functions; of r1's 332 parts, 222 are the very objects of r0's parts (01). Everything keyed on a part object (its text, its hash, and in Part 2 its facts and its validation) is reused for those 222.

The **closure key** names everything an evaluation of a case of `f` can depend on: the code of every function reachable from `f`, and the frame-array flag (the evaluator adds a 64 KiB stack area to guest memory when any function has frame arrays, `STACK_BYTES`, `src/typed/evaluate.ts:332`). IRWB-004 step 8 derived this from what `evaluate` reads.

### 3.4 What a source edit does to parts

The workbench's other kind of edit, besides applying a pass, is a person changing source text. `04-source-edits.mjs` made five edits to Candela's source in memory, ingested the whole program again as the workbench does, and compared parts with r0's (04):

| edit | parts changed | closure keys changed | parts changed, ignoring `ops` and positions |
|---|---:|---:|---:|
| a constant in the scene material `s3_mat_0` (`0.08` → `0.09`) | 1 | 11 | 1 |
| a constant in `fresnelDielectric` (78 transitive callers) | 1 | 79 | 1 |
| a constant in `tracePath` (the largest function) | 1 | 3 | 1 |
| a blank line after `s3_mat_0`'s header | 154 | 173 | 0 |
| a comment at the end of that header | 154 | 173 | 0 |

A same-length edit changes exactly one part. An edit that moves text changes every later function's part, because their operations' positions move, although their code does not change at all. Each edit also re-ran the whole front end and lifter: 1.8–4.2 s per edit (04). The last column is the "code hash" of §12.1.

## 4. Adapters and the projection

### 4.1 What a projection is

The passes are written against plain tables, but the framework's generic machinery (diffing two revisions, checking which kinds of thing a pass changed, building correspondences) must work for any IR. An **adapter** (`IRAdapter`, `src/framework/ir/types.ts:64`) connects the two: it projects a native value into a graph of **entities** `{ id, kind, attributes }` and **relations** `{ id, kind, category, from, to, order? }`.

The adapter for the main IR is `blocksAdapter` (`src/typed/ir.ts:546`). Its projection of Candela r0 has 103,618 entities (functions, locals, blocks, statements, values, operations) and 132,054 relations (02). Its relation kinds are `declares`, `contains`, `emits` (containment), `uses`, `operand`, `reads` (dependency), `writes` (binding), `succ`, `jump` (control). **Every relation connects two entities of the same function.** A call is a value whose `imm` names the callee; it is not a relation. The projection of a `typed.blocks` value is therefore a disjoint union of one graph per function, which is the fact §15 builds on.

### 4.2 `project` and `createIRArtifact`

`project(adapter, value)` (`adapters.ts:235`) enumerates entities and relations, then `validateGraph` (`adapters.ts:180`) checks shapes, duplicate ids, dangling ends and roots and returns both lists sorted (`:222–223`), and finally every entity is resolved again through `adapter.resolve` and compared with its enumeration (`:262–266`). The result is cached in `PROJECTED` for a canonical value.

`createIRArtifact(adapter, id, value)` (`adapters.ts:128`) does five things in order:

```ts
const snapshot = immutable(value);                                   // :131  freeze (shares canonical parts)
validateOnce(adapter.validate, snapshot, ...);                       // :133  validateBlocks for typed.blocks
const artifact = immutable({ id, kind, schemaVersion, value: snapshot,
  contentHash: fingerprint(snapshot),                                // :139  the value's text, hashed
  revision: revisionOf(adapter.kind, adapter.schemaVersion, snapshot) }); // :140  reuses that text
project(adapter, artifact.value);                                    // :142  eager projection
VERIFIED.add(artifact);
```

The projection is a cache, not part of the artifact: no hash covers it. Building it eagerly at line 142 is a check that the adapter is consistent with the value, done at creation time.

### 4.3 What it costs, piece by piece

`02-projection-pieces.mjs` timed each piece on a Candela value whose records are all new (r0 as lifted) and on a value that shares every record with r0 but is a new object, which is what IRWB-004's sharing leaves for the unchanged functions after a pass (02, Node, ms):

| piece | cold | warm |
|---|---:|---:|
| `immutable` | 1,306.8 | 0.1 |
| content hash (text and SHA-256) | 878.1 | 287.5 |
| revision hash (text already built) | 26.5 | 31.6 |
| `validateBlocks` | 240.9 | 124.2 |
| entities (`blocksEntities`) | 826.4 | 80.8 |
| relations (`blocksRelations`) | 1,220.4 | 100.4 |
| `validateGraph`, including both sorts | 607.5 | 325.3 |
| of which sorting the 132,054 relations, alone | 29.9 | 23.6 |
| resolve check | 222.7 | 216.8 |
| **`createIRArtifact`, whole** | **6,388.6** | **1,045.8** |

Two readings matter. Cold, the projection (entities, relations, `validateGraph`, resolve check) is 2.9 s of 6.4 s; in Chromium, IRWB-004 measured it at 3.0 s of an 8.6 s open (IRWB-004 `various/20`). Warm, the per-record caches remove the building, and what remains (about 1 s) is checks and assembly over all 235,672 elements, each cheap, repeated for every new revision. Sorting is not the cost: 24–30 ms for all relations.

### 4.4 Who reads the projection

- `openIR(artifact, adapter, store)` (`src/framework/ir/view.ts:331`) builds an `IRView` with a map from entity id to entity (`view.ts:197`).
- `diff(before, after)` (`src/framework/ir/diff.ts:91`) compares two projections id by id.
- `applyPass` takes the entity id lists for `makeCorrespondence` (§5).
- `view.beginEdit()` builds two maps over the whole graph (`src/framework/ir/transactions.ts:53–54`) for a logical edit no Typed pass uses; IRWB-004's profile of two no-change `strength` runs on Candela shows 211 ms in it (IRWB-004 `various/23`).
- The dataflow transfer verifier diffs the two revisions' projections to decide a preservation claim (`src/framework/dataflow/analysis.ts:164`).
- The workbench's IR, CFG and Lineage views navigate views.

## 5. `applyPass` and its gates

`applyPass(pass, before, options)` (`src/framework/passes/define-pass.ts:190`) is where the framework enforces a pass's declarations. Nothing is published unless every gate passes. The code's order, with what each step is proportional to:

```text
applyPass(pass, before, { manager, contract, contractInputs: { origin: r0 } })
  view  <- openIR(before)                                         :196   program (entity map)
  facts <- for each need: manager.analyse(need, before)           :199   program, unless cached
  edit  <- view.beginEdit()                                       :204   program (two maps)
  result <- pass.run({ before, view, facts, params, edit })       :207   typedPass: program (§5.1)
  if result is a native value:                                    :221
     after   <- createIRArtifact(adapter, id, result.native)      :224   program (§4.3)
     changes <- diff(view, openIR(after))                         :226   program
     corr    <- makeCorrespondence(before ids, after ids, explicit) :227 program (one entry per entity)
  else if the edit recorded no operation: return unchanged        :239   (IRWB-004 A1)
  if nothing changed: return { changed: false }                   :259
  if changes touch kinds outside pass.writes: undeclaredWrite     :269   change
  if contract: manager.verifyTransformation(...)                  :279   the meaning check (§7)
  for each analysis A in pass.preserves held for `before`:        :297
     transfer verifier (diff again) or recompute A and compare            program
  return { changed: true, artifact: after, changes, correspondence: corr, ... }
```

### 5.1 `typedPass`: the per-function loop

The Typed passes are declared with `typedPass(spec)` (`src/typed/passes.ts:166`), whose `run` (`:184–215`) does:

```ts
const st = Store.from(before.value), rev = before.value.rev + 1;
for (const f of st.fns.values()) {                      // every function, always
  const views = {};                                     // a fact view per need, per function, built eagerly
  for (const [alias, name] of Object.entries(spec.needs ?? {})) views[alias] = view(name, facts[alias], st, f.name);
  const tx = new Tx(st, f, { name: spec.name, writes: spec.writes }, rev);
  spec.body({ st, f, tx, facts: views, params });
  tx.commit();
  if (tx.edits.length) { edits.push(...tx.edits); touched.push(f.name); }
}
if (!edits.length) return;                              // no native result: applyPass returns unchanged
st.rev = rev;
const native = st.toNative();
return { native, correspondence: revisionCorrespondence(before.value, native, edits), edits: edits.length, report };
```

Three details matter for incrementality. The body runs for every function and receives the whole-program store `st`, so it *can* read any other function's records; nothing records whether it does. The fact views are built for every function before the body asks for them. And the origin records a pass writes carry `rev` (the revision number being made), so the same edit to the same function at a different position in a pipeline produces different records.

### 5.2 A pass that changes 2 functions, taken apart

`05-small-pass-and-slices.mjs` replayed O2 on Candela to r12 and took the last `cfg` apart. It changed 2 functions (`hitMesh`, `traceAll`), 12 entities and 36 relations (05, ms):

| piece | time |
|---|---:|
| the `cfg` analysis on r12 | 22.7 |
| `pass.run` (of which `Store.from` alone 207.1) | 831.6 |
| `createIRArtifact` | 1,791.8 |
| both views | 65.3 |
| `diff` | 366.0 |
| **`makeCorrespondence`, 93,138 entries** | **11,052.2** |
| undeclared-write check | 0 |
| the whole `applyPass`, run again | 8,361.8 |

The correspondence is the largest piece. It has one entry per entity of either revision (`retained`, `removed` or `inserted`, `src/framework/ir/correspondence.ts:102`), and `validateCorrespondence` (`:49`) encodes each entry as canonical text to deduplicate and sort it. For this pass, all but a handful of the 93,138 entries say "retained". In the 110-function pass of §3.3 it took 5.2 s for 103,618 entries, of which 882 were not "retained" (02).

## 6. Analyses and the analysis manager

### 6.1 Definitions and the manager

An **analysis** is a versioned function from an artifact to a JSON value: `defineAnalysis` (`src/framework/contracts/definitions.ts:94`), with the interface `AnalysisDefinition` (`src/framework/contracts/types.ts:63`). `AnalysisManager.analyse(definition, subject, params)` (`src/framework/contracts/analysis-manager.ts:518`) computes it or returns the cached record:

```text
analyseInternal(def, subject, params)                          analysis-manager.ts:525
  subject <- snapshotArtifact(subject)                         validate and hash-check the artifact (cached)
  key     <- fingerprint({ analysis, input, output, subject revision, params })    :237
  if a valid record exists for key and its dependencies are valid:  return it
  value   <- immutable(await def.run(ctx, subject, params))    :573   ctx.analysis(...) records dependencies
  def.output.validate(value)
  record  <- immutable({ id: 'analysis-' + fingerprint({ key, value, epoch, deps, ... }), key, value, ... })  :579
  store.analyses.set(key, record)                              in memory, for the manager's lifetime
```

Three properties matter. The key names the whole subject revision, so a new revision is a miss for every analysis, even for functions it did not change. The record's id is a fingerprint over the value, which hashes the whole result again. And the manager already tracks dependencies between analyses (`ctx.analysis` inside `run` records one), which is a small query engine of its own.

### 6.2 The six analyses and the dataflow layer

The Typed compiler has six analyses (`ANALYSES`, `src/typed/analyses.ts:539`): `cfg`, `dominators`, `loops`, `liveness`, `reaching`, `ranges`. The first three are plain definitions computed per function (`perFunction`, `:120`). The last three are **dataflow** analyses built with `dataflow(spec)` (`src/framework/dataflow/analysis.ts:110`), whose spec names a lattice, a direction, a transfer function and the **regions** of a revision. For `typed.blocks` a region is one function (`regions`, `analyses.ts:257`). `solveArtifact` (`dataflow/analysis.ts:122`) opens a view, solves each region with `solve`, encodes each block's in and out facts, and freezes the whole result:

```ts
const view = openIR(subject, spec.adapter);                    // :123
for (const region of spec.regions(view, params)) {
  const solution = solve(region.graph, { direction, lattice, boundary, transfer, widen, widenAfter, edge, strategy });
  regions[region.id] = { in: enc(solution.in), out: enc(solution.out), iterations, rounds, loopHeads };
}
return immutable({ analysis: spec.id, direction: spec.direction, regions });   // :151
```

The result is a `DataflowResult` (`:56`): per function, the encoded facts at the entry and exit of every block. Passes read it through views that replay a block's transfer to give a fact per statement: `liveView`, `reachView`, `rangeView` (`analyses.ts:305`, `:360`, `:511`).

**Every one of the six is intraprocedural.** The range of a call's result is the full interval (`evalRange`, `analyses.ts:382`, has no `call` case), and `reaching` and `liveness` stop at the function boundary. IRWB-002's item C3 (function summaries) does not exist yet.

### 6.3 How the analyses split by function

`01-analyses-per-function.mjs` solved three dataflow analyses on Candela r0 region by region (01):

| analysis | all regions | median region | largest region | freeze the result | result text | `manager.analyse`, cold |
|---|---:|---:|---|---:|---:|---:|
| `ranges` | 1,055.6 ms | 0.16 ms | `tracePath` 700.8 ms | 1,213.6 ms | 11.8 M chars, `tracePath` 6.5 M | 2,879.6 ms |
| `reaching` | 971.3 ms | 0.12 ms | `tracePath` 520.1 ms | 265.9 ms | 10.7 M chars, `tracePath` 6.9 M | 1,498.0 ms |
| `liveness` | 63.1 ms | 0.07 ms | `tracePath` 13.7 ms | 39.6 ms | 0.3 M chars | 129.8 ms |

Three facts follow.

- **The work per function is very uneven.** `tracePath` has 252 of the 2,409 blocks and accounts for two thirds of the `ranges` solve and more than half of its result; the median function solves in a sixth of a millisecond. An edit to `tracePath` costs most of a whole-program solve; an edit to a typical function costs almost nothing.
- **The result format is dense.** `ranges` stores an interval for every local at the entry and exit of every block, which is why `tracePath`'s facts are 6.5 MB. Freezing the result (1.2 s) and fingerprinting it for the record id cost more than solving.
- **Results are exactly per function.** After `cfg` (110 functions changed), all three analyses give canonically equal results for 222 of 222 unchanged parts and different results for 110 of 110 changed ones (01, `independence`).

### 6.4 What crosses a function boundary

The call graph of Candela r0 (01): 332 functions, 918 call values, 668 distinct call edges, 122 leaves, 21 functions nothing calls, and **no recursion**. A function's call closure has a median of 3 functions (90th percentile 13, largest 310 for `cdlRenderSpan`). Its transitive callers number a median of 10 (90th percentile 16, largest 104 for `q_floor`; then `lobeNone` 93, `fresnelDielectric` 78). The analyses do not use this graph. The meaning check does, through closure keys: when `f` changes, the closure keys of `f` and all its transitive callers change. Across O2 a pass that changes 2 parts changes 12 or 15 closure keys, and one that changes 110 changes 204 (03).

### 6.5 Demand: how much of a fact a pass reads

`strength` replaces `x / 2^k` by a shift when `ranges` proves `x ≥ 0`, and it reads `ranges.of(...)` only for a `div` or `rem` whose divisor is a constant power of two (`passes.ts:563`). Candela has 6 divisions or remainders, and exactly one function, `finishHit`, has candidates (06). Solving and freezing `ranges` for that function takes 76.4 ms; for all 332, 3,292.0 ms. Building its range view takes 15.4 ms; all views, 264.2 ms (06). Today `applyPass` solves the whole analysis before the pass runs (`define-pass.ts:199`) and `typedPass.run` builds every function's view (`passes.ts:191–192`).

## 7. The meaning check, the memo and the worker pools

### 7.1 The contract

Every pass application in a pipeline runs under `optimizationContract(params)` (`passes.ts:222`), whose one condition is the invariant `typed.meaning-kept` from `meaningKept(params)` (`src/typed/evaluate.ts:587`). It is a **differential** check built with `differential(spec)` (`src/framework/contracts/differential.ts:98`): generate cases from the origin, run the origin (the **baseline**, always r0) and the candidate (the **subject**) on each, and compare. Cases are generated per function with the same seed for each function (`casesFrom`, `evaluate.ts:232`), so a function's cases depend on its signature, its inputs specification and the front end's tables, not on other functions. For Candela this is 40 cases × 332 functions = 13,280 cases.

### 7.2 What IRWB-004 made reusable

`DifferentialSpec` has three optional fields (`differential.ts:57–73`):

- `baselineKey(inputs)`: for `typed.meaning-kept`, `kind@schema:revision` of the origin (`evaluate.ts:627`). Under this key `runDifferential` keeps the cases and the origin's outcome for each (`REUSE`, `:150`, at most 4 keys, `REUSE_MAX`, `:151`).
- `subjectKey(candidate, case)`: the closure key of the case's function in the candidate (`evaluate.ts:628`). A decided verdict is kept under `(baseline key, case index, subject key)` and replayed instead of evaluated.
- `decide(inputs, cases, todo)`: hands undecided cases to an executor, such as the worker-thread pool `startMeaningPool` (`src/typed/parallel/node-pool.ts:73`), which mirrors programs to workers by part hash so that after the first check only changed parts cross (IRWB-004 guide §16.2).

Within one O2 run on Candela, 108,600 of 172,640 decided cases (63%) were replayed (IRWB-004 step 10). The evidence of every check is identical with and without reuse, because verdicts are tallied in case order (`tally`, `differential.ts:216`).

### 7.3 What it does not survive

The memo is process-local, and its baseline key is the **whole origin revision**. A source edit makes a new r0, so after any edit to the source, even of one constant, all 13,280 baseline outcomes are recomputed, although 331 functions' code did not change (§3.4). A whitespace edit additionally changes 173 closure keys (04), so those functions' verdicts are re-decided too.

## 8. The browser workbench and the engine worker

The browser workbench (`site-src/`, bundled by `tools/build-site.mjs`) keeps the `wb` object and every open project's `Program` on the page's main thread. Since IRWB-004, the Candela view's engines run in a dedicated Web Worker, `site-src/engine-worker.js`: it receives the Candela data from the page (`init`), lifts r0 (`lift`, `:114`), renders scenes (`render`), and rebuilds a revision the page names by a `PartsRef` from part texts, refusing it if the rebuilt revision differs (`artifactOf`, `:44–54`). The page has a strict content security policy: `script-src 'self' 'unsafe-eval'; worker-src 'self'; connect-src 'none'` (`site-src/index.html:6`, sent as a header by `tools/serve-site.mjs:23`). Nothing can be fetched; data arrives as same-origin scripts with integrity hashes.

Opening Candela as a project and applying a pass still run on the main thread (IRWB-004 task `i5cw` is open). Profiled in Chromium (IRWB-004 `various/20`): open 8,608 ms as one task (`createIRArtifact` 5,521 ms, of which hashing 1.1 s, `fingerprint` 1.1 s, `canonical` 0.5 s; the eager projection 3,009 ms, of which per-record entities and relations 1,503 ms and `validateGraph` 829 ms; `immutable` 2,214 ms; garbage collection 1,888 ms), and `cfg` 21,319 ms as one task.

What a page would do to adopt a revision in small pieces was measured in Node for the O2 head (05): its 332 part texts total 14.8 M characters; parsing and freezing one part takes a median of 1.4 ms and at most 82.6 ms (`tracePath`, 946,233 characters; then `cdlInit` 59.0 ms); assembling the value from parts 173.4 ms; `validateBlocks` 111.2 ms; encoding the revision text of freshly parsed records 1,253.2 ms; the portable SHA-256 of that text 358.2 ms in 1 MiB slices, the slowest slice 62.1 ms; and the digest equals the revision.

## 9. The task runtime and `IRStore`, which the compiler does not use

### 9.1 The task runtime

The framework's core has a demand-driven build engine that only the framework's own examples use (`grep` finds `new Compiler(` only in `src/framework/core/runtime.ts`, `src/conformance/01-runtime.ts`, `src/labs/lab.ts` and four framework tests). Its vocabulary (`src/framework/core/types.ts`):

```ts
interface Task<P> { id: string; pass: string; params: P }              // :4   a logical name, an algorithm, parameters
interface Pass<P, T> { id; version; kind; description; role?; cache?;
                       run(ctx: PassContext, params: P): T | Promise<T> }   // :80
interface PassContext {                                                // :67
  read<T>(key: string): T;                   // an input of the run, recorded with its fingerprint
  require<T>(task: Task): Promise<Artifact<T>>;   // another task's artifact, recorded with its revision
  decision(...); diagnostic(...); metric(...); checkpoint(...);
  derive(source: Artifact, mapping?): void;  // provenance between artifacts
}
```

`Compiler` (`runtime.ts:86`) holds the registered kinds and passes, the inputs, and a cache of results. A run (`beginRun`, `:198`; `CompilationRun`, `:333`) resolves tasks on demand: `require(task)` (`:406`) calls `resolve` (`:447`), which detects cycles, shares one execution per task id per run, and calls `execute` (`:488`). The essential part of `execute` is how it decides to reuse a cached result:

```text
execute(task):                                                       runtime.ts:488
  for each cached entry for task.id, most recently used first:      :675
     changes <- []
     if the pass, its version, the output schema or the params differ: changes += that
     for each recorded input dependency:  if fingerprint(current input) ≠ recorded: changes += it      :715
     for each recorded task dependency, in order:
        current <- resolve(dependency task)          # may itself re-execute, or reuse
        if current.revision ≠ recorded revision: changes += it; stop                                  :741
     if no change: reuse the entry's artifact, replay its decisions and metrics       → status 'cached' :771
  otherwise run the pass, freeze and validate its value, compute its revision         :817–830
  store an entry { key, task, version, dependencies (with revisions), artifact, ... }  :844–869
```

**This is early cutoff, already implemented.** When a dependency re-executes and produces the same revision as last time, the dependent's comparison at line 741 succeeds and the dependent is reused without running. With content-addressed artifacts, "same revision" means "same content", so an edit that changes an input but not a part stops propagating at the first task whose output did not change. The runtime also explains its decisions: `run.explainCache(artifact)`, `run.why(artifact)`, `run.compare(previousRun)` (`:362–379`).

Its limits for this use are concrete:

- **Lookups scan.** `_candidates(taskId)` filters every cache entry (`:308–310`), and `_store` evicts by finding the least recently used entry with a linear scan (`:325–329`). The default capacity is 2,048 entries (`:105`); one O2 run with a task per function per pass would need 332 × 16 = 5,312.
- **Everything is in memory.** Entries, invocation records and derivations live in the `Compiler` object; `snapshot()` (`:270`) builds an immutable copy of the whole database for every query.
- **An output's revision is a whole-value fingerprint** (`:822–828`), which is fine for part-sized outputs and exactly the cost of §2.4 for whole programs.

### 9.2 `IRStore`

`IRStore` (`src/framework/ir/store.ts:12`) is a process-local, immutable revision lineage: it retains artifacts by `(id, revision)`, keeps one head per artifact id, and publishes a new head only through an edit with a compare-and-swap on a generation counter (`#publish`, `:103`). It is not a cache. The Typed compiler never shares one: `openIR(artifact, adapter, store = new IRStore())` (`view.ts:331`) makes a new store per view, which retains one revision and dies with the view.

## 10. What each step is proportional to

| step | proportional to | Candela, measured | source |
|---|---|---:|---|
| ingest (front end and lifter) after a source edit | program | 1.8–4.2 s | (04) |
| `Store.from` | program | 207 ms | (05) |
| `typedPass.run`: bodies, fact views, `toNative` | program | 832 ms | (05) |
| analyses a pass needs, first time | program (one function is two thirds of it) | `ranges` 2.9 s via the manager | (01) |
| `createIRArtifact`, all records shared | program | 1.0–1.8 s | (02), (05) |
| of which the identity term (text join and hash) | program, small constant | 288 ms | (02) |
| `diff` | program | 366–419 ms | (02), (05) |
| `makeCorrespondence` | program | 5.2–11.1 s | (02), (05) |
| preservation claims by transfer | program (a second diff) | — | `dataflow/analysis.ts:164` |
| meaning check, within one pipeline | changed closure keys | 12–207 functions per pass | (03) |
| meaning check, after a source edit | program (origin changed) | 13,280 baseline outcomes | §7.3 |
| browser open, browser pass | program, one main-thread task | 8.6 s, 21.3 s | IRWB-004 `various/20` |

Only one row is proportional to the change. Part 2 moves every other row except the identity term and the front end into that column.

# Part 2: The design (Proposed)

## 11. The principle, and the invariant to measure

### 11.1 The principle

Every whole-program cost in §10 has the same cause: a step computes a fact about a revision as a whole, and the next revision is a new whole, although most of its parts are the same objects or have the same hashes. The design gives each such fact a **part-sized key**, computes it per part, and assembles the whole only when something asks for the whole. Nothing new enters any artifact's value, so no revision changes (§19).

### 11.2 The invariant

Let a program have text size N (characters of its revision text), and let an edit e change the set C(e) of function parts. An edit has two **work sizes**, one for the compiler and one for the meaning check:

```text
R(e) = Σ_{p ∈ C(e)} |p|        the records of the changed parts
K(e) = 40 · |F(e)|              the cases whose verdict keys change; F(e) = the functions whose
                                closure keys change: C(e) and all their transitive callers
```

The time of an edit splits into three terms, each measured separately:

```text
T(e) = T_rec(e) + T_case(e) + T_id(e)
T_id(e)   = the identity term: joining cached texts and hashing the new revisions' texts (§2.4)
T_case(e) = deciding cases in the meaning check
T_rec(e)  = everything else: facts, pass bodies, validation, artifacts, diffs, correspondences
```

**The invariant: for every edit in a realistic edit stream, `T_rec(e) / R(e)` and `T_case(e) / K(e)` do not grow with N, and `T_id(e) / N` is constant.** The identity term cannot be removed while revisions are SHA-256 over the whole text, which the hard requirement fixes; its constant is small (24–54 ms for Candela's 18 MB with `node:crypto`, IRWB-004 `various/05`, `various/22`), and the design keeps it off the page's main thread (§16). Below, "the work term" means `T_rec` and `T_case` together.

Stating the invariant per *work size* rather than per edit is a consequence of §6.3: an edit to `tracePath` changes one function and two thirds of the `ranges` work. "Cost per edit independent of program size" means that program size does not enter, not that every edit costs the same.

### 11.3 How to measure it

**Program sizes.** The same code at several sizes: call-closed subsets of Candela (choose root sets whose closures hold about 25%, 50%, 75% and 100% of the functions; a closure is valid on its own because every callee is included), the per-scene programs of IRWB-001 step 26 (137 functions), and the corpus projects.

**Edit streams.** Three, each replayable from a seed:

1. **The pass stream**: O2 pass by pass (03 is this stream on Candela).
2. **The workbench stream**: a person editing source: same-length constant edits in randomly chosen functions, whitespace edits (blank lines, comments), and occasionally an edit that changes a signature (which changes every caller). Each edit is followed by "apply O2 and check", as the workbench's pipeline button does.
3. **The specialization stream**: per-scene specialization (IRWB-001 step 26), whose edits are large (332 → 137 functions); it checks that the design does not penalize large edits.

**What to record per edit**: R(e) and K(e); T_rec(e) by component (ingest, facts, bodies, validation, artifact, diff, correspondence), T_case(e), T_id(e); and the number of parts, records and cases actually recomputed. **The pass criterion**: for each stream, the medians of `T_rec/R` and `T_case/K` at 100% of Candela are within 1.5× of their medians at 25%, and every component's share is reported. A component whose time grows with N at fixed R is a violation and names where. Ingest is reported but excluded from `T_rec`, because the front end is outside the framework (§20).

### 11.4 The pieces, and how they fit

The four approved pieces become seven sections, because three of them need supporting work first. The keys of §12 are what everything else looks up under; the per-part facts and validation (§13, §14) and the per-part projection (§15) remove the whole-program work from `applyPass`; the page (§16) is the user-visible result; the store (§17) makes the keyed results survive the process; and the query engine (§18) is the same keyed results organized as demand-driven tasks with early cutoff.

```text
                     keys (§12): part hash · code hash · code closure key · counters · toolchain
                        │
      ┌─────────────────┼───────────────────────────┬──────────────────────────┐
      ▼                 ▼                           ▼                          ▼
 facts per part     validation per part     projection, diff and         meaning-check outcomes
 on demand (§13)    (§14)                   correspondence per part      and verdicts per function
      │                 │                    (§15)                        (§12.2)
      └────────┬────────┴───────────┬───────────────┘                          │
               ▼                    ▼                                          │
        applyPass: work ∝ changed parts                                        │
               │                    │                                          │
               ▼                    ▼                                          │
        the page adopts in      persistent store (§17): the same keys, ◄───────┘
        slices (§16)            across processes, agents and the browser
                                    │
                                    ▼
                    query engine on the task runtime (§18): the same keyed
                    results as tasks; early cutoff stops an edit at the
                    first unchanged output
```

Approved piece 1 (analyses keyed by function part) is §13; piece 2 (a lazy projection) is §15; piece 3 (a persistent content-addressed store) is §17; piece 4 (demand-driven queries with early cutoff) is §18.

## 12. Keys

Every reuse in this design is a lookup under a key. This section collects them; the next sections use them.

| key | definition | covers | used by | status |
|---|---|---|---|---|
| revision | SHA-256 of the canonical text of `{ kind, schemaVersion, value }` | the whole value | artifacts, publication | exists, unchanged |
| part hash | SHA-256 of `partText(p)` (`parts.ts:115`) | one function's records, `ops` and positions included | mirrors, validation memo, pass memo | exists |
| code hash | SHA-256 of the part without `ops` and without locals' `at` | what the evaluator, analyses and pass bodies read | analyses, verdicts, pass memo | **Proposed** |
| closure key | SHA-256 of `name:partHash` over `closureOf(v, f)` and the frame flag (`parts.ts:241`) | code reachable from f | verdict memo | exists |
| code closure key | the same over code hashes | code reachable from f, without positions | verdicts, baseline outcomes | **Proposed** |
| counters of f | the `counters` entries with f's prefixes | the ids f's next edit will allocate | pass memo | **Proposed** |
| toolchain | SHA-256 of the built compiler and framework code | the code that computed a result | every persistent key | **Proposed** |

### 12.1 Why a code hash

§3.4 measured that a blank line changes 154 part hashes and 0 code hashes. With keys that include positions, any edit that adds or removes a line would invalidate every function after it in the source, half of Candela for an edit in `scenes.typed`. The code hash leaves out exactly the things that only locate code in the source: the front-end operations (records nothing executes, IRWB-002 guide §5) and the `at` field of locals.

**Soundness obligation.** A consumer may be keyed on code hashes only if what it computes does not depend on `ops` records or `at` fields. For the evaluator that follows from `evaluate` reading only statements, values, blocks and function records through `st.get` and `st.fn` (IRWB-004 step 8). For analyses and pass bodies it must be checked, not argued, by two tests. The first is the robust one: shift every position in a value by a constant (every `at.line`, `at.start`, `at.end`), and require every fact, verdict and pass output, with its positions shifted back, to equal the original's, on the corpus and on Candela's O2 revisions. The second finds the reader when the first fails: the recording store of §18.4 reports every `get` of an `op:` id, and in test mode it wraps function records in read-tracking proxies that report a read of a local's `at`.

### 12.2 Per-function origin keys for the meaning check

The baseline outcome of case n of function f depends on f's cases (its signature, inputs and the seed, §7.1), the step limit, and the origin's code reachable from f. **Proposed:** key baseline outcomes by `(spec id@version, seed, count, f, n, codeClosureKey(origin, f))` and verdicts by that plus `codeClosureKey(candidate, f)`, instead of by the whole origin's revision. After a constant edit to `s3_mat_0`, 11 functions' baseline outcomes and verdicts are recomputed instead of 13,280 cases (04: 11 closure keys change). The evidence stays identical, because the verdict of a case is the same whatever key found it (IRWB-004 guide §15.2).

The framework side is a fourth optional field on `DifferentialSpec`, `caseKey(inputs, case)`, which replaces `baselineKey` for the outcome cache when present; `typed.meaning-kept` supplies it. Case *indices* must not appear in the key, because adding a function shifts the indices of every later function's cases; `(f, n)` does not shift.

### 12.3 The toolchain fingerprint

All twelve Typed passes have version `'1'` (`typedPass`, `passes.ts:177`), and analysis versions change only by hand. In memory that is harmless, because the code cannot change during a process. A persistent store would serve results computed by yesterday's code. **Proposed:** `toolchainFingerprint()` hashes the built files under `dist/framework` and `dist/typed` (in the browser, the bundle's own hash, which the build already computes for `LAZY`); every persistent key includes it. This is coarse: any rebuild invalidates the store. It is also safe, and phase P4 (§21) records how often it invalidates the store during normal development.

## 13. Analyses per function part

### 13.1 Facts per part

**Proposed:** a dataflow definition gains a per-region entry point and the manager a per-part cache:

```ts
// src/framework/dataflow/analysis.ts (additions)
interface DataflowAnalysis<S, V> {
  /** Solve one region of `subject`; the same record solveArtifact would put under regions[region]. */
  solveRegion(subject: Artifact<S>, region: string, params?: unknown): RegionResult;
}
// src/framework/contracts/analysis-manager.ts (addition)
analysePart<S>(def: DataflowAnalysis<S, any>, subject: Artifact<S>, region: string,
               partKey: string, params?: unknown): Promise<RegionResult>;
```

The manager keys a region's result by `(definition id@version, partKey, params)`, where `partKey` is the part's code hash (or its part hash until §12.1's tests pass). A whole result is assembled from region results when something asks for the whole:

```text
assemble(def, subject):
    regions <- { for each function f in fnOrder: analysePart(def, subject, f, codeHash(part f)) }
    return immutable({ analysis: def.id, direction, regions })   # frozen region records are shared: immutable
                                                                 # walks only the new top-level object
record id <- fingerprint over { key, part keys }                 # not over the value
```

The assembled value is canonically equal to `solveArtifact`'s, because each region is solved by the same code on the same records and the region results are independent (01: 222 of 222). Passes, views and preservation claims see the same `DataflowResult`. Freezing costs only the regions that were recomputed, because `immutable` returns a canonical object unchanged (`data.ts:142`).

The plain per-function analyses (`cfg`, `dominators`, `loops`) get the same treatment through a `perPart` helper that replaces `perFunction` (`analyses.ts:120`).

### 13.2 Facts on demand

**Proposed:** `applyPass` stops solving a pass's needs before `run` when the pass declares `facts: 'on-demand'`, and `typedPass` builds a function's view on the first call to one of its methods:

```text
in typedPass.run, for each function f and each need (alias, name):
    views[alias] <- a view object whose methods, on their first call,
                      region <- partFacts(name, f)            # cached by (definition, code hash of f)
                                or solveRegion(name, before, f) and cache it
                      build view(name, region, st, f) and forward the call to it
after the loop: hand the regions solved during run to the manager (analysePart's cache)
```

The body is synchronous and the manager's `analyse` is asynchronous, so the view calls `solveRegion` directly, and the regions it solved are recorded in the manager after `run` returns. For `strength` on Candela this solves one function's ranges (76.4 ms) instead of 332 (3,292.0 ms) and builds one view (15.4 ms) instead of 332 (264.2 ms) (06).

What that does to the first no-change `strength` follows from IRWB-004's profile of the same pass (IRWB-004 `various/23`): 4,295 ms the first time and 655 ms the second, when `ranges` was already solved. The second run still built all 332 views. On demand, the first run should therefore cost about 655 ms − 249 ms (the views not built) + 76 ms (one region solved), roughly 0.5 s, and lazy edit maps (§15.5) remove about 100 ms more (the profile shows 211 ms of `beginEdit` over its two runs). That is the arithmetic behind P1's target of one second (§21); it is an estimate from measured pieces, and P1 measures it.

### 13.3 Interprocedural facts through summaries

Today no analysis crosses a call (§6.2), so per-part keys are exact. IRWB-002's item C3 would add **summaries**: what a function can do (pure, may trap, which memory it writes, the range of its result), computed callee-first. A summary of f depends on f's code and on its callees' *summaries*, not on their code. That suggests the key:

```text
summaryKey(f) = H(def id@version, codeHash(f), [ (g, hash(summary(g))) for g in calleesOf(f) ])
summary(f)    = compute(part f, { g: summary(g) for g in callees })     # memoized under summaryKey(f)
for each strongly connected component of the call graph, callees first:
    a component of one non-recursive function: compute once
    otherwise: iterate the component's summaries to a fixpoint from the optimistic summary,
               key the component by its members' code hashes and its external callees' summary hashes
```

This key gives **early cutoff at the level of facts**: when an edit to `q_floor` (104 transitive callers, 01) leaves its summary unchanged (still pure, same result range), no caller's summary key changes and nothing above it is recomputed. Closure keys cannot do that, because they hash code, and code did change. Candela has no recursion (01), so its components are single functions; the corpus has recursive projects, and the component rule covers them.

Summaries do not help the meaning check: a verdict depends on what the code *does*, so verdict keys must cover code. §20 discusses a finer key for verdicts (the functions a case actually executed).

### 13.4 Preservation claims per part

A pass that claims to preserve analysis A is checked by A's transfer verifier, which today diffs the two whole projections (`dataflow/analysis.ts:164`). With per-part facts, the claim is checked per part: for a part that is the same object (or has the same code hash) in both revisions, its facts transfer trivially; for a changed part, the verifier checks whether the part's diff touches A's `reads` kinds (`readsTouched`, `:89`), on the part diff of §15.3. The claim's verdict is the same as today's, because the whole diff is the union of the part diffs (02: 882 entities and 3,737 relations both ways).

## 14. Validation per part

`validateBlocks` (`src/typed/ir.ts:93`) runs for every new revision: 241 ms cold, 124 ms warm, 111 ms on a reassembled value (02, 05). Its checks split cleanly:

- **Program-wide:** `formatVersion`, the tables exist, `program`, `rev`, `fnOrder` lists every function once (`:95–105`). These are proportional to the number of functions.
- **Per function:** the function's id and name, indexed locals, its blocks belong to it, successors and jump targets are its blocks, statements' operands are its values, `set` locals are in range (`:106–134`); its value trees are acyclic with arguments in the same function (`:136–150`); and the types (`checkTypes`, `:159`), which for a call need the callee's signature.
- **Orphans:** a record whose `fn` names no function. `partsOf` already groups records by `fn` (`parts.ts:53–57`); a group with no function is an orphan.

**Proposed:** `validatePart(part, calleeSignatures)` memoized on the part object and a hash of its callees' signatures; `validateBlocksByParts(v)` runs the program-wide checks, the orphan check, and `validatePart` for every part. Its contract is **the same verdict as `validateBlocks`, and on rejection the same error**: on any failure it calls `validateBlocks(v)` itself and throws what that throws. A property test runs both on the corpus, on Candela's O2 revisions, and on values with single-record mutations (a dangling successor, a cycle, a wrong operand type, an orphan), and requires equal verdicts. A revision that changes 2 functions then validates 2 parts.

## 15. A lazy, per-part projection, diff and correspondence

### 15.1 The projection stops being eager

**Proposed:** `createIRArtifact` no longer calls `project` (`adapters.ts:142`). The projection is computed when `openIR` or a view first needs it, and cached as today. Because the projection is not part of the artifact, this changes no artifact. It changes *when* an adapter inconsistency is reported: at the first view instead of at creation. To keep the check in tests, `IRWB_VERIFY_PROJECTION=1` restores the eager call, and the corpus and Candela suites run with it.

This removes 2.9 s of a cold `createIRArtifact` on Candela (§4.3) and the 3.0 s of the browser open (IRWB-004 `various/20`) from every path that does not navigate a view. Once §15.3–§15.5 hold, `applyPass` is such a path: it still calls `openIR` (`define-pass.ts:196`), but `openIR` no longer projects (§15.5), the diff works on parts, and the correspondence is compact.

### 15.2 Projection by parts

**Proposed** adapter extension (`src/framework/ir/types.ts`):

```ts
interface IRAdapter<T> {
  /** Independently projectable parts of a value, e.g. one per function. */
  parts?(value: T): Iterable<{ readonly key: string; readonly object: object }>;
  /** The entities and relations of one part, each sorted as validateGraph sorts them. */
  projectPart?(value: T, part: { key: string; object: object }): IRGraph;
  /** Which part an entity belongs to (for typed.blocks, the function its id names). */
  partOf?(value: T, entity: string): string | undefined;
}
```

For `typed.blocks`, a part is a `FunctionPart`, and since every relation stays inside one function (§4.1), the projection is the union of the parts' projections. Part projections are cached per part object; the whole graph, when a view needs it, is a k-way merge of the 332 sorted runs (entities by id, relations by `compareRelations`). Built cold, part by part, the whole projection costs about what it costs today (2.1 s against 2.0 s for entities and relations, 02); the gain is that a new revision rebuilds only its changed parts.

### 15.3 Diff by parts

**Proposed:** `diffByParts(adapter, before, after)`: for each part key, skip it when both revisions have the same part object (or part hash); otherwise diff the two parts' projections; then merge the results in the global id order `diffGraphs` uses (`diff.ts:26`, `:49`). On r0 → r1 (`cfg`, 110 functions) it finds exactly the whole diff's 882 entities and 3,737 relations (02). Once part projections are cached, its cost is that of the changed parts; in the measurement, where the changed parts' projections were built inside the diff, it took 722 ms against 419 ms for the whole diff of already-projected revisions (02). `undeclaredWrites` (`define-pass.ts:151`) and the transfer verifier read only the change set, so they are unchanged.

### 15.4 A compact correspondence

`makeCorrespondence` is the largest piece of a small pass (§5.2), and almost all its entries say "retained". **Proposed:** correspondence format 2:

```ts
interface CompactCorrespondence {
  readonly formatVersion: 2;
  readonly from: RevisionRef; readonly to: RevisionRef;
  /** Parts present in both revisions with the same part hash: every entity of such a part is retained. */
  readonly sameParts: readonly string[];
  /** Entries for the entities of the other parts, exactly as makeCorrespondence makes them. */
  readonly entries: readonly CorrespondenceEntry[];
}
expandCorrespondence(c: CompactCorrespondence, before: Artifact, after: Artifact): EntityCorrespondence;
//   equal, canonically, to makeCorrespondence(before ids, after ids, explicit)
```

`applyPass` builds the compact form; `semanticCorrespondence`, `verifyTransformation`, `preserve` and `whyEntity` (`correspondence.ts:306`) accept it, and anything that needs format 1 calls `expandCorrespondence`. A test expands every compact correspondence of the corpus pipelines and of Candela's O2 and compares it canonically with `makeCorrespondence`'s.

**Decision.** The manager's execution records will hold format-2 correspondences. This changes the content of those in-memory records (not any revision, and not the meaning check's evidence) and shrinks them from one entry per entity of the program to one entry per entity of the changed parts; for the last `cfg`, from 93,138 entries to those of `hitMesh` and `traceAll`. IRWB-004 identified those records as the largest memory cost of a long pipeline (IRWB-004 guide §7.4). The alternative, a lazily materialized format 1, is ruled out because the manager freezes what it records, and `immutable` refuses accessors (`data.ts:107`).

### 15.5 The edit and the views

`view.beginEdit()` builds two maps over the whole graph (`transactions.ts:53–54`) for a logical edit that no Typed pass uses, and `openIR` projects the value (`view.ts:338`) and builds an entity map (`view.ts:197`) before anyone navigates. **Proposed:** the edit builds its maps on its first operation; the view computes its graph and its entity map on the first call of a method that needs them (`graph`, `resolve`, `relations`, `walk` and the other navigation methods). `graph()` then returns the merged per-part projection of §15.2.

## 16. Adoption on the page in slices under 100 ms

**The goal:** opening Candela and applying a pass from the page never holds the main thread for more than about 100 ms, and the page still computes every revision it publishes itself (IRWB-004's rule: "the main thread never trusts a hash it did not compute", IRWB-004 guide §16.6).

**The protocol (Proposed)**, extending the engine worker's existing messages:

```text
open:    worker: ingest, toNative, createIRArtifact (lazy projection); post the PartsRef and the
                 part texts in messages of bounded size
         page:   adopt(ref, texts)
apply:   page:   post { apply: pass, params, contract parameters, base revision }
         worker: applyPass on its mirror, under the same contract; post the changed part texts, the
                 report, the evidence, the change set and the compact correspondence
         page:   adopt(new ref, changed texts); check its revision equals the worker's; push the revision

adopt(ref, texts):                         each line is one or more tasks; the page yields between them
    for each part text:          parsePart                              median 1.4 ms, max 82.6 ms (tracePath)
    assemble the tables          in chunks of a few thousand records    173 ms in all
    validateBlocksByParts        part by part (§14)                     111 ms in all
    canonical text               records encoded in chunks of ~5,000    1,253 ms in all (~70 ms per chunk)
    SHA-256                      Sha256.update in 1 MiB slices          358 ms in all, max 62.1 ms
    createIRArtifact from the frozen value with its precomputed hashes (no projection)
    Program.fromArtifact(name, source, r0, options)                     Proposed, IRWB-004 §16.6
```

The slice sizes are Node measurements (05); Chromium was slower than Node for the same work in IRWB-004's profiles, so the plan's first browser step re-measures them in the page and splits the largest parts (`tracePath`, `cdlInit`) by table if their parse exceeds the budget. The yield is a `MessageChannel` round trip once a slice has run for about 30 ms (IRWB-004 guide §16.7). The acceptance measurement is IRWB-004's: a 10 ms `setInterval` heartbeat on the page, whose largest gap is the longest task (IRWB-004 step 11 found `PerformanceObserver('longtask')` unreliable for this).

**Why the page re-encodes text instead of receiving it.** The worker could post the 16 MB revision text, and the page could hash it in slices. But the page must then check that the text is the encoding of the value it holds, which means encoding the value anyway. Encoding in slices is the cost of not trusting the worker. An open question (§24) is whether the page and its same-origin worker, built from the same bundle, need to be separate trust domains at all.

## 17. A persistent, content-addressed store

### 17.1 What it holds

Every key in §12 is a content hash, so results stored under them never need invalidation; only their code (the toolchain) and their space can make them obsolete. The store holds two kinds of thing: **objects**, named by the SHA-256 of their bytes, and **index records**, which map a key to object names.

| namespace | key | value | size on Candela (measured) |
|---|---|---|---|
| `part` | part hash | the part's text | 14.8 M chars for all 332 (05); one revision adds only its changed parts |
| `program` | revision | `PartsRef` plus header (counters, frontEnd, program, rev) | a few KB |
| `facts` | H(toolchain, definition@version, code hash, params) | one region's result | `ranges` 11.8 M chars for all, 6.5 M of it `tracePath` (01) |
| `outcome` | H(toolchain, spec@version, seed, count, f, n, codeClosureKey(origin, f)) | one baseline outcome (result and memory) | a few KiB each, 13,280 (IRWB-004 step 8) |
| `verdict` | the outcome key plus codeClosureKey(candidate, f) | agree, inconclusive, or disagree with reason | tens of bytes each |
| `step` | H(toolchain, pass@version, code hash, counters of f, fact keys read, params, rev if it edited) | unchanged, or the output part and its edits and explicit correspondence entries | per changed function |
| `run` | H(toolchain, pipeline, origin revision, contract parameters) | the list of revisions and reports | small |

The `step` namespace is what makes a pipeline replay cheap: a pass applied to a function whose code, counters and facts are unchanged since the last time returns its stored result. The `rev` number enters the key only for results that edited, because only edited records carry it in their origins (§5.1).

### 17.2 Layout and backends

```text
<store>/
  meta.json                         { formatVersion, created }
  objects/ab/abcdef…                content-addressed blobs (part texts, facts, outcomes, step results)
  index/<namespace>/cd/cdef….json   { key, objects: [...], toolchain, bytes, created, used }
  pins/<name>.json                  roots that garbage collection keeps (e.g. open projects' heads)
```

- **Node** (`directoryStore(path)`, Proposed): files under the repository-local `.irwb-store/` (ignored by git) or `$XDG_CACHE_HOME/irwb`; writes go to a temporary file and are renamed into place, so a reader never sees a partial object; concurrent writers of the same object write the same bytes.
- **Browser** (`indexedDbStore(name)`, Proposed): two IndexedDB object stores, `objects` and `index`, used from the engine worker. The page's policy (`connect-src 'none'`) does not restrict IndexedDB.
- **Packs between Node and the browser.** The page cannot fetch, so it cannot read the Node store. A Node tool exports a **pack**: a same-origin script defining `self.irwbPack = { objects: { name: text }, index: [...] }`, served like the Candela data. The page loads it as a script, and the worker verifies each object's name against its content before importing it (§17.4).

### 17.3 Eviction

A size budget (default 2 GB in Node, the origin's quota in the browser) and three rules: index records are touched on use; a collection marks every object reachable from the pins and from index records used in the last N days, and deletes the rest; and a new toolchain fingerprint does not delete anything by itself, since the next collection removes records nobody uses. The collection reports bytes kept and freed per namespace.

### 17.4 The trust model

A cached result is accepted in place of computing it, so the store is part of what the compiler trusts. The model has four rules.

1. **Integrity is checked on every read.** An object is named by the SHA-256 of its bytes, and the reader hashes what it read (with `node:crypto` at about 750 MB/s in Node, IRWB-004 `various/05`; with `crypto.subtle` in the worker). A mismatch is a miss, and the object is deleted.
2. **Provenance is the key.** A derived result (facts, outcomes, verdicts, step results) is valid only under its full key, which includes the toolchain fingerprint and every input's content hash. A result computed by different code is never found, rather than found and rejected.
3. **Derived results are accepted only from stores this user's processes wrote.** A Node store is a directory with the user's permissions, the same trust the built `dist/` files have. Agents on the same machine share one store. The page can load nothing but same-origin scripts from the user's own server (§8), so a pack is trusted exactly as much as the bundle that server serves; its parts and programs are re-hashed anyway (rule 4), and its derived results are accepted like the Node store they came from. A store copied from another machine or user is opened with derived namespaces disabled.
4. **Publication recomputes the revision.** A `program` record names a revision; adopting it for a new head of a `Program` re-hashes the assembled value (§16). A read-only view of a stored revision may skip that, and says so.

**Audit.** With `IRWB_STORE_AUDIT=p`, each replayed verdict, fact and step result is recomputed with probability p and compared; a mismatch is an error naming the key. The corpus suite runs with p = 1 once per change to the store's code.

### 17.5 Sharing between agents and the browser

Two agents working on Candela on the same machine compute the same parts, facts and outcomes under the same keys. With a shared store, the second agent's O2 replays the first one's work, and its own new results become visible to the first. The browser joins through packs: a Node run exports the pack for a project's current head and its facts; the page imports it and opens Candela from IndexedDB without lifting.

## 18. A query engine on the task runtime

### 18.1 Queries

The runtime of §9.1 already has demand-driven resolution, dependency recording and early cutoff on revisions. **Proposed:** express the compiler's work as its tasks, with part-sized outputs. Task ids are logical names that stay the same across edits; the revisions of what they read decide reuse.

| task id | algorithm | requires / reads | output | cutoff on |
|---|---|---|---|---|
| `source:<p>` | input | `read('source/<p>')` | the source text | text hash |
| `ingest:<p>` | front end and lifter | `source:<p>` | `typed.blocks` r0 | revision |
| `part:<p>@0/<f>` | slice f's records out of r0 | `ingest:<p>` | `typed.part` | part hash |
| `part:<p>@<i>/<f>`, i ≥ 1 | f's part after pass i: the step's output code with f's current ops | `step:…#<i>/<f>`, `part:<p>@<i-1>/<f>` | `typed.part` | part hash |
| `code:<p>@<i>/<f>` | drop ops and positions | `part:…@<i>/<f>` | `typed.code` | code hash |
| `facts:<a>/<p>@<i>/<f>` | analysis a on one region | `code:…@<i>/<f>` | region result | its hash |
| `summary:<a>/<p>@<i>/<f>` | §13.3 | `code:…/<f>`, `summary:…/<g>` for callees | summary | its hash |
| `step:<p>/<pipeline>#<i>/<f>` | pass i of the pipeline on f | `code:@<i-1>/<f>`, the counters of f, demanded `facts:` | output code part, or unchanged | its hash |
| `revision:<p>@<i>` | assemble the parts; `createIRArtifact` | every `part:<p>@<i>/<f>` | `typed.blocks` | revision (the identity term) |
| `outcome:<p>/<f>#<n>` | evaluate the origin on case n | `code:` keys of f's origin closure | outcome | its hash |
| `verdict:<p>@<i>/<f>#<n>` | evaluate the candidate, compare | `outcome:…`, `code:` keys of f's candidate closure | verdict | verdict |
| `check:<p>@<i>` | tally in case order | every `verdict:…@<i>` | evidence | its hash |
| `mcode:<p>@<i>/<f>` | backend for one function (`compileFunction`) | `code:…/<f>` (+ facts) | machine code | its hash |
| `image:<p>@<i>` | layout and encode | every `mcode:` | `rv32.image` | revision |

```text
                                                  ┌─► facts@0/f ──┐
source ─► ingest ─► part@0/f ─► code@0/f ─────────┤               ▼
                       │                          └──────────► step#1/f ─► part@1/f ─► code@1/f ─► step#2/f ─► …
                       └─────── ops of f ─────────────────────────────────────┘           │
                                                                                          ▼
                         every part@1/g ─► revision@1          (the identity term; the only task that
                                                                 reads every function at one stage)
         origin closure code keys ─► outcome/f#n ─┐
         candidate closure code keys ─────────────┴─► verdict@1/f#n ─► check@1
```

Each function's chain (`part`, `code`, `facts`, `step`) depends on nothing but that function, its counters, and the facts it asked for. Only `revision@i`, `check@i` and `image@i` read every function at one stage.

### 18.2 Two edits, walked through

**A constant edit in `s3_mat_0`.** `source` changes; `ingest` re-executes (the front end is whole-program, 1.8–2.5 s, 04) and produces a new r0. Each `part@0/f` re-executes (slicing is cheap) and 331 of them produce the revision they produced before; at that point **early cutoff** applies: every task in those 331 functions' chains finds its dependencies' revisions unchanged and is reused without running. `step#1/s3_mat_0` and the rest of that one function's chain re-execute, and each `revision@i` re-executes (the identity term). The check re-decides the cases of the 11 functions whose code closure keys changed (04), 440 cases instead of 13,280.

**A blank line in `s3_mat_0`'s header.** `ingest` re-executes; 154 `part@0/f` outputs change (positions); all 332 `code@0/f` outputs are unchanged (04), so every `facts`, `step`, `outcome` and `verdict` task is reused. The `part@i/f` tasks of those 154 functions re-execute to carry the moved ops forward, and each `revision@i` re-executes to hash. The cost of the edit is the front end, 154 × 13 cheap part assemblies, and fourteen identity terms (r0's, and one for each of the 13 revisions O2 makes on Candela).

**What remains proportional to the program, even with early cutoff, is verification.** A run visits every task of the pipeline once to compare its recorded dependency revisions: for O2 on Candela, about 332 × 16 step tasks and as many part and code tasks. Each visit is a few map lookups and string comparisons, but there are tens of thousands of them. P5 (§21) measures this bookkeeping term separately; if it matters, the usual remedy is to skip verifying whole groups of tasks whose inputs rarely change, which is what salsa's durability levels do.

### 18.3 What the runtime needs

- **An indexed, bounded cache**: a `Map` from task id to its entries, and least-recently-used order kept by a `Map`'s insertion order, replacing the scans of `runtime.ts:308–330`.
- **A persistence port**: `new Compiler({ storage })`, where `storage` is a `ContentStore` (§22); cache entries are serialized with their dependencies and their artifacts' revisions, and artifacts go to the `objects` namespace.
- **Explanations without a database snapshot**: `explainCache` and `why` answer from the entry and invocation records directly, not from `snapshot()` (`runtime.ts:270`).
- **Verification once per run**: the runtime already resolves each task id once per run (`completed`, `:334`); the verification loop of `:727–750` must stop at the first changed dependency, as it does (`break` at `:748`), so that a long chain is verified in recorded order.
- **Part-sized artifacts**: the outputs above are small, so the runtime's whole-value fingerprint of each output (`:822`) is cheap; only `revision@i` pays the identity term.

### 18.4 Dynamic dependencies: a recording store

A `step` task is valid only if the pass body read nothing outside f's code, its counters and the facts it asked for. Pass bodies receive the whole-program `Store` (§5.1). **Proposed:** a `RecordingStore` that wraps `Store.get`, `has` and `fn`, and records, per body invocation, every function whose records were read (by the function name an id carries) and whether an `op:` id or an `at` field was touched. A read of another function's records becomes a dependency of the step task on that function's `code:` task, exactly as salsa records the queries a query reads. In tests, the recorder runs on every pass over the corpus and Candela and reports which passes are per-function in fact.

### 18.5 Per-function passes in the pass API

**Proposed:** `TypedPassSpec` gains `scope?: 'function' | 'program'`. `program` is the default, and a pass with `program: true` (`passes.ts:76`, e.g. dead-function elimination) stays a whole-program task. A `function` pass is run per function by the engine and memoized as a `step`; its body's interface (`BodyContext`) is unchanged, so passes remain source-compatible. Declaring `function` is a claim the recording store checks.

## 19. How hash identity is preserved

The hard requirement is that every revision hash stays identical. The design meets it by construction and by test.

**By construction.**

- Nothing in this design writes anything new into an artifact's value. Part hashes, code hashes, closure keys, summary keys, task ids, store keys and compact correspondences are all derived and kept outside values.
- `revisionOf` is not changed. The revision text is assembled from the same record texts by the same encoder; adoption in slices (§16) builds the same string piece by piece and feeds the same SHA-256 in pieces, which IRWB-004 already does (`revisionOf`, `data.ts:210`; `Sha256`, `src/framework/core/sha256.ts:108`).
- Per-part results are assembled into exactly the values the whole-program code produced (facts §13.1, validation §14, diff §15.3, correspondence §15.4). Each has an equality test against the whole-program function.
- Pass outputs come from the same bodies on the same records with the same counters and `rev`; a stored step result is the output of that same code, under a key that includes the toolchain.

**By test**, at every increment that touches `src/framework`, `src/typed/model.ts`, `src/typed/ir.ts`, `src/typed/parts.ts` or the meaning check:

```bash
npm test
IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs
node tools/parity.mjs
node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs \
  | diff ttmp/2026/11/25/IRWB-004--*/various/01-corpus-revisions-baseline.txt -        # IDENTICAL-44
systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 \
  node --max-old-space-size=10240 ttmp/2026/11/26/IRWB-009--*/scripts/03-o2-edit-size.mjs # every step "matches"
```

The last command is this ticket's O2 replay; it checks all 16 Candela revisions against IRWB-004's baseline in about two minutes, without the meaning check (03). At the end of each phase, IRWB-004's full O2 run with evidence (`ttmp/2026/11/25/IRWB-004--*/scripts/04-candela-o2-revisions.mjs`) is diffed against `various/04-candela-o2-baseline.json`: revisions and evidence counts equal; only times may differ.

## 20. Risks, and what would falsify the approach

**Risks.**

- **Hidden reads.** A pass body or analysis that reads another function's records through `st` without the engine knowing would make a stored step result stale, and the meaning check would catch the consequence only by sampling. Mitigation: the recording store (§18.4), and `scope: 'program'` as the default.
- **Code-hash soundness.** If anything reads `ops` or positions and is keyed on code hashes, a whitespace edit would reuse a wrong result. Mitigation: §12.1's two tests; until they pass, key on part hashes.
- **Uneven functions.** `tracePath` is two thirds of `ranges` and 6.5 MB of facts (01). Edits concentrated in it gain little from per-function keys; finer parts (per block) would be the next step, and the invariant's per-work-size statement makes this visible instead of hiding it.
- **The front end is whole-program**: 1.8–4.2 s per source edit (04), outside this design. It bounds the workbench stream's latency from below until lifting runs per function.
- **The browser's identity term.** The portable SHA-256 hashes 16 MB in 358 ms in Node (05); in Chromium the same code was slower in IRWB-004's measurements. Sliced, it stays under the task budget; it does not get shorter.
- **Store trust.** A store that a process outside the user's control can write could inject verdicts. Mitigation: §17.4's rule 3 and the audit.
- **Memory.** Per-part caches are `WeakMap`s keyed by frozen objects and die with their revisions; the in-memory task cache is bounded; the manager's execution records shrink with compact correspondences.
- **Overhead on small programs.** Keys and store lookups can cost more than recomputing a 30-statement corpus function. The plan measures corpus wall time at every phase.
- **Verification bookkeeping.** Early cutoff still visits every task of a run to check its recorded dependencies (§18.2), tens of thousands of visits for O2 on Candela. It is proportional to the program with a small constant, like the identity term, and is reported separately.

**What would falsify the approach.**

1. **Per-part results that are not the whole result.** If assembling per-part facts, validation, diffs or correspondences ever gives a value canonically different from the whole-program function's, the decomposition is wrong for that function. The measured independence (01: 222 of 222; 02: equal change sets) says it holds today; summaries (§13.3) are where it could fail.
2. **A work term that grows with the program.** If, on the edit streams of §11.3, `T_rec/R` or `T_case/K` at full Candela exceeds 1.5× its value at 25% after Phase 5, some step is still whole-program, and the component breakdown names it. If the remaining step cannot be made part-sized without changing a revision, the invariant is false for this IR as defined.
3. **Fan-in that makes every edit global.** If typical edits change the closure keys of most functions, the meaning check's cost per edit is proportional to the program whatever the rest does. Candela's medians (10 transitive callers, 01) say this is not typical; leaf edits (`q_floor`, 104 callers) are the bad case. A finer verdict key, the set of functions a case actually executed (a subset of the static closure; sound because evaluation reads only the code it executes, by name), is the experiment that would decide whether that bad case can be fixed.
4. **A store that does not pay.** If a warm store does not make the second O2 run on Candela at least five times faster than the first, or the cold run costs more than 5% extra, persistence is not worth its trust surface.

## 21. Implementation plan

Each phase lands in increments that pass the gate of §19. Times are measured with the scripts of this ticket and IRWB-004, under the memory cap, and compared within one run or back to back (IRWB-004 step 12: runs minutes apart on this machine differ by 2–3×).

| phase | content | acceptance measurement |
|---|---|---|
| **P0. The harness** | `tools/edit-stream.mjs`: the three streams of §11.3 on call-closed Candela subsets, recording R(e), K(e), T_rec by component, T_case and T_id per edit | today's numbers reproduced (03, 04); the baseline curves of `T_rec/R` and `T_case/K` against program size, recorded before any change |
| **P1. Facts per part, on demand** | `solveRegion`, `analysePart`, assembly sharing frozen regions, record ids without hashing values (§13.1); lazy views and `facts: 'on-demand'` (§13.2); per-part preservation (§13.4) | the **first no-change `strength` on Candela r0 under 1 s** in a fresh process (IRWB-004: 4,295 ms); assembled results equal `solveArtifact`'s on the corpus and all Candela O2 revisions |
| **P2. Lazy projection, parts, compact correspondence, validation per part** | §14, §15 | the 2-function `cfg` at r13 without a contract **under 1.5 s** (05: 8,362 ms), with the remainder itemized; `pass.run` (832 ms in 05) is expected to be most of it until P5; `createIRArtifact` of a value sharing all but 2 parts under 150 ms plus the identity term, reported separately (05: 1,792 ms in all); equal change sets, expanded correspondences and validation verdicts on the corpus and Candela O2 |
| **P3. The page in slices** | §16: open and apply in the engine worker, `adopt`, `Program.fromArtifact`, `validateBlocksByParts` in the page | Playwright on port 8779: **no main-thread task over about 100 ms** during Candela open and during `cfg` (IRWB-004: 8,608 ms and 21,319 ms); the page's revision equals the worker's |
| **P4. The persistent store** | §17: `directoryStore`, `indexedDbStore`, toolchain fingerprint, packs, eviction, audit | a second Candela O2 run in a fresh process with a warm store **under 60 s** with an identical report (IRWB-004 local: 3:27); cold overhead under 5%; the browser reopens Candela from IndexedDB with no task over 100 ms; store size per namespace reported |
| **P5. The query engine** | §18: indexed runtime cache with a storage port, the queries, the recording store, `scope: 'function'` passes, per-function origin keys (§12.2) | after a same-length constant edit in one scene function, ingest + O2 + check re-runs only that function's steps and its 11 closure functions' cases (`explainCache` lists exactly them); after a whitespace edit, no `step`, `facts` or `verdict` task runs; the 2-function `cfg` pass costs its two functions' steps plus the identity term; verification bookkeeping per run reported |
| **P6. The invariant** | run P0's harness on the final code | **`T_rec/R` and `T_case/K` at 100% of Candela within 1.5× of their values at 25%** on all three streams; `T_id/N` constant; corpus wall time not worse than before P1 by more than 10% |

The order follows dependence and payoff: P1 and P2 remove the largest measured costs without any new trust; P3 is the user-visible one; P4 needs the keys of P1–P2; P5 needs P4's storage to be worth its bookkeeping; P6 is the claim.

## 22. API reference (Proposed)

```ts
// src/typed/parts.ts
export function codeHash(p: FunctionPart): string;                       // part without ops and locals' `at`
export function codeClosureKey(v: TypedBlocks, f: string): string;       // closureKey over code hashes
export function countersOf(v: TypedBlocks, f: string): Readonly<Record<string, number>>;
export function validatePart(p: FunctionPart, calleeSignatures: Readonly<Record<string, Signature>>): void;
export function validateBlocksByParts(v: TypedBlocks): void;            // same verdict and error as validateBlocks

// src/framework/ir/types.ts — optional adapter members
parts?(value: T): Iterable<{ readonly key: string; readonly object: object }>;
projectPart?(value: T, part: { key: string; object: object }): IRGraph;
partOf?(value: T, entity: string): string | undefined;

// src/framework/ir/adapters.ts, diff.ts, correspondence.ts
export function createIRArtifact<T>(adapter: IRAdapter<T>, id: string, value: T): Artifact<T>;   // no eager projection
export function diffByParts<T>(adapter: IRAdapter<T>, before: Artifact<T>, after: Artifact<T>): ChangeSet;
export interface CompactCorrespondence { formatVersion: 2; from; to; sameParts: readonly string[]; entries: readonly CorrespondenceEntry[] }
export function compactCorrespondence<T>(adapter, before: Artifact<T>, after: Artifact<T>, explicit): CompactCorrespondence;
export function expandCorrespondence<T>(c: CompactCorrespondence, before: Artifact<T>, after: Artifact<T>): EntityCorrespondence;

// src/framework/dataflow/analysis.ts, contracts/analysis-manager.ts
solveRegion(subject: Artifact<S>, region: string, params?: unknown): RegionResult;      // on DataflowAnalysis
analysePart(def, subject, region: string, partKey: string, params?): Promise<RegionResult>;   // on AnalysisManager

// src/framework/contracts/differential.ts — optional spec field
readonly caseKey?: (inputs: PortValues<P>, kase: Case) => string | undefined;   // per-case baseline key (§12.2)

// src/typed/passes.ts — optional spec fields
readonly scope?: 'function' | 'program';
readonly facts?: 'eager' | 'on-demand';

// src/framework/store/ (new)
export interface ContentStore {
  getObject(name: string): Promise<string | undefined>;         // verified against its name on read
  putObject(text: string): Promise<string>;                     // returns the name, SHA-256 of the bytes
  getIndex(ns: string, key: string): Promise<IndexRecord | undefined>;
  putIndex(ns: string, key: string, record: IndexRecord): Promise<void>;
  pin(name: string, objects: readonly string[]): Promise<void>;
  collect(budgetBytes: number): Promise<CollectReport>;
}
export function directoryStore(path: string): ContentStore;     // Node
export function indexedDbStore(name: string): ContentStore;     // browser, in the engine worker
export function toolchainFingerprint(): string;

// src/framework/core/runtime.ts
new Compiler({ maxCacheEntries?: number, storage?: ContentStore });

// src/typed/program.ts, src/framework/ir/adapters.ts (from IRWB-004 §16.6–16.7, not yet built)
Program.fromArtifact(name: string, source: string, r0: Artifact<TypedBlocks>, options): Program;
createIRArtifactAsync(adapter, id, value, { pause }): Promise<Artifact<T>>;
```

## 23. Related work

The design borrows from build systems and incremental computation. Only works whose existence and authorship I am certain of are listed.

- **Mokhov, Mitchell and Peyton Jones, "Build Systems à la Carte", ICFP 2018.** Separates a build system into a scheduler and a rebuilder, and names the properties used here: minimality, early cutoff, cloud (shared) builds, and dynamic dependencies. The task runtime of §9.1 is a suspending scheduler with a verifying-traces rebuilder in their terms; the store of §17 adds what they call a cloud cache.
- **Mitchell, "Shake Before Building: Replacing Make with Haskell", ICFP 2012.** Dynamic dependencies recorded while a rule runs, and early cutoff on unchanged outputs, in a production build system.
- **Acar, "Self-Adjusting Computation", PhD thesis, Carnegie Mellon University, 2005**, and **Hammer, Phang, Hicks and Foster, "Adapton: Composable, Demand-Driven Incremental Computation", PLDI 2014.** Change propagation over a recorded dependency graph; Adapton makes it demand-driven, which is the mode of §13.2 and §18.
- **Pugh and Teitelbaum, "Incremental Computation via Function Caching", POPL 1989.** Memoizing functions on their arguments as a route to incrementality: the `facts` and `step` namespaces are function caches keyed by content.
- **Dolstra, "The Purely Functional Software Deployment Model", PhD thesis, Utrecht University, 2006** (Nix). A store of build results named by hashes of everything that produced them, including the builder; the toolchain fingerprint of §12.3 is the same idea at a coarser grain.
- **Merkle, "A Digital Signature Based on a Conventional Encryption Function", CRYPTO 1987.** Hash trees. Closure keys and summary keys are Merkle-style hashes over the call graph; the revision itself deliberately is not (§2.4).
- **The rustc development guide**, chapters on queries and incremental compilation (project documentation). The red-green algorithm: re-validate the previous session's dependency graph from its inputs, marking queries whose results did not change, so that unchanged results are not recomputed. §18's verification is the same procedure on the existing runtime.
- **Salsa**, the incremental computation library used by rust-analyzer (project documentation). Queries with dynamically recorded dependencies and "backdating" when a recomputed value equals the old one, which is early cutoff; the recording store of §18.4 follows it.
- **Git's object model** (Git documentation): content-addressed objects in a directory named by their hash, written by atomic rename. §17.2's layout is the same.

Two further works are relevant and were not checked for this guide, so they are named only for the reader to verify: ThinLTO's per-module summaries with an incremental cache in LLVM (Johnson, Amini and Li, CGO 2017, as I recall), and Erdweg and colleagues' sound incremental build system with dynamic dependencies (OOPSLA 2015, as I recall).

## 24. Open questions

- **Does the page need to distrust its own worker?** Both run code from the same bundle, under the same origin and policy. Trusting the worker's revision would remove 1.6 s of encoding and hashing from every adoption (05). IRWB-004 chose not to trust it; that decision should be revisited with the numbers of P3.
- **Is the toolchain fingerprint too coarse?** Any rebuild invalidates the persistent store. A per-definition hash (the function's source plus what it imports) would keep results across unrelated changes, at the cost of a dependency analysis of the compiler's own code. P4 should record how often the coarse key invalidates the store during normal development.
- **Should `ops` leave the revision?** Positions are why a blank line changes 154 parts. Storing them per function, relative to the function, would make parts stable under edits elsewhere, but it changes every revision hash and is excluded by this ticket's requirement. Code hashes (§12.1) get the same reuse without it.
- **Finer parts for `tracePath`.** A per-block part would split two thirds of the `ranges` work. Whether dataflow facts can be keyed per block (their inputs cross blocks) is open.
- **Executed-closure verdict keys** (§20, item 3): what fraction of a function's static closure its 40 cases actually execute, and whether keying on it makes leaf edits cheap.

## 25. Where to look

| path | what to read it for |
|---|---|
| `src/framework/core/data.ts` | `canonical`, `immutable`, `fingerprint`, `revisionOf`, `validateOnce` and their caches (§2) |
| `src/framework/core/sha256.ts:108` | the streaming SHA-256 (§2.4, §16) |
| `src/framework/core/runtime.ts:86–914` | the task runtime: `Compiler`, `CompilationRun.resolve`, `execute`, early cutoff at `:741` (§9.1, §18) |
| `src/framework/core/types.ts:4–96` | `Task`, `Pass`, `PassContext` (§9.1) |
| `src/framework/ir/adapters.ts:128–268` | `createIRArtifact`, `validateGraph`, `project` (§4) |
| `src/framework/ir/view.ts:178–341`, `store.ts:12–137` | views and `IRStore` (§4.4, §9.2) |
| `src/framework/ir/diff.ts:13`, `correspondence.ts:49–130` | `diffGraphs`, `validateCorrespondence`, `makeCorrespondence` (§5.2, §15) |
| `src/framework/ir/transactions.ts:41–61` | the edit's eager maps (§15.5) |
| `src/framework/passes/define-pass.ts:190–337` | `applyPass` (§5) |
| `src/framework/contracts/analysis-manager.ts:518–627` | `analyse`, keys and record ids (§6.1) |
| `src/framework/contracts/differential.ts:31–230` | the meaning check's spec, memo, `decideCase` (§7) |
| `src/framework/dataflow/analysis.ts:110–201` | `dataflow`, `solveArtifact`, the transfer verifier (§6.2, §13) |
| `src/typed/model.ts:199–420` | `TypedBlocks`, `Store.from`, `toNative` (§3) |
| `src/typed/parts.ts` | parts, part hashes, closure keys, `PartsRef` (§3.3) |
| `src/typed/ir.ts:93–160`, `:329–410`, `:525–581` | `validateBlocks`, the projection's per-record caches, `storeOf`, `blocksAdapter` (§4, §14) |
| `src/typed/analyses.ts:120–546` | the six analyses and their views (§6) |
| `src/typed/passes.ts:60–218`, `:554–575` | `typedPass`, `revisionCorrespondence`, `strength` (§5.1, §6.5) |
| `src/typed/evaluate.ts:232`, `:587–637` | `casesFrom`, `meaningKept` and its keys (§7) |
| `src/typed/lift.ts:183`, `:476` | positions in ops; ids from per-function counters (§3.1) |
| `site-src/engine-worker.js` | the engine worker (§8, §16) |
| this ticket's `scripts/01`–`06` and `various/01`–`06` | the measurements of Part 1 |

## 26. Glossary

- **Artifact**: an immutable record `{ id, kind, schemaVersion, value, contentHash, revision }` (§2.1).
- **Closure key**: a hash of the code reachable from a function by calls, plus the frame-array flag (§3.3); **code closure key**: the same over code hashes (§12).
- **Code hash**: a function part's hash without its front-end operations and source positions (§12.1).
- **Early cutoff**: not re-running the dependents of a task whose recomputed output equals its previous output (§9.1).
- **Edit stream**: a replayable sequence of edits used to measure the invariant (§11.3).
- **Function part**: the frozen grouping of one function's records in one revision (§3.3).
- **Identity term**: the time to assemble and hash a new revision's text; proportional to the program, small (§2.4, §11.2).
- **Pack**: a same-origin script that carries store objects into the browser (§17.2).
- **Projection**: the entities and relations an adapter derives from a native value; a cache, not part of the artifact (§4).
- **Revision**: SHA-256 of the canonical text of `{ kind, schemaVersion, value }` (§2.2).
- **Toolchain fingerprint**: a hash of the compiler and framework code, part of every persistent key (§12.3).
- **Work sizes**: R(e), the records of the changed parts, and K(e), the cases whose verdict keys changed (§11.2).
