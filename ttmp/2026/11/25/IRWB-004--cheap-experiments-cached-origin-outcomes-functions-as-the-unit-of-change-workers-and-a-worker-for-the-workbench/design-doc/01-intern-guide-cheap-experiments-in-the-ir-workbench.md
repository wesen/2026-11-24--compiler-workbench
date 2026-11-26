---
Title: 'Intern guide: cheap experiments in the IR Workbench'
Ticket: IRWB-004
Status: active
Topics:
    - compiler
    - ir
    - workbench
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: runDifferential; the baseline cache, verdict memo and case executor
    - Path: repo://src/framework/core/data.ts
      Note: canonical text, immutable, hashing and their caches; revisionOf and the fast SHA-256 land here
    - Path: repo://src/framework/passes/define-pass.ts
      Note: applyPass, the gates every pass goes through; the empty-edit shortcut
    - Path: repo://src/typed/evaluate.ts
      Note: meaningKept, the meaning contract
    - Path: repo://src/typed/model.ts
      Note: Store.from and toNative; records keep their identity across a pass
    - Path: repo://src/workbench/candela.ts
      Note: Candela engines and renderProgressive, which move into the engine worker
ExternalSources: []
Summary: 'What a pass on the IR Workbench does from its declaration to a published revision, what each step costs on the 332-function Candela program (measured), and the design of IRWB-004: definition-preserving fixes, the origin''s outcomes cached (D1), functions as the unit of change (F1), and worker threads in Node and a Web Worker in the browser (F4).'
LastUpdated: 2026-11-25T23:45:00-05:00
WhatFor: Onboarding an intern to the framework's execution path and implementing IRWB-004.
WhenToUse: Before changing anything under src/framework, the meaning contract's execution, the Store, or the workbench's Candela view.
---

# Intern guide: cheap experiments in the IR Workbench

This guide explains one path through the IR Workbench in full: what happens between the moment a compiler pass is asked to run and the moment a new revision of the program is published, and what the browser workbench does around it. It then shows, with measurements, what each step of that path costs on a large program, and it lays out the work of milestone IRWB-004, whose purpose is to make that path cheap without changing what it computes.

