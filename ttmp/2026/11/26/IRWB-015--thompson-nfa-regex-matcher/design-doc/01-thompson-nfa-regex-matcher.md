---
Title: Thompson NFA regex matcher
Ticket: IRWB-015
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://corpus/reference.md
      Note: Project formats, generated input specifications and workbench APIs
    - Path: repo://src/typed/evaluate.ts
      Note: Case generation, budget and differential semantics
    - Path: repo://src/typed/lift.ts
      Note: Tape ingestion and frame-array operations
    - Path: repo://src/typed/program.ts
      Note: Program construction, project loading and checked pipelines
    - Path: repo://src/typed/project.ts
      Note: Node project ingestion that needs the manifest tape option
    - Path: repo://src/typed/specialize.ts
      Note: Current specialization bindings and their limits
    - Path: repo://tools/reference-check.mjs
      Note: Reference compiler and emulator comparison
ExternalSources: []
Summary: A bounded Thompson NFA corpus project for checked optimization and fixed-pattern specialization.
LastUpdated: 2026-11-26T11:54:19.323852476-05:00
WhatFor: ""
WhenToUse: ""
---

# Thompson NFA regex matcher

Build `corpus/projects/regex-nfa` around a Typed function that reads a pattern buffer, builds a Thompson NFA in frame arrays, and matches a text buffer using explicit sets of states. The same generic code runs every supported pattern. A fixed pattern gives a future compiler enough information to remove the pattern compiler and replace the table-driven matcher with a hard-coded state machine, the outcome generated lexers such as re2c illustrate. Measure the ordinary matcher first with today's checked pipelines.

## Input and result

`regexMatch(pattern: buffer, text: buffer): i32` returns 1 when the entire text matches and 0 otherwise. Both buffers contain u16 code units and are read-only. The supported text is 0–10 ASCII code units (0–127), including newline and NUL. The pattern is empty or follows this grammar, case sensitively.

```text
pattern = "" | branch ("|" branch){0,2}
branch  = piece+
piece   = atom ("?" | "*")?
atom    = lower | "[" lower "-" lower "]"
lower   = one ASCII letter a through z
```

Across all branches there are at most eight atoms. A range has ascending or equal endpoints and includes both. The empty pattern matches only empty text. Alternation is lower precedence than concatenation, and each quantifier applies to its immediately preceding atom. Searching for substrings, groups, captures, escape sequences, wildcards, Unicode modes and additional class syntax are omitted to keep both the parser and the checked input domain small. The test driver generates or selects valid patterns before invoking Typed.

Anchored Boolean matching isolates state transitions from search positions and capture bookkeeping. A direct scanner would be shorter for literals alone, but it would miss competing paths, epsilon closure and runtime state dispatch. An explicit NFA keeps those operations visible in the IR. Start with a single inclusive range per class so a class still exercises two comparisons without a separate range table and parser.

## Typed layout and construction

Keep the two phases in `regexMatch`. The front end treats a frame array as local storage with a literal allocation size. It cannot be assigned, returned or passed to a helper. Use two scalar helpers, `literalMatches(c: i32, code: i32): bool` and `rangeMatches(c: i32, lo: i32, hi: i32): bool`, to give the inliner small call sites. Their bodies are ordinary equality and short-circuit lower- and upper-bound tests. The matcher can read `text.charCodeAt(pos)` once per position and use simple integer opcode dispatch inside the scan.

| Frame arrays | Cells per array | Meaning |
| --- | ---: | --- |
| `kind`, `lo`, `hi`, `out0`, `out1` | 20 | State columns. Use named integer opcodes for Match, Split, Literal and Range. Literal uses `lo`; Range uses both endpoints. Consuming states use only `out0`; Split uses both exits. |
| `active`, `next` | 20 | Dense 0/1 state membership for the current position and the next position. |
| `queue` | 20 | State IDs in closure discovery order. Scalar head and tail indices delimit the live prefix. |

These eight literal `new Int32Array(20)` allocations occupy 640 bytes of frame-array storage. State 0 is Match. With eight atoms, eight quantifier splits, two alternation splits and one Match, the largest graph has 19 states. Only indexes below the allocated state count are used. Each constructed edge points to a state in the graph. Use locals for the state count, pattern cursor and automaton entry. A dense set and queue make membership and deduplication explicit while leaving loads, branches, and copies for compiler experiments. A bitset or precomputed DFA would hide that work in the baseline.

### Compile right to left

Scan the pattern backward using `charCodeAt`. A piece ends in an optional `?` or `*`. Peel that token, then read the literal or the five cells of a class ending in `]`. The grammar guarantees the cursor reads are in bounds. Use the current branch entry as the continuation for each new piece. At the start of a branch, that continuation is Match.

| Piece | New graph fragment and entry |
| --- | --- |
| Atom | Emit a consuming state whose `out0` is the continuation. Its ID is the entry. |
| Atom with `?` | Emit the consuming state pointing to the continuation. Emit a Split to that state and the continuation. The Split is the entry. |
| Atom with `*` | Reserve both IDs. Emit a Split to the consuming state and the continuation, and point the consuming state's exit back to the Split. The Split is the entry. |

At each `|`, merge the completed branch with the accumulated alternatives to its right. The first completed branch becomes the accumulator directly. Each further merge emits one Split pointing at the completed branch and the accumulator. Start the next branch with Match as its continuation. At the left end, merge the last branch the same way. Use a scalar sentinel for an absent accumulator and keep it out of the state arrays. For an empty pattern the entry is Match. Working backward makes the continuation available at each emission. A forward Thompson compiler with patch lists would support a broader grammar, but would add storage and control flow unnecessary for this grammar.

### Match left to right

1. Mark the entry in `active`. For each position from zero through `text.length`, reset the queue head and tail and seed the queue with marked IDs from `active`.
2. Walk the queue to its growing tail. When a queued state is Split, inspect both successors. Mark an unseen successor in `active` before appending it. Match, Literal and Range have no epsilon successors. At the end of the scan, `active` is the full epsilon closure and the queue contains each marked state once.
3. At `pos === text.length`, return `active[0]`. Otherwise, read the current code unit. Scan the queue, dispatch by state kind, and for each successful literal or range comparison mark its `out0` in `next`. Match and Split consume nothing.
4. Copy `next` into `active` over the allocated state IDs, clearing `next` as each cell is copied. Advance the position. An empty active set naturally remains empty.

At a position, the seed set represents the destinations reached by consuming exactly the prefix up to that position. Following Split edges adds precisely the paths that consume no further input. The next set then represents every path that consumes the next code unit. Marking at enqueue bounds the queue by the state count even when branches join or several transitions reach one destination. The final closure handles endings that can skip an optional atom or leave a star. For `a*b`, the initial closure contains the scanner for `a` and the scanner for `b`. Each `a` reaches the Split again, while a final `b` reaches Match. Text `ba` fails because Match has no outgoing consuming edge. Keep the set copies, opcode tests and bounds-checked accesses in Typed. Use ordinary control flow and let the compiler demonstrate which operations it can remove.

## Corpus project and generated cases

Add `main.typed`, `project.json`, `notes.md` and `scripts/compare.js` in the implementation. The notes explain the grammar, point to the closure loop, and name a positive and a negative example. The fresh script compiles r0, runs checked `speed`, compiles the result and compares its results and RV32 instruction counts on a short explicit fixture list. Use the project shape in [blend](../../../../../../corpus/projects/blend/project.json) and the `work.length` loop in [checksum](../../../../../../corpus/projects/checksum/main.typed). A suitable starting configuration is below. Set `focus` to the actual source line for the closure dispatch once the code exists.

```json
{
  "title": "Regex: Thompson NFA",
  "about": "Compile a pattern buffer and match a text buffer using explicit state sets.",
  "group": "Programs",
  "sources": ["main.typed"],
  "ingest": { "tape": true },
  "pipeline": "speed",
  "inputs": {
    "regexMatch": {
      "pattern": { "string": "[a-b]*c?" },
      "text": { "buffer": [0, 10], "cell": [97, 100] }
    },
    "literalMatches": { "c": [0, 127], "code": [97, 122] },
    "rangeMatches": { "c": [0, 127], "lo": [97, 109], "hi": [109, 122] }
  },
  "scripts": { "compare": { "fresh": true, "about": "Compare checked speed against r0." } }
}
```