The guide is self-contained for this path. A broader account of the whole project (the compiler's passes, the backend, strategies, provenance) is the intern guide of IRWB-002, `ttmp/2026/11/24/IRWB-002--research-agenda-*/design-doc/01-*.md`; where this guide summarizes something that guide explains in depth, it says so.

Three conventions hold throughout.

- **Paths are relative to the repository root.** A number after a colon is a line number at commit `420d8e1`, the commit this milestone starts from. Line numbers drift; the symbol next to them does not.
- **Numbers are measurements, with their source.** A source is a diary step (IRWB-001's `log/02-implementation-diary.md`, the UI agent's `log/05-ui-agent-diary.md`, or this ticket's `log/01-irwb-004-diary.md`) or a file under this ticket's `various/`. "Step 12" without a ticket means IRWB-001's implementation diary.
- **Part 1 describes code that exists. Part 3 describes code that does not exist yet**, and marks new interfaces **Proposed**.

# Part 1: The path a pass takes

## 1. What the system is, in one page

The project is a compiler from **Typed**, a statically typed subset of JavaScript, to **RV32** machine code for a small handheld computer. It is built on a framework, **IR Workbench v6**, that treats each step of compilation as inspectable data:

- every version of the program is an immutable **artifact** whose name, its **revision**, is a hash of its content;
- every optimization is a **pass** that declares what it reads and writes, and the framework checks those declarations each time the pass runs;
- every pass application is accepted only if the new program still **means** what the original program meant, judged by running both on generated inputs.

Two workloads exercise this path. The **corpus** is 44 small projects (70 functions in total) inherited from a JavaScript prototype together with a book that states exact numbers for them; those numbers are regression tests. **Candela** is a path-tracing renderer of 332 functions: at r0 it has 2,409 blocks, 12,358 statements and 37,220 values (IRWB-002 guide §16). The corpus is where correctness is established. Candela is where cost becomes visible: every operation that touches the whole program is invisible on a 30-statement corpus program and takes seconds on Candela.

The rest of Part 1 follows one pass application through the code, in the order the code runs:

```text
 Program.apply(pass)                               src/typed/program.ts:248
   └─ applyPass(pass, head, { contract, origin: r0 })   src/framework/passes/define-pass.ts:190
        ├─ openIR(head)                   validate, retain, project        §3
        ├─ manager.analyse(need, head)    the facts the pass reads         §6
        ├─ pass.run(...)                  typedPass: Store.from → body per function → toNative   §4, §5.1
        ├─ createIRArtifact(native)       freeze, validate, hash, project  §2, §3
        ├─ diff, makeCorrespondence       what changed, and how it maps     §3, §5.2
        ├─ verifyTransformation(contract) the meaning check against r0      §7
        └─ preservation claims            the facts the pass says survive   §5.2, §6
```

Read Part 1 in order; each section uses the terms of the ones before it. Part 2 assigns measured time to the steps of this diagram, and Part 3 changes them one by one.

## 2. Artifacts, canonical JSON and revisions

### 2.1 The artifact record

Everything the compiler produces is an artifact (`src/framework/core/types.ts`):

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

The value must be finite JSON: plain records, arrays, strings, booleans, `null` and finite numbers. The restriction is what makes the revision meaningful. Two artifacts with equal content have equal revisions, whoever made them and whenever, so a revision is a name for the program itself, and anything computed from an artifact can be stored under its revision forever without any invalidation logic.

### 2.2 The four functions that implement identity

They are in `src/framework/core/data.ts`:

| function | line | what it does |
|---|---:|---|
| `canonical(value)` | 13 | the one text encoding of a value: record keys sorted, `-0` written as `0`, non-finite numbers, cycles, accessors and non-plain objects refused |
| `immutable(value)` | 78 | a validated, key-sorted, deep-frozen copy; what `JSON.parse(canonical(value))` would give, built without text |
| `fingerprint(value)` | 190 | `sha256(canonical(value))` |
| `sha256(text)` | 147 | a portable SHA-256 in plain JavaScript, so that Node and the browser compute identical hashes |

`createIRArtifact(adapter, id, value)` (`src/framework/ir/adapters.ts:120`) ties them together:

```ts
const snapshot = immutable(value);                       // freeze a canonical copy
adapter.validate(snapshot);                              // the IR's own validator
const artifact = immutable({
  id, kind, schemaVersion, value: snapshot,
  contentHash: fingerprint(snapshot),
  revision: fingerprint({ kind, schemaVersion, value: snapshot }),
});
project(adapter, artifact.value);                        // §3: build and check the logical graph
VERIFIED.add(artifact);
```

**The revision is defined by text.** It is the SHA-256 of one specific string, the canonical encoding of `{ kind, schemaVersion, value }`. Any implementation that produces that same string, or feeds the same bytes to SHA-256 in pieces, produces the same revision. That is the freedom this milestone uses: the definition is fixed, and how the string is assembled is not.

### 2.3 The caches that already exist, and why they are safe

IRWB-001 step 12 made a no-change pass on Candela go from 86 s to 18 s with every revision unchanged. It did so with caches keyed on objects that cannot change:

| cache | where | key | value |
|---|---|---|---|
| `CANONICAL` | `data.ts:7` | an object `immutable` built | membership: deep-frozen and canonical |
| `TEXT` | `data.ts:9` | a canonical object | its canonical text, only when the text is at least `CACHE_MIN` = 4,096 characters (`data.ts:10`) |
| `HASH` | `data.ts:189` | a canonical object | its fingerprint |
| `VERIFIED` | `adapters.ts:114` | an artifact record | membership: its hashes were computed or checked here |
| `PROJECTED` | `adapters.ts:119` | (captured adapter, canonical value) | the value's projection (§3) |

The rule that makes these safe deserves to be stated, because every cache in Part 3 obeys it: **a cache may be keyed only on values that cannot change.** A deep-frozen canonical object cannot change, so its text and hash are fixed; a captured adapter is frozen, and projecting is a deterministic function of the adapter and the value. Such a cache can make a computation faster but cannot make it return something different.

`immutable` has one more property that matters later: given a value that `immutable` itself built, it returns the value unchanged (`data.ts:87`, `if (CANONICAL.has(v)) return v`), and given a new value whose *parts* are canonical, it shares those parts instead of copying them. A new program value that reuses the frozen records of the previous revision therefore costs `immutable` only the work of its new parts.

### 2.4 What the text looks like, and why that matters for hashing

The canonical text of Candela r0's revision record is 18,178,949 characters (this ticket, Step 3). Its outline:

```text
{"kind":"typed.blocks","schemaVersion":"1","value":{
   "blocks":{ "bb:...":{...}, ... },        2,409 records
   "counters":{ ... },                      the id counters
   "fnOrder":[ ... ], "fns":{ ... },        332 function records
   "formatVersion":1, "frontEnd":{ ... },
   "ops":{ ... },                           front-end operations (source anchors)
   "program":"candela", "rev":0,
   "stmts":{ ... },                         12,358 records
   "values":{ ... } }}                      37,220 records
```

Keys are sorted, so `counters` comes second. `scripts/06-text-layout.mjs` measured where each table starts (`various/06-text-layout.json`): `counters` at 3.6% of the text, `ops` from 9.6% to 46.2% (40,916 front-end operations, which almost no pass changes), `rev` at 46.2%, `stmts` after it and `values` from 59.3% to the end. SHA-256 processes its input from the first byte to the last and can resume only from a prefix. Every revision a pass produces changes `rev` and, when it allocates an id, `counters`, so its text differs from its input's within the first 4%, and the hash must process more than 96% of the 18 MB again. Caching hash states does not help. What can help is building the 18 MB string cheaply and hashing it quickly. The plain-JavaScript `sha256` runs at 58 MB/s on this machine, 315 ms for one revision text (this ticket, Step 3).

## 3. Adapters and projection

The compiler's passes are written against plain tables (§4), but the framework's generic machinery (diffing two revisions, checking which kinds of thing a pass changed, building correspondences) must work for any IR. An **adapter** (`IRAdapter`, `src/framework/ir/types.ts`) connects the two: it projects a native value into a graph of **entities** (`{ id, kind, attributes }`) and **relations** (`{ id, kind, category, from, to, order? }`).

```ts
export interface IRAdapter<T> {
  kind: string; schemaVersion: string;
  relationKinds: Record<string, RelationCategory>;
  entities(value: T): Iterable<IREntity>;
  relations(value: T): Iterable<IRRelation>;
  resolve(value: T, entity: string): IREntity | undefined;
  validate?(value: unknown): void;
  rebuild?(base: T, graph: IRGraph): T;     // logical graph back to native storage
  // also describe, roots, operation, serialize, deserialize, visualize
}
```

`project(adapter, value)` (`adapters.ts:215`) enumerates entities and relations, then `validateGraph` (`adapters.ts:171`) checks the graph (unique ids, declared relation kinds, no dangling ends) and returns it sorted, and finally every entity is resolved again through `adapter.resolve` and compared with its enumeration (`adapters.ts:242`). The result is cached in `PROJECTED` when the value is canonical.

The adapter for the main IR is `blocksAdapter` (`src/typed/ir.ts:505`). Its projection of Candela r0 has 103,618 entities and 132,054 relations (this ticket, Step 3): one entity per function, local, block, statement, value and front-end operation, and relations for containment (`declares`, `contains`, `emits`), data dependence (`uses`, `operand`, `reads`), binding (`writes`) and control (`succ`, `jump`).

`openIR(artifact, adapter, store)` (`src/framework/ir/view.ts:182`) returns an `IRView`: it validates the artifact (`validateIRArtifact`, `adapters.ts:141`), retains it in an `IRStore` (`src/framework/ir/store.ts:41`), projects it, and builds a map from entity id to entity. `diff(viewBefore, viewAfter)` (`src/framework/ir/diff.ts:91`) compares two projections entity by entity and relation by relation; the result is the change a pass made, in the framework's vocabulary.

Every one of these operations is proportional to the size of the whole program. A view of Candela holds 235,672 entities and relations; a diff visits all of them.

## 4. The native value and the Store

### 4.1 `TypedBlocks`

The native value of one revision is `TypedBlocks` (`src/typed/model.ts:197`): id-keyed tables `fns`, `blocks`, `stmts`, `values`, `ops`, plus `counters`, `fnOrder`, `frontEnd`, `program` and `rev`. Ids carry the function name (`s:blend.4`, `v:blend.12`, `bb:blend.1`), and every block, statement and value record also has a `fn` field naming its function. Only live entities are stored.

The tables are *program-wide*: there is one `stmts` table holding the statements of all 332 functions. Nothing in the value groups a function's records together, which is why nothing in the framework can currently tell that a pass changed 3 functions and left 329 alone.

### 4.2 `Store`: the mutable working copy

Passes never edit a frozen value. `Store.from(native)` (`model.ts:254`) makes a mutable working copy, a map from id to record, and `store.toNative()` (`model.ts:296`) writes the current state back as a new plain value:

```ts
static from(native) {                     // model.ts:254
  for (const v of Object.values(native.values)) st.add(clone(v));   // clone = structuredClone (model.ts:219)
  ... the same for ops, stmts, blocks, fns
}
toNative() {                              // model.ts:296
  const live = this.liveIds();             // blocks of functions, their statements, values reachable from them
  for (const [id, e] of sorted(this.ents)) // every record, cloned again
    if (live.has(id)) table[id] = clone(e);
  return { formatVersion: 1, program, rev, counters, fnOrder, fns, blocks, stmts, values, ops, frontEnd };
}
```

Two consequences follow, and Part 2 measures both. Every record is cloned twice per pass, 0.3–0.5 s each way on Candela. And after a pass *no record object of the output is shared with the input*, even for the 329 functions the pass did not touch, so every cache of §2.3, which is keyed on object identity, misses on every record.

`storeOf(native)` (`src/typed/ir.ts:499`) is a read-only working store cached per frozen value, used by the evaluator, printing and queries. It is built with `Store.from`, so it also clones everything.

Ids are allocated from counters stored in the value, so running the same pass twice on the same revision allocates the same ids and produces the same revision hash. That determinism is what lets a cache keyed on revisions return the right answer.

## 5. Passes

### 5.1 `typedPass`: the per-function loop

The compiler's passes are declared with `typedPass(spec)` (`src/typed/passes.ts:165`), a thin wrapper over the framework's `definePass` (`src/framework/passes/define-pass.ts:97`). A spec names the write kinds (`values`, `stmts`, `locals`, `cfg`), the analyses it needs and the analyses it claims to preserve, and a `body({ st, f, tx, facts, params })` that runs once per function. The wrapper's `run`:

```ts
run({ before, facts, params }) {                       // passes.ts:183
  const st = Store.from(before.value), rev = before.value.rev + 1;
  for (const f of st.fns.values()) {                   // every function, always
    const views = { ...fact views for f... };
    const tx = new Tx(st, f, { name, writes }, rev);
    spec.body({ st, f, tx, facts: views, params });
    tx.commit();
    if (tx.edits.length) { edits.push(...tx.edits); touched.push(f.name); }
  }
  if (!edits.length) return;                           // nothing changed: no native result
  st.rev = rev;
  const native = st.toNative();
  return { native, correspondence: revisionCorrespondence(before.value, native, edits), edits: edits.length,
           report: { pass, rev, edits, fns: touched, kinds } };
}
```

The `report.fns` list is exact: it names the functions whose transaction recorded an edit. On Candela, `cfg` at r7 touched 3 functions of 332 (this ticket's O2 baseline, `various/04-candela-o2-baseline.json`). The rest of the pipeline does not use that information.

`Tx` (`src/typed/tx.ts:165`) is the transaction a body edits through. Each method checks that the pass declared the write kind it uses, and each created entity gets an origin record saying what it was made from, by which pass, and why. The IRWB-002 guide §9.2 describes it. For this milestone the important fact is that `Tx` and pass bodies mutate the records the `Store` returns *in place*: `st.get(id)` returns a mutable record, and callers may assign to its fields.

### 5.2 `applyPass`: the gates

`applyPass(pass, before, options)` (`define-pass.ts:190`) is where the framework enforces a pass's declarations. Here is what it does, with the code's own order:

```text
applyPass(pass, before, { manager, contract, contractInputs: { origin } }):
  view   <- openIR(before)                                           :196
  facts  <- for each need: manager.analyse(need, before)             :199   cached per revision
  edit   <- view.beginEdit()                                         :204
  result <- pass.run({ before, view, facts, params, edit })          :207
  if result has a native value:                                      :221
      after   <- createIRArtifact(adapter, id, result.native)       :224
      changes <- diff(view, openIR(after))                           :226
      corr    <- makeCorrespondence(before ids, after ids, result.correspondence)   :227
  else:                                                              :236
      prepared <- edit.prepare()          rebuild from the projection, create the artifact, diff, correspond
      after, changes, corr <- prepared
  if after.revision = before.revision and nothing changed:  return { changed: false }    :245
  if changes touch kinds outside pass.writes:   throw PassError('undeclaredWrite')       :255
  if contract: manager.verifyTransformation({ input: before, origin }, { output: after },
                                            contract, [corr])
               on failure: throw PassError('contractRejected')                           :265
  for each analysis A in pass.preserves that the manager holds for `before`:
      A's own transfer verifier, or recompute A on `after` and compare canonical values  :290
      on difference: throw PassError('preserveViolated')
  return { changed: true, artifact: after, changes, correspondence: corr, preserved, contract, report }
```

Two details matter for cost.

- **A pass that changes nothing still prepares an edit.** When `typedPass.run` returns nothing, `applyPass` takes the `else` branch: `Edit.prepare()` (`src/framework/ir/transactions.ts:295`) validates the (unchanged) projection, rebuilds a native value from it (`rebuildBlocks`, `ir.ts:388`), creates an artifact from that value, projects it, checks the round trip, diffs it against the input and builds a correspondence. All of it to find out that nothing changed. The empty edit has no operations, and its result is known in advance: the projection and `rebuild` are exact inverses, which `tests/typed/ingest.test.mjs:49` checks on every corpus program and `tests/typed/tape.test.mjs:52` on a tape-ingested one.
- **`makeCorrespondence` is proportional to the program, not the change.** It produces one entry per entity of either revision (`retained`, `removed` or `inserted`), 103,618 on Candela, and `validateCorrespondence` (`src/framework/ir/correspondence.ts:49`) sorts the entries by their canonical text, encoding each entry about log₂(10⁵) ≈ 17 times during the sort.

## 6. Analyses

An **analysis** is a versioned function from an artifact to a JSON value, declared with `defineAnalysis` and computed by `AnalysisManager.analyse(definition, artifact)` (`src/framework/contracts/analysis-manager.ts:518`), which caches the record for the exact revision. The Typed compiler's six analyses (`ANALYSES`, `src/typed/analyses.ts`) are `cfg`, `dominators`, `loops`, `liveness`, `reaching` and `ranges`. Each is computed per function, and the result is a record keyed by function name. Nothing crosses a call (IRWB-002 guide §17).

Before an analysis or a check runs, the manager validates its ports: `validatePorts` (`analysis-manager.ts:1071`) calls `validateArtifact` (`src/framework/contracts/definitions.ts:278`) on every artifact port, which runs the IR's validator (`validateBlocks`, `ir.ts:92`) and recomputes both hashes. The VERIFIED set of §2.3 is not consulted here.

## 7. The meaning contract

### 7.1 From `Program.apply` to `runDifferential`

Every pass application runs under `optimizationContract(params)` (`passes.ts:221`): a transformation contract with inputs `{ input, origin }`, output `{ output }`, and one `ensures` condition, the invariant `typed.meaning-kept` returned by `meaningKept(params)` (`src/typed/evaluate.ts:564`). The origin is always r0, so the comparison is against the original program, never against the previous revision.

`meaningKept` is built with the framework's `differential(spec)` (`src/framework/contracts/differential.ts:70`), which packages a sampled check as an ordinary invariant. Its spec, abridged:

```ts
differential({
  id: 'typed.meaning-kept', version: `1+${hash(key)}`,     // key = canonical JSON of { count, seed, inputs, limit, roots? }
  baseline: 'origin', subject: 'candidate', count, seed, random: rng,
  cases: ({ origin }) => (roots ?? every function of origin)
                           .flatMap(fn => casesFrom(storeOf(origin.value), fn, { count, seed, inputs })),
  run: (_side, art, c) => evaluate(storeOf(art.value), c.fn, c.args, c.memory, { limit }),
  inconclusive: r => r.limit,
  compare: (expected, got, c) => agrees(expected, got) || { ok: false, reason: ... },
})
```

When the manager checks the invariant, `runDifferential` (`differential.ts:102`) does this:

```text
cases <- spec.cases(inputs, random(seed), count)        13,280 cases for Candela (40 × 332)
for each case, in order:
    a <- spec.run('baseline', origin, case)            evaluate r0
    b <- spec.run('subject', candidate, case)          evaluate the candidate
    if a or b hit the step limit:  inconclusive
    else if compare(a, b):          agree
    else:                           disagree, keep the first five counterexamples
status <- disagree ? 'disagree' : agree ? 'agree' : 'inconclusive'
```

The evidence is `{ method: 'sampled', seed, total, agree, disagree, inconclusive, status, counterexamples }`. A check with no decided case fails.

### 7.2 What is recomputed on every pass

Within one pipeline the origin, the seed, the count and the inputs never change. So `cases` returns the same 13,280 cases for every pass, and `run('baseline', …)` returns the same 13,280 outcomes. Both are recomputed after every pass. That is item D1 of the research agenda.

The candidate side has a subtler redundancy. The outcome of a case of function `f` on the candidate depends only on the code the evaluator can reach from `f`, that is `f` and the functions it calls, directly or not, and on one program-wide flag (§7.3). A pass that changed 3 functions leaves most functions' reachable code unchanged, and their outcomes equal those of the previous revision, which already agreed with r0 under the same contract.

### 7.3 The evaluator, and what an outcome depends on

`evaluate(st, fname, args, memBytes, { limit })` (`evaluate.ts:345`) interprets `typed.blocks`. It reads records only through `st.get(id)` and `st.fn(name)`, follows calls by name, and is deterministic. One input is program-wide: if any function of the program has frame arrays (`arrayBytes`), the evaluator adds a 64 KiB stack area above guest memory (`evaluate.ts:356–358`), which changes the memory size and the addresses frame arrays get. So an outcome is a function of exactly these inputs:

- the case: function name, arguments and initial memory;
- the step limit;
- the records of the functions reachable from the case's function by calls;
- whether the program has any frame arrays.

`agrees(expected, got)` (`evaluate.ts:531`) is the verdict for one case. IRWB-005 owns how cases are generated (`casesFrom`, `evaluate.ts:230`) and how verdicts are decided (`agrees`); this milestone changes neither.

### 7.4 The manager's share

`verifyTransformation` (`analysis-manager.ts:1538`) wraps the check in a transaction with its own bookkeeping. Three parts of it cost whole-program work for the meaning check:

- `validatePorts` validates and re-hashes `input`, `origin` and `output` (§6);
- `invariantInternal` computes a key for cycle detection as `fingerprint({ definition, inputs })` (`analysis-manager.ts:1120`), where the inputs are two whole artifacts: their texts are concatenated and 36 MB are hashed;
- every execution record, including its correspondence of 103,618 entries, is kept in `manager.executions` (`analysis-manager.ts:1227`) for the life of the manager. Together with the revisions and their analyses, this is what a long pipeline accumulates: the O2 run's resident memory grew from 1.4 GB after the first pass to 5.3 GB after the last (`various/04-candela-o2-baseline.json`, `rssMB` per step).

## 8. The program host and the browser workbench

### 8.1 `Program`

`Program` (`src/typed/program.ts:80`) holds one program's history: an `AnalysisManager` and an array of revisions. Its constructor lifts the source and creates r0 with `createIRArtifact` (`program.ts:103`). `apply(pass)` (`program.ts:248`) runs `applyPass` under the contract with `origin` bound to r0 and pushes a revision if the program changed. `runPipeline(origin, names, options)` (`src/typed/project.ts:93`) applies a list of passes in order the same way; `tools/candela-o2.mjs` uses it.

### 8.2 The page

The browser workbench (`site-src/`, bundled by `tools/build-site.mjs`) runs everything on the page's main thread. The `wb` object (`src/workbench/workbench.ts`) holds the open project; `wb.projects.open(id)` builds the project's `Program` synchronously (`kernelFor`, `src/workbench/projects.ts:246`).

The **Candela view** (`site-src/candela.js`) renders the gallery's scenes. Its engines (`src/workbench/candela.ts`):

| engine | function | what it runs |
|---|---|---|
| `kernel`, `stock` | `referenceEngine` (`:105`) | the reference compiler's RV32 image on the vendored RV32 interpreter |
| `r0` | `evaluatorEngine` (`:134`) on `liftCandela` (`:128`) | this compiler's evaluator on the lifted program, without making a `Program` |
| `head` | `evaluatorEngine` on the open project's head | the evaluator on a revision the user made |
| `own` | `imageEngine` (`:152`) | this compiler's own RV32 image of r0 or of the head |

`renderProgressive(host, scene, opts)` (`:219`) reproduces the gallery's `renderScene` pattern exactly: a full-row span at stride 1, one span per pixel otherwise, pass p at frame index 0 then p + 1, colour summed per pixel in f32. It yields to the page between spans. `compareFrames` (`:324`) counts output floats whose bits differ between two frames.

The page has a strict content security policy (`site-src/index.html:6`): `script-src 'self' 'unsafe-eval'`, `connect-src 'none'`. With `connect-src 'none'`, nothing can be fetched; the Candela program, its scene table and the reference compiler arrive as `<script>` tags with subresource-integrity hashes that the build computed after checking each file against its `VENDOR.json` (`site-src/candela.js:42`, `UI.loadCandela`).

# Part 2: What it costs

## 9. One pass on Candela, measured

`various/02-framework-cost-baseline.json` and its profiles (this ticket, Step 3) measure Candela r0 on the base commit. The table below assigns the time of the two passes to the steps of §5.2. Times are from profiles of each pass run alone; the machine was shared with other agents, and repeated runs differ by about 20%.

| step | `strength` (no change) | `cfg` (110 functions) | why it costs this much |
|---|---:|---:|---|
| `Edit.prepare` of the empty edit | 11.0 s | — | rebuilds, re-creates, re-projects, re-diffs an unchanged program |
| analyses the pass needs | 1.9 s (`ranges`) | — | computed once per revision |
| `openIR` of input and output | 1.0 s | 1.0 s | `IRStore.retain` re-hashes the revision text |
| `typedPass.run` | 0.5 s | 0.9 s | `Store.from` and `toNative` clone every record |
| `createIRArtifact` | (inside prepare) | 3.3 s | every record is new after a pass: `immutable` 3.1 s, two fingerprints 2.5 s |
| `project` | (inside prepare) | 1.7 s | every entity is built and checked again |
| `diff` | (inside prepare) | 1.4 s | every entity and relation is encoded twice to compare |
| `makeCorrespondence` | (inside prepare) | 1.8 s | one entry per entity, sorted by canonical text |
| the contract: evaluation | — | 3.4 s | r0 and the candidate on 13,280 cases |
| the contract: cases | — | 0.7 s | `casesFrom` for 332 functions, again |
| the contract: bookkeeping | — | 2.7 s | the invariant key hashes 36 MB; `validatePorts` re-validates and re-hashes |
| **wall time** | **13.3–15.9 s** | **18.6–25.2 s** | |

What the table says, in one sentence: almost none of this time is spent on the change. It is spent on recomputing, for the whole program, facts that the previous step already established or that are fixed for the whole pipeline.

The O2 run shows a second effect that the single-pass table cannot. Pass times grow as the pipeline proceeds: `cfg` took 18.8 s at r1 and 96.4 s at r13, where it changed 2 functions (`various/04-candela-o2-baseline.json`). Each pass does the same whole-program work whatever it changes, so the growth points to the heap rather than to the passes: every revision, every analysis result and every contract execution with its 103,618-entry correspondence stays alive in the run and its manager (§7.4), resident memory grew from 1.4 GB to 5.3 GB over the run, and garbage collection must scan all of it. This is an inference from the two series, not a measurement of garbage-collection time; the after-measurements test it. Sharing records between revisions (§14) reduces both the work and the heap.

## 10. The larger runs, measured

| run | time | source |
|---|---:|---|
| a no-change pass on Candela r0 | 18,195 ms (86,423 before step 12's caches) | IRWB-001 step 12 |
| `cfg` on Candela r0 | 30,861 ms | IRWB-001 step 12 |
| `createIRArtifact` on Candela r0 | 5,027 ms | IRWB-001 step 12 |
| the `cfg` analysis on Candela r0 | 1,184 ms | IRWB-001 step 12 |
| O2 on Candela, 16 passes, 13 revisions | 19 min; 1,129 s for the passes; 5.8 GB peak | IRWB-001 step 16 |
| O2 on Candela, pass by pass, at `420d8e1`, without the final check | 12 min 6 s; 721 s for the passes; 5.79 GB peak; a pass took 18.8 s at r1 and 96.4 s at r13 | this ticket, Step 4 (`various/04-candela-o2-baseline.json`) |
| one per-scene specialization run | 2.4–5.9 min; 75 min for 18 scenes | IRWB-001 step 26 |
| the ordering search over 44 projects | 21 min | IRWB-002 guide §12.1 |

And in the browser (the UI agent's diary, steps 7–10):

- **Opening Candela as a project** holds the page for about 10 s (9,730 ms measured). The cost is `createIRArtifact` hashing r0: 12,726 ms in Node by the UI agent's measurement (step 7).
- **A pass on Candela in the page** (`cfg`) took about 45 s, all on the main thread; the check, 332 functions × 40 cases on the evaluator, is the larger part (step 10).
- **A stride-1 render** holds the page for up to 911 ms per row (step 9). Splitting a row into smaller spans would let the page breathe, but it changes how the renderer groups pixels, and on scene V-03 that changed the output bits of 36 of 180 compared floats (step 6). So the row must stay one engine call; the call must move off the main thread.
- **A preview at stride ≥ 2** pays about 2 ms per engine call in memory copies in `referenceRun` and `CandelaHost.call` (step 6).

## 11. What the constraints allow

The brief for this milestone fixes three things, and each shapes the design.

1. **Revision hashes must not change.** Every artifact revision stays bit-for-bit identical: the 44 corpus projects' r0, O2 and image revisions (`ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs`), Candela's r0 and its O2 revisions. Since the revision is the hash of a fixed text (§2.2), the design may change how the text is assembled and how fast it is hashed, and nothing else about it.
2. **The pass-authoring API stays source-compatible**: `definePass`, `typedPass`, `Tx`, `BodyContext`, `TypedPass`, `Program.apply`, `pipeline`. In particular `BodyContext.st` stays a `Store` whose `get` returns records a pass may mutate.
3. **Which cases the contract runs and how verdicts are decided stay as they are** (`casesFrom`, `agrees`; IRWB-005 owns them). The design may decide *where* and *whether* an outcome is computed, but every check must produce the same evidence: the same totals, the same counts, the same counterexamples in the same order.

# Part 3: The design

## 12. The principle

Every cost in §9 has the same shape. A step computes something about the whole program, and the next pass computes it again, because the object it was computed from is new even though its content is not. The design therefore does not invent new identities. It makes the existing ones survive:

- **A record that a pass did not change stays the same frozen object** in the next revision. Then every cache keyed on frozen objects (text, hash, projection, validation) hits for it, and only the changed records are encoded, validated and projected.
- **A function whose records all survived is the same function part** (§14.3), so facts about the function as a whole (its hash, its validation, the outcomes of its cases) can be keyed on it.
- **Work that is fixed for a pipeline is done once per pipeline**: the cases and r0's outcomes are keyed on r0's revision (§15).
- **Work that is independent runs in parallel**, and its results are merged in a fixed order, so scheduling cannot change them (§16).

None of this changes the revision's definition. The canonical text of a value is still the same string; it is only assembled from cached pieces, and hashed faster.

The cache rule of §2.3 applies to every cache below: **a cache is keyed only on values that cannot change**: a frozen canonical object, a captured adapter, a revision hash, or a content hash computed from such values.

## 13. Fixes that keep the definition

These are small and independent, and each removes one line of §9.

| fix | where | what changes | what stays identical |
|---|---|---|---|
| **A1. The empty edit is the identity.** | `applyPass` (`define-pass.ts:236`) | when `run` returns nothing and the edit recorded no operation, return `{ changed: false, artifact: before }` without `Edit.prepare` | the result: an edit with no operations rebuilds a value canonically equal to its base (the projection–rebuild round trip, tested on the corpus) |
| **A2. A revision is hashed once per value.** | `data.ts`: **Proposed** `revisionOf(kind, schemaVersion, value)`; used by `createIRArtifact`, `validateIRArtifact`, `IRStore.#snapshot`, `validateArtifact` | the revision hash is cached per frozen value | the hash: `revisionOf` returns `fingerprint({ kind, schemaVersion, value })` |
| **A3. A value is validated once per validator.** | `data.ts`: **Proposed** `validateOnce(validator, value)`; used by `createIRArtifact`, `validateIRArtifact`, `validateArtifact` | a frozen value a validator accepted is not validated again by it | the verdict: validators are deterministic, and a frozen value cannot change |
| **A4. The invariant's cycle key names revisions.** | `invariantInternal` (`analysis-manager.ts:1120`) | the key fingerprints `{ definition, inputs }` with each artifact replaced by `{ id, kind, schemaVersion, revision }` | cycle detection: two artifacts are the same input exactly when these fields are equal; the key is used only on the frame stack |
| **A5. Sort keys are computed once.** | `validateCorrespondence` (`correspondence.ts:49`) | each entry's canonical text is computed once and the entries are sorted by it | the order: the same comparator on the same strings |
| **A6. SHA-256 is fast.** | `data.ts` `sha256`, a new `core/sha256.ts` | in Node, `node:crypto` (found with `process.getBuiltinModule`, no import); elsewhere a faster portable implementation that streams the text through `TextEncoder.encodeInto` | the digest |
| **A7. Two hashes, one text.** | `createIRArtifact` | `contentHash` and `revision` are computed from one encoding of the value: the revision text is `{"kind":K,"schemaVersion":S,"value":` + value text + `}` | both digests |

A measurement already supports A6. `scripts/05-sha256-bench.mjs` hashes an 18 MB text and 400 random texts (with non-ASCII characters and lone surrogates) three ways; all three agree on every text, and on the 18 MB text the current implementation takes 469 ms (38 MB/s), the streaming portable one 179 ms (101 MB/s) and `node:crypto` 24 ms (750 MB/s) (`various/05-sha256-bench.json`; the O2 baseline was running on the same machine).

A2's proof obligation is worth writing down, because A2 is what lets the rest of the design call `revisionOf` freely:

```text
revisionOf(kind, schemaVersion, value):
  if value is canonical (immutable built it):
      return REVISIONS[value][kind, schemaVersion]  or compute, store and return it
  return sha256(canonical({ kind, schemaVersion, value }))
compute:
  text <- canonical(value)                         cached per record (§14.2)
  return sha256('{"kind":' + JSON(kind) + ',"schemaVersion":' + JSON(schemaVersion) + ',"value":' + text + '}')
```

The concatenated string is exactly `canonical({ kind, schemaVersion, value })` whenever `kind` and `schemaVersion` are strings: `canonical` sorts the three keys into this order and encodes strings with `JSON.stringify`. When they are not strings, `revisionOf` falls back to `fingerprint`.

## 14. F1: functions as the unit of change

### 14.1 Records keep their identity across a pass

The `Store` must keep returning mutable records from `get`, because pass bodies and `Tx` assign to their fields (§5.1, §11). So the copy at the start of a pass stays. What changes is the end:

```text
Store.from(native):                                       model.ts
    st.base <- native                                     the frozen input
    for every record r of native:  st.add(copy(r))        copy: a plain JSON deep copy, not structuredClone

st.toNative():
    for every live record w of the store:
        b <- st.base's record with w's id                  (absent for a new id)
        out[w.id] <- (b exists and same(w, b)) ? b : copy(w)
    the same for each function record (with its block ids), counters, fnOrder, frontEnd
```

`same(w, b)` is structural equality of two JSON-shaped values: the same own keys, equal primitives (`0` and `-0` are equal, as `canonical` writes both as `0`), equal arrays and records recursively. A record whose content survived the pass is replaced by the frozen original, so the output shares every unchanged record with the input. A record with a property set to `undefined` is never `same` as one without it, so `immutable` still rejects it as before.

The copy function is a plain recursive copy of records, arrays and primitives. `structuredClone` has a large per-call overhead for small objects; it was 1.7 s of self time in the first profile of this ticket's Step 3.

**What the reader should notice:** `toNative` now returns a value whose records are, for most of the program, frozen objects that `immutable` built earlier. `immutable` returns those unchanged (§2.3), so freezing the new value costs only its new records and its new tables.

### 14.2 Per-record caches and identity fast paths

With records shared, four whole-program operations can skip what did not change.

- **Text.** `canonical` caches the text of canonical objects of 4,096 characters or more (`data.ts:10`). A record is a few hundred characters, so today every record is encoded again for every new revision. The design adds a second threshold: canonical objects of 64 characters or more also keep their text. Encoding a new revision then costs one cache lookup per unchanged record, plus the join of the tables. Memory grows by roughly the size of the text of the live records, about 18 MB for Candela, shared by all revisions that share the records.
- **Entities and relations.** `blocksEntities` and `blocksRelations` (`ir.ts:323`, `:353`) build every entity and relation from the records. A `WeakMap` from a frozen record to its entity (and to its relations) makes them build only for new records. The projection is still sorted and validated as a whole, but its pieces are shared objects.
- **Validation of a graph.** `validateGraph` (`adapters.ts:171`) checks each entity with `validateEntity`. A `WeakSet` of entities already validated (frozen canonical objects) skips the check for shared entities.
- **Diff.** `diffGraphs` (`diff.ts:13`) compares an entity's two versions by encoding both. Two versions that are the same object are equal without encoding them: `old === current || canonical(old) === canonical(current)`.

### 14.3 Function parts

A **function part** is a derived, frozen grouping of one function's records in one revision:

```ts
interface FunctionPart {                            // Proposed, src/typed/parts.ts
  readonly name: string;
  readonly fn: FnRec & { blocks: readonly string[] };   // the record in value.fns
  readonly blocks: readonly BlockRec[];              // the function's records of each table, in id order
  readonly stmts: readonly StmtRec[];
  readonly values: readonly ValueRec[];
  readonly ops: readonly OpRec[];
}
partsOf(value: TypedBlocks): ReadonlyMap<string, FunctionPart>   // cached per frozen value
```

`partsOf` groups the records of the five tables by their `fn` field. It is not part of the canonical value and does not affect any hash. Its one property that matters is **identity stability**: when every record of function `f` in a new value is the same object as in an earlier value, and `f` has the same number of records, `partsOf` returns the earlier part object for `f`. The check is cheap: the function record of an unchanged function is itself a shared object, so a `WeakMap` from function record to part finds the candidate, and an element-by-element identity comparison of its arrays confirms it.

A part's **hash** is the SHA-256 of the canonical text of `[fn, blocks, stmts, values, ops]`, computed once per part object. Because parts are identity-stable, a revision that changed 3 functions hashes 3 parts.

A part's **callees** are the `imm` of its `call` values. The **closure key** of function `f` in a value is the SHA-256 of the sorted lines `name:partHash` over every function reachable from `f` by calls, plus whether the program has frame arrays (§7.3). Two values in which `f`'s closure key is equal evaluate every case of `f` identically, because the closure key covers every input of an outcome that §7.3 lists except the case and the step limit, which are fixed by the contract.

```text
closureKey(value, f):
    seen <- reachable(f) over callees(partsOf(value).get(g)) for each g
    lines <- sort([ g + ':' + partHash(part(g))  for g in seen ])
    return sha256(lines.join('\n') + '\nframes:' + anyFunctionHasFrameArrays(value))
```

A function that calls a function the program does not define gets the line `g:missing`, so a removed callee changes the key.

### 14.4 Validation per function

`validateBlocks` (`ir.ts:92`) is 0.6 s on Candela and runs for every new revision. Nearly all of it is per function: a function's blocks belong to it, its statements' operands are its values, its value trees are acyclic, and its operators get operands of the right types. Two checks look outside the function: a call must name an existing function with matching parameter and result types, and `fnOrder` must list every function. The design validates each part on its own, memoized on the part object together with the signatures of the functions it calls, and performs the program-wide checks (header, `fnOrder`, orphan records whose `fn` names no function) on every call. A revision that changed 3 functions validates 3 parts.

### 14.5 What remains proportional to the program

Some work stays linear in the size of the program after F1, and it is better to say so than to hide it:

- building the five tables of a new value (about 100,000 keys on Candela) in `toNative` and `immutable`;
- comparing every working record with its original in `toNative` (`same`);
- joining the cached texts into the 18 MB revision text and hashing it, twice (§2.4: hashing less is impossible without changing the definition);
- sorting and checking the projection, and building a view's entity map;
- one correspondence entry per entity (`makeCorrespondence`, §5.2).

Each of these is a loop of cheap operations, not an encoding or a validation. The diary's measurements, from Step 5 on, report what they cost.

## 15. D1: the origin's outcomes, and outcomes that did not change

### 15.1 Cases and the baseline, once per origin

The framework's `differential` gains one optional field:

```ts
interface DifferentialSpec<P, Case, Outcome> {              // differential.ts, additions Proposed
  ...
  /** When cases and baseline outcomes are a function of the spec and this key (e.g. the baseline's revision). */
  readonly baselineKey?: (inputs: PortValues<P>) => string | undefined;
}
```

`runDifferential` then caches, under `id@version#seed#count#baselineKey`, the generated cases and the baseline's outcome for each case. For `typed.meaning-kept` the key is the origin's revision: its `cases` reads only the origin, and its version already contains every parameter (`count`, `seed`, `inputs`, `limit`, `roots`). A second pass in the same pipeline evaluates the candidate only.

The cache holds a few entries (one per origin in use), because each holds every case's memory image and every baseline outcome's memory: for Candela, 13,280 of each, a few kilobytes apiece.

### 15.2 Verdicts that did not change

The second optional field lets a spec say which cases share inputs on the subject side:

```ts
  /** A key such that every case with an equal key gets the same subject outcome (e.g. the function's closure key). */
  readonly subjectKey?: (subject: PortValue<P[keyof P]>, kase: Case, inputs: PortValues<P>) => string | undefined;
```

For `typed.meaning-kept`, `subjectKey(candidate, c) = c.fn + '#' + closureKey(candidate.value, c.fn)`. `runDifferential` keeps a memo from `(baseline cache key, case index, subject key)` to the case's decided verdict: agree, inconclusive, or disagree with its reason. Before evaluating a case it looks up the memo; on a hit it replays the verdict.

**Why the evidence is identical.** A verdict is `compare(baseline outcome, subject outcome, case)`, or inconclusive when either outcome hit the step limit. The baseline outcome is fixed by the baseline key and the case. The subject outcome is fixed by the subject key and the case (§14.3). So the memoized verdict is the verdict a fresh evaluation would produce. Replaying the verdicts in case order reproduces the totals, the counts and the first five counterexamples in the same order. A case whose evaluation throws (an error, not a trap) is never memoized, so it throws again as before.

This is the second half of agenda item D1, without its call graph prerequisite: a pass that changes 3 functions re-evaluates only the cases of functions whose closure contains one of the 3.

## 16. F4: parallel execution

### 16.1 The case executor

`runDifferential` is synchronous and stays so for its direct callers. The invariant's check becomes asynchronous when a spec supplies an executor:

```ts
  /** Decide these cases, e.g. on worker threads; must return what run, inconclusive and compare would. */
  readonly decide?: (inputs: PortValues<P>, cases: readonly Case[], todo: readonly number[])
                    => Promise<readonly Decided[]> | undefined;
type Decided = { readonly v: 'agree' } | { readonly v: 'inconclusive' } | { readonly v: 'disagree'; readonly reason: string };
```

The order of work in a check is: generate or reuse the cases (§15.1), look up the memo (§15.2), hand the remaining indices (`todo`) to `decide` if it returns a promise, otherwise evaluate them in process, merge all verdicts by case index, store the new ones in the memo, and count. Because merging is by index, the evidence does not depend on which worker decided which case or in what order.

`typed.meaning-kept` reads the executor from a module-level setting, **Proposed** `setMeaningExecutor(executor | null)` in a new `src/typed/meaning-exec.ts`, so the check objects cached per parameter set (`evaluate.ts:551`) do not capture it and the definition's version does not change.

### 16.2 Mirroring programs by parts

A worker must evaluate the candidate and the origin. Sending a whole Candela value through `postMessage` costs a structured clone of about 235,000 objects on both sides. Parts make this incremental:

```text
main thread, for each worker:  known <- set of part hashes the worker holds
send(value):
    parts <- partsOf(value)
    missing <- [ (hash(p), text(p)) for p in parts if hash(p) not in known ]      text: the part's canonical JSON
    post { type: 'program', key: revision, header, fns: [ (name, hash) ... ], parts: missing }
worker:
    for (hash, text) in parts:  PARTS[hash] <- freeze(JSON.parse(text))
    PROGRAMS[key] <- a read-only Store over the records of PARTS[hash] for each function
```

The part text is the canonical text that §14.3 already built to hash the part, so sending it costs a string copy. A second revision that changed 3 functions sends 3 parts. The worker builds its store without copying records, because it never mutates them; a read-only store needs only the id map and the function records with their block lists.

### 16.3 The Node pool

**Proposed** `src/typed/parallel/node-pool.ts` creates `n` `worker_threads` (default `min(4, cores − 1)`, the machine-sharing rule of this milestone) running `src/typed/parallel/worker.ts`. Its `decide(inputs, cases, todo)`:

1. groups `todo` by function;
2. assigns each function to a worker by a fixed assignment (round-robin over functions sorted by name, refined by measured cost once known), so that each worker keeps the cases and origin outcomes of its functions cached;
3. mirrors the origin and the candidate to each worker that needs them (§16.2);
4. posts one `decide` message per worker: the spec parameters (`count`, `seed`, `inputs`, `limit`, `roots`), the two program keys, and the list of `(function, case numbers)`;
5. each worker regenerates its functions' cases with `casesFrom` from its mirror of the origin (deterministic), evaluates the origin (cached) and the candidate, and returns one `Decided` per case;
6. merges by index.

The worker runs exactly the functions the main thread would run (`casesFrom`, `evaluate`, `agrees`, `outcome`), imported from the same `dist/` files.

### 16.4 Independent runs

Per-scene specialization (IRWB-001 step 26) and the ordering search (IRWB-002 guide §12.1) are lists of independent runs, each a fresh `Program` and a pipeline. **Proposed** `tools/run-pool.mjs` runs a list of jobs, each `{ module, export, args }`, on up to `n` worker threads and returns their results in job order. Each worker has its own heap, limited with `resourceLimits.maxOldGenerationSizeMb`, so the memory of four Candela runs is bounded per run.

### 16.5 The browser's engine worker

The page gets one dedicated Web Worker, the **engine worker**, that runs the Candela engines, opens Candela, applies passes to it, and runs the meaning check. The main thread keeps the `wb` object and its `Program`s, and stays responsive.

**Bundle.** `tools/build-site.mjs` builds `dist/site/engine-worker.js` with esbuild from **Proposed** `site-src/engine-worker.js`. The vendored scripts the engines need (`tape.js`, `typed-wasm.js`, `rv32-interp.js` and the four `typed-rv32*.js`) are checked against `vendor/ds-js-os/VENDOR.json` at build time, as today, and their bytes are prepended to the bundle, so the worker never loads a script at run time. The worker receives the Candela data (sources and scene table) from the page in its first message; the page already loaded it with its integrity hash.

**Content security.** The page's policy gains `worker-src 'self'`; nothing else changes. A worker started from a same-origin URL does not inherit the page's `<meta>` policy, so `tools/serve-site.mjs` sends the same policy as an HTTP header for every response, and the worker's code makes no request (it calls neither `fetch` nor `importScripts`). The vendored bytes inside the worker are the bytes the build verified, which is the guarantee the integrity hashes give the lazily loaded scripts.

**Rendering.** The worker runs `renderProgressive` with the same engines and the same span pattern, and posts progress messages with copies of the frame's arrays, at most every 100 ms. A stop request is a message; the render loop yields to the worker's event loop between spans, so it sees the message. The main thread only draws. Since the worker runs the same code on the same inputs, its frames are bit-identical to the main thread's, and the page can check it: render a scene on the main-thread engine and in the worker and `compareFrames` the two.

**The project's revisions.** The `head` and `own` engines need the open project's revision. The worker holds a mirror of it, kept current by the part protocol of §16.2, so after the first transfer only changed parts cross.

### 16.6 Opening Candela and running a pass from the page

A Candela `Program` in the page is built from an r0 that the worker lifted, and its passes are applied in the worker:

```text
open:   worker: ingest + toNative + createIRArtifact (the full cost, off the main thread)
                post the parts' texts and the header in messages of bounded size
        main:   parse each part in its own task; assemble the value; createIRArtifactAsync (§16.7);
                Program.fromArtifact(name, source, r0, options)                      Proposed
apply:  main:   post { apply: pass name, params, contract parameters, base revision }
        worker: applyPass on its mirror, under the same contract; post the changed parts,
                the report, the evidence, the change set and the explicit correspondence entries
        main:   rebuild the new value from the base and the changed parts; createIRArtifactAsync;
                check that its revision equals the worker's; push the revision
```

The main thread never trusts a hash it did not compute: it recomputes the revision from the value it built and compares it with the worker's. A mismatch is an error, and the revision is not pushed.

### 16.7 Time-sliced artifact creation

**Proposed** `createIRArtifactAsync(adapter, id, value, { pause })` returns the same artifact as `createIRArtifact`, doing its work in slices with `await pause()` between them: `immutable` table by table in chunks of records, validation part by part (§14.4), and the text and the hash in chunks through the streaming SHA-256. On the main thread `pause` yields to the page (a `MessageChannel` round trip) once a slice has run for about 30 ms. It does not project eagerly; the projection, a cache, is computed when a view first needs it.

## 17. F2: not in this milestone

A persistent content-addressed store would make a second run of Candela O2 nearly free. It is not built here: the brief makes it conditional on D1, F1 and F4 being complete and cheap to extend, and part hashes and closure keys (§14.3) are the identities such a store would need first. The decision is recorded in §20.

## 18. API changes

All changes are additions. Nothing a pass author or a tool calls today changes its signature or its result.

| API | change |
|---|---|
| `IREdit` | `operationCount: number` (read-only), so `applyPass` can recognize the empty edit |
| `data.ts` | `revisionOf`, `validateOnce`, a streaming SHA-256 (`sha256` itself unchanged in output) |
| `DifferentialSpec` | optional `baselineKey`, `subjectKey`, `decide`; `differential()`'s check may return a promise (the manager already awaits it) |
| `typed/parts.ts` | `partsOf`, `partHash`, `partText`, `closureKey` |
| `typed/meaning-exec.ts` | `setMeaningExecutor`, the `MeaningExecutor` interface |
| `typed/parallel/` | the Node pool and its worker |
| `Program` | `Program.fromArtifact(name, source, r0, options)`; an optional remote engine through which `apply` runs |
| `ir/adapters.ts` | `createIRArtifactAsync` |
| `workbench` | the engine worker's client; `wb.projects.openAsync(id)` for projects that open in the worker |

## 19. Implementation plan and validation

The work lands in increments, each committed when it passes its gate. The gate for every increment that touches `src/framework`, `src/typed/model.ts`, `src/typed/ir.ts` or the contract is:

```bash
npm test
IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs
node tools/parity.mjs
node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs | diff $T/various/01-corpus-revisions-baseline.txt -
```

and, at the end of the F1 and D1 increments, the Candela O2 run with full revisions and evidence (`scripts/04-candela-o2-revisions.mjs`) diffed against `various/04-candela-o2-baseline.json`: revisions and evidence must be equal; only times may differ. That baseline run took 12 min 6 s with a 5.79 GB peak, and its pass times grew from 18.8 s (`cfg`, r1) to 96.4 s (`cfg`, r13) as revisions accumulated (this ticket, Step 4).

| increment | content | measured by |
|---|---|---|
| 1 | A1–A7 | `02-framework-cost.mjs` (strength, cfg) |
| 2 | F1: copy and reuse in `Store`, per-record caches, identity fast paths | the same |
| 3 | parts, per-function validation | the same |
| 4 | D1: baseline cache, verdict memo | the O2 run |
| 5 | the case executor and the Node pool | the O2 run with 1 and 4 workers; identical evidence |
| 6 | the job pool; one per-scene run and the 18 scenes | times before and after |
| 7 | the engine worker: rendering | Playwright on port 8772: the longest main-thread task during a stride-1 render, frame identity |
| 8 | the engine worker: open and apply; `createIRArtifactAsync` | Playwright: the longest main-thread task during open and during `cfg` |

New tests, each in a new file:

- `tests/framework/identity-caches.test.mjs`: `revisionOf` equals `fingerprint` on random values; the empty edit returns the input; `validateOnce` calls a validator once per frozen value; the streaming SHA-256 equals the portable one on random texts.
- `tests/typed/parts.test.mjs`: `toNative` after a no-op pass shares every record; after a pass on one function, parts of the others are the same objects; `closureKey` changes exactly for the callers of a changed function.
- `tests/typed/meaning-memo.test.mjs`: on corpus pipelines, evidence with the memo equals evidence without it, check by check.
- `tests/typed/parallel.test.mjs`: the Node pool with 2 workers gives evidence equal to in-process evidence on corpus pipelines.
- `tests/workbench/engine-worker.test.mjs`: the built worker bundle contains the verified vendor bytes and makes no request.

## 20. Decisions and risks

| decision | reason | consequence |
|---|---|---|
| Keep the revision's definition and make its text cheap | the brief; and §2.4 shows that hashing less is impossible without a new definition | the remaining per-revision cost is a text join and two hashes |
| Copy records at the start of a pass, compare at the end | pass bodies mutate records from `st.get`; freezing them would break source compatibility | `toNative` pays one comparison per record |
| Memoize verdicts by closure key instead of skipping cases | the brief forbids changing which cases run or how verdicts are decided | the evidence is identical; the saving is the same as skipping |
| One engine worker, not a pool, in the browser | the main thread's responsiveness is the requirement; a pool multiplies memory in the page | the check in the page runs on one thread, off the main one |
| F2 deferred | the brief makes it conditional | part hashes and closure keys are ready to key it |

Risks:

- **Pass bodies that mutate a record without going through the store.** `toNative` compares every record with its original, so such a mutation is still detected and the record is not reused. The design does not rely on `Tx` reporting its edits.
- **A non-deterministic adapter or validator** would now be hidden by a cache instead of caught. The framework assumes determinism already (revisions are content hashes); IRWB-001 step 12 recorded the same assumption.
- **Memory.** Small-record text caching adds about the size of the live text. The manager's retention of every execution (§7.4) is untouched by this design and remains the largest memory cost of a long pipeline.
- **The worker's CSP.** A same-origin worker does not inherit the page's `<meta>` policy. The header sent by `serve-site.mjs` covers the development server; a different static host must send the same header for the same guarantee.

## 21. Where to look

| path | what to read it for |
|---|---|
| `src/framework/core/data.ts` | canonical text, `immutable`, hashing and their caches (§2) |
| `src/framework/ir/adapters.ts` | `createIRArtifact`, `project`, `validateGraph`, `VERIFIED`, `PROJECTED` (§3) |
| `src/framework/passes/define-pass.ts` | `applyPass`, the gates (§5.2) |
| `src/framework/ir/transactions.ts:295` | `Edit.prepare` (§5.2) |
| `src/framework/ir/correspondence.ts` | `makeCorrespondence`, `validateCorrespondence` (§5.2) |
| `src/framework/contracts/differential.ts` | `differential`, `runDifferential` (§7, §15) |
| `src/framework/contracts/analysis-manager.ts` | `verifyTransformation`, `invariantInternal`, `validatePorts` (§7.4) |
| `src/typed/model.ts` | `TypedBlocks`, `Store.from`, `toNative` (§4, §14.1) |
| `src/typed/ir.ts` | `validateBlocks`, `blocksAdapter`, `storeOf` (§3, §14.4) |
| `src/typed/passes.ts:165` | `typedPass` (§5.1) |
| `src/typed/evaluate.ts:564` | `meaningKept` (§7) |
| `src/typed/program.ts` | `Program`, `apply` (§8.1) |
| `src/workbench/candela.ts`, `site-src/candela.js` | engines, `renderProgressive`, the view (§8.2) |
| `tools/build-site.mjs`, `tools/serve-site.mjs`, `site-src/index.html` | the bundle, lazy loading, the CSP (§8.2, §16.5) |
| `ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs` | the corpus revision listing |
| this ticket's `scripts/02-framework-cost.mjs`, `03-profile-summary.mjs`, `04-candela-o2-revisions.mjs` | the measurements of Part 2 |

## 22. Glossary

- **Artifact**: an immutable record `{ id, kind, schemaVersion, value, contentHash, revision }` (§2.1).
- **Canonical**: the one text encoding of a value; also, for an object, "built by `immutable`" (§2.2).
- **Case**: one call of one function with generated arguments and memory, used by the meaning check (§7).
- **Closure key**: a hash of the code reachable from a function by calls, plus the frame-array flag (§14.3).
- **Engine worker**: the browser's Web Worker that renders, opens Candela and applies passes (§16.5).
- **Function part**: the frozen grouping of one function's records in one revision (§14.3).
- **Mirror**: a worker's read-only copy of a revision, built from parts (§16.2).
- **Origin**: r0, the program as lifted; every check compares against it (§7.1).
- **Projection**: the entities and relations an adapter derives from a native value (§3).
- **Revision**: SHA-256 of the canonical text of `{ kind, schemaVersion, value }` (§2.2).
- **Verdict memo**: decided verdicts keyed by origin, case and closure key (§15.2).