`casesFrom` samples each parameter independently. Its generic `oneOf` coerces the chosen value to an integer, so it cannot select between string specifications. Use a fixed valid pattern per profile and generate text for that pattern. Reuse the source with fresh Programs whose input specifications replace only `regexMatch.pattern` and, where useful, `text`. The default profile covers empty successes and rejection on `d`. Run the same checked pipeline with profiles for empty, `ab`, `a|bc|d`, `a?a?`, `a*b` and `a?a?a?a?|a*a*|[a-c]*[a-c]*`. Keep seeded random `a`–`d` text and add all-`a` lengths 0 through 10 to drive the maximum graph. The profile tests use the same read-only pattern buffer ABI and compile the same generic source. Add directed cases for helper boundaries outside the default sampling choices, including a degenerate range, an endpoint on each side, and a hit and miss for a literal. [Input specification and execution API](../../../../../../corpus/reference.md) · [Generator and gate](../../../../../../src/typed/evaluate.ts)

### Tape ingestion

The workbench project loader already honors `ingest.tape`. The ordinary Node corpus paths `ingestProject` and `Program.fromProject` use default Wasm inspection, which fails on the frame-array zeroing opcode. As part of corpus integration, pass the existing optional ingestion metadata from `ProjectSource` through those two Node paths, preserving the default for manifests without it. Then `tools/parity.mjs regex-nfa` and the existing reference-check loader can open this project using the same manifest as the browser. The current code can run the project directly with `new Program(..., { ingest: { tape: true }, inputs })` while that small integration change is being made. Using external u16 scratch buffers would avoid the loader change but would change the intended Typed representation and make scratch memory observable to the check. The corpus discovery code already appends directories absent from `index.json`, so add an order entry only if specific placement is desired. [Project ingestion](../../../../../../src/typed/project.ts) · [Program constructor](../../../../../../src/typed/program.ts) · [Workbench loader](../../../../../../src/workbench/projects.ts) · [Corpus discovery](../../../../../../tools/corpus.mjs)

A small local probe used an unrelated `Int32Array(20)` loop with a scalar Boolean call and buffer reads. Direct tape ingestion ran it at r0 and through checked `speed` in 45 and 37 evaluator statements. The optimized emulator run returned the same result in 126 instructions and the reference image agreed on ten generated cases per function. A workbench project using `ingest.tape` also opened and ran a fresh script on the probe, while the two Node manifest paths failed under default inspection with `unknown tape opcode 252 at 9`. The front end requires `===` for equality. The lifter handles `array.address` and `array.zero` from the tape, including source spans. These are feature probes. Matcher step and instruction counts will come from the implementation. [Lifter](../../../../../../src/typed/lift.ts) · [Frame-array fixture](../../../../../../tests/typed/inline.test.mjs) · [Candela traversal example](../../../../../../corpus/candela-gallery/kernel.typed)

## Oracles and budget

**Language oracle.** Run JavaScript `RegExp` on the original valid pattern and exactly the same text. Build it with no flags and use a grouped alternation plus an absolute end assertion.

```js
const expected = Number(new RegExp('^(?:' + pattern + ')(?![\\s\\S])').test(text));
```

The negative lookahead accepts only when there is no next code unit, including newline. A smoke probe of `[a-b]*c?` produced 1 for empty text, `aab` and `aac`, and 0 for `acb` and `aac\n`. Keep the oracle independent by feeding it the original pattern, without translating through the Typed NFA. In the Node test use `casesFrom` for seeded cases and `benchCase` for fixtures. Decode the two argument buffers from the case memory with `readBuffer` and `String.fromCharCode(...cells)` when building the oracle call. On every supported case require an exact 0 or 1 equal to the oracle, successful termination with no trap, emulator fault or limit, and unchanged argument buffers. Run the same cases at r0 and on the selected optimized evaluator and RV32 images. Record the pattern, text code units, seed or fixture name and revision on a discrepancy.

**Pass and reference checks.** Leave the standard `meaningKept` gate enabled. Each changed revision compares to r0 on seeded cases for each function, including the scalar helpers, with a default limit of 20,000 evaluator statements per case. It compares results, traps and memory. An exhausted budget yields an inconclusive case, so acceptance of a pipeline alone does not establish that the corpus is sized correctly. Audit the inconclusive and both-trap counts and require both to be zero. Separately compile the same source with the reference RV32 compiler and run it with the same initial memory at its entries, following `tools/reference-check.mjs`. Compare its result with the evaluator and the RegExp oracle. Keep this check in Node, where the reference compiler can be loaded. [Evaluator and meaning comparison](../../../../../../src/typed/evaluate.ts) · [Reference image harness](../../../../../../tools/reference-check.mjs)

**Step sizing.** Given `S <= 19` states, at most ten Split states and `N <= 10` code units, compilation reads at most 50 pattern cells' worth of syntax. Each of the `N + 1` positions seeds the queue by scanning at most `S` marks, processes at most `S` queue entries and attempts at most 20 epsilon edges. At each of the first `N` positions, consumption and copying visit at most `S` entries apiece. Count evaluator statements, including branches, bounds checks and helper calls. As a provisional budget, allow 50 statements per pattern cell, 60 per state per position across all four scans, 12 per epsilon edge attempt and 1,000 for setup and outer-loop work. That gives `50*50 + 11*(60*19 + 12*20) + 1000 = 18,680`, an estimate to validate against lifted code. Put the 19-state graph on both ten `a`s and nine `a`s followed by `d`, and run `[a-a]?[a-b]*[a-c]?[a-d]*|[a-e]*[a-f]?|[a-g]*[a-h]?` at the 50-cell syntax limit. Measure r0 and each changed revision with the real gate budget. If the estimate misses, use statement counts to find repeated setup or copying and simplify the baseline before revisiting any input cap. Keep the gate at 20,000.

## Test, measurement and implementation order

1. Start with the tape-loader smoke case and wire the manifest through the two Node entry points. Add a test that a project with a frame array opens through both, then check that a standard corpus project still opens using its default front end.
2. Implement the state columns and backward compiler. Exercise literals, concatenation, the rightmost and leftmost branches, a degenerate range, and the two quantifiers. Add the closure and consuming scans. Test empty matching and rejection, `a*a` on `a`, `a?a?` on lengths 0–3, class endpoints and immediate neighbors, two branches converging on Match, suffix rejection and embedded LF or NUL.
3. Add a Node oracle test for the directed cases, an exhaustive small sweep (texts of length 0–4 over `a,b,c` for the representative pattern list), and 100 generated cases per profile for seeds 7 and 23. Run r0, checked O2 and checked `speed`, then compare their RV32 images and the reference image. Record maximum evaluator steps and assert zero timeouts, faults and traps. Recheck the limit on every changed revision using the directed budget cases and the generated inputs.
4. Publish the project files and compare script. Measure the same directed and seeded cases at r0, O2, `speed`, and optionally `speed` with `chains`, `coalesce` and `homes` enabled. Compare `speed` and O2 with identical backend options first to isolate pipeline changes. Report per-case and aggregate RV32 instruction counts, image bytes, accepted or rejected passes and the largest evaluator step count. Break out empty, short and max-length cases so one-time NFA construction is visible. Use emulator heat or listings to attribute changes to construction, closure or the consuming scan. A candidate enters the comparison after the correctness checks above.

IRWB-003 can measure helper inlining, loop rotation and backend coalescing on copies and loop indices. Repeated character-code and state constants also give integer register homes something to measure. IRWB-006's SSA/SCCP work can expose scalar facts in the decoder and dispatcher. IRWB-008 can measure exact evidence for verified expression rewrites here while retaining sampled checks for residual structural changes. IRWB-010 can use range comparisons and index arithmetic as small rewrite-search windows. IRWB-011's float tolerance contract has no role in this integer matcher.

On the representative fixed pattern, future specialization experiments should compare general and specialized images on identical text inputs with identical backend options. Count all instructions from entry to return, including any remaining construction. Ask whether fixed state kinds eliminate dispatch branches through jump threading and allow loop unswitching when a dispatch or class test becomes invariant over the text loop. State IDs are dynamic in the generic scan. Knowing the pattern alone does not make all state tests invariant. The end goal is a deterministic, hard-coded state machine with direct character tests and no per-call pattern construction. Fixed case inputs alone do not specialize the code. [Current specialization bindings](../../../../../../src/typed/specialize.ts) · [Speed pipeline](../../../../../../src/typed/passes.ts)

## Later

- IRWB-007 can extend specialization facts to pattern-buffer lengths and cells, then evaluate construction and residualize transitions over dynamic text. The current specializer accepts scalar and record-field bindings.
- A separate hand-written ceiling project can implement `[a-b]*c?` as two live states and rejection, using the same texts and RegExp verdicts. It provides a comparison once a fixed-pattern specialization can be measured.
