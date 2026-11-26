---
Title: Design for a Thompson NFA regex matcher
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
    - Path: repo://corpus/candela-gallery/kernel.typed
      Note: Explicit stack in local Int32Array storage
    - Path: repo://corpus/reference.md
      Note: Project metadata and workbench APIs
    - Path: repo://src/typed/evaluate.ts
      Note: Generated cases and the statement-bounded meaning check
    - Path: repo://src/typed/lift.ts
      Note: Tape ingestion and frame-array lowering
    - Path: repo://src/typed/project.ts
      Note: Project ingestion and checked pipelines
    - Path: repo://src/typed/specialize.ts
      Note: Current binding and restricted-contract baseline
    - Path: repo://tools/reference-check.mjs
      Note: Corpus reference-image comparison
ExternalSources: []
Summary: A bounded, whole-buffer Thompson NFA matcher with a JavaScript oracle and a fixed-pattern specialization experiment.
LastUpdated: 2026-11-26T10:34:38.050211407-05:00
WhatFor: Implementing and measuring the regex corpus project.
WhenToUse: Before implementing the matcher or evaluating a regex optimization.
---
# Design for a Thompson NFA regex matcher

`corpus/projects/regex-nfa/` will take a pattern and a text buffer, compile the pattern into a Thompson nondeterministic finite automaton (NFA), then decide whether the NFA accepts the entire text. An NFA can be in several states after one character, so the matcher maintains an explicit set and follows transitions that consume no character before reading the next one. The project gives the compiler two kinds of work to optimize. In the general program it can improve the parser, array-access checks and loops. Given a fixed pattern it can precompute the NFA and specialize its simulation, with a hard-coded state machine as the target.

## Entry point and language subset

`regexMatch(pattern: buffer, text: buffer): i32` returns `1` for a whole-buffer match, `0` for a miss, `-1` for an invalid or unsupported pattern and `-2` when a capacity is exceeded. The inputs are read-only u16 buffers. The pattern syntax uses ASCII, and the text can contain any UTF-16 code unit, including a zero, a newline or an individual surrogate. Matching is case-sensitive. The text length counts code units. No status should trap on a well-formed pair of workbench buffers.

```text
pattern := empty | alt
alt     := seq ("|" seq)*
seq     := piece+
piece   := atom "*"?
atom    := lower | "[" lower "-" lower "]" | "(" alt ")"
lower   := "a" … "z"
```

A class contains one inclusive range whose endpoints must be in ascending order, including equality. The empty pattern accepts only the empty text. Empty alternatives and groups, repeated postfix operators, escapes, wildcards, flags and all syntax outside this grammar return `-1`. A star can repeat a group that accepts empty, as in `(a*)*`. The parser checks the whole pattern before the matcher can return an ordinary miss.

Allow at most 16 pattern units, 12 text units and 16 NFA states including the accept state. Reject an oversized buffer at entry. During parsing, return the first detected syntax error or state overflow. A pattern whose allocation overflows before the parser reaches a later syntax error returns `-2` at the failed allocation. Tests of syntax errors use fixtures below the state cap. Check capacity before allocating each group of one or two states and before appending the accept state. This cap is part of the callable interface and applies to specialized versions too.

## Typed implementation

Use a single array-owning `regexMatch` function with separate compile and simulate sections. Ordinary scalar helpers can keep the code readable, for example `isLower(c: i32): bool` for parsing and `acceptsUnit(kind: i32, lo: i32, hi: i32, c: i32): bool` for the hot test. The latter takes the state's tag and endpoints and uses an equality test for a literal or the short-circuit test `lo <= c && c <= hi` for a range. Every other tag returns false, including when the helper is checked as a standalone function. Use ordinary conditionals on integer tags so their stored representation matches the array element type.

Local frame arrays require a literal size and can be indexed directly. They cannot be assigned, passed or returned, so helpers take scalars and lists swap via scalar offsets into a shared array. Array access emits checked word loads and stores, while buffer `charCodeAt` uses checked u16 access and `.length` reads the buffer header. Keep arrays out of helpers so the current inliner can consider them. The Candela kernel's BVH traversal shows the same explicit-stack idiom. [Typed front end](../../../../../../vendor/ds-js-os/compiler/typed/typed-wasm.js#L1280) · [Lifter](../../../../../../src/typed/lift.ts#L584) · [Candela kernel](../../../../../../corpus/candela-gallery/kernel.typed#L521) · [Strings example](../../../../../../corpus/projects/strings/main.typed) · [Inliner](../../../../../../src/typed/inline.ts#L128)

| Storage | Words | Contents |
| --- | ---: | --- |
| `kind`, `lo`, `hi`, `out0`, `out1` | 16 each | Parallel arrays keyed by a dense state ID. Tags 1–5 are Literal, Range, Split, Jump and Accept in that order. Literal uses `lo`, Range uses both endpoints, Split uses both edges, Jump uses `out0`, Accept uses neither. A consuming state has one successor, `out0`. |
| `frames` | 68 | Seventeen four-word parser frames, each holding completed-alternatives head and tail, then current concatenation head and tail. The root is frame 0 and each open parenthesis pushes another frame. |
| `seen`, `work` | 16 each | Visited flags and a LIFO worklist for one epsilon closure. |
| `states` | 32 | Two banks of 16 slots for consecutive lists of consuming states. An accept flag accompanies each newly computed closure. |

This is 212 words (848 bytes) of array payload, plus scalar locals and backend frame overhead. Within the pattern length cap, even a malformed input can open at most 16 groups. Use `-1` as the absent fragment head or open edge and initialize frame heads explicitly. Zero is a valid state ID. Only read fields needed for each tag.

### Compile the pattern

A fragment is a pair of state IDs, `head` and `tail`. A fragment has one unfilled outgoing edge, `out0[tail]`. These are conceptual pairs in the design. Keep them as scalar locals or frame cells in Typed.

| Operation | Edges written and fragment returned |
| --- | --- |
| Literal or range | Emit one consuming state `x` with its open `out0`. Return `(x, x)`. |
| Concatenate `a b` | Patch `out0[a.tail]` to `b.head`. Return `(a.head, b.tail)`. |
| Alternate `a\|b` | Emit a Split `s` targeting the two heads and a Jump `j` with an open edge. Patch both tails to `j`. Return `(s, j)`. |
| Repeat `a*` | Emit a Split `s` with edges to `a.head` and a new Jump `j` with an open edge. Patch `a.tail` back to `s`. Return `(s, j)`. |

Drive the parser with a pattern cursor and the explicit frame stack. The current sequence is the pieces since the most recent bar at that depth. The completed-alternatives fields hold all preceding sequences joined left to right.

1. On `(`, push a frame with absent heads and advance the cursor. The parent retains its partial sequence.
2. On a lowercase unit, emit a literal and advance one unit. On `[`, first ensure five units remain, then validate `[lo-hi]` and emit a range, advancing five units.
3. On `|`, require a current sequence, combine it with any preceding alternatives and clear the current sequence before advancing. At `)`, require a nonroot frame and a nonempty current sequence, combine it with preceding alternatives, pop, and advance. The resulting group fragment becomes a completed atom in the parent.
4. After every atom, including a just-closed group, look ahead for one `*`. If present, consume it and wrap the atom before appending the resulting piece to the current sequence. An unconsumed `*` at the next token is invalid. All lookahead and class parsing must be within `pattern.length`.
5. At EOF, require the root frame and a nonempty final sequence unless the pattern itself was empty. Combine the last sequence with preceding alternatives, emit one Accept and patch the final tail to it. For an empty pattern, use the Accept as the start state.

After parsing, all edges read by the simulator point into the emitted state range. Each literal or class costs one state, each bar or star costs two, and parentheses cost zero. The running state count increases monotonically. Guard the capacity checks at the emission sites, including the final Accept. As a small review example, `a|b` has five states. Its Split reaches the two literals, both lead to the same Jump, and that Jump reaches Accept.

### Simulate over the text

An epsilon closure follows Split and Jump edges transitively. Mark a state on **push**, including seeds. This bounds the stack by the state count even when different paths converge or when a nullable star creates an epsilon cycle. The closure contains a list of distinct consuming states and an accept flag. A reachable Accept says the NFA accepts the prefix consumed so far. It gives the final answer only at end of input.

```text
for pos = 0 through text.length:
    clear seen[0 .. stateCount)
    reset work size, output count and accept flag
    if pos == 0:
        enqueue start
    else:
        c = text.charCodeAt(pos - 1)
        for each state in the previous bank:
            if acceptsUnit(kind[state], lo[state], hi[state], c):
                enqueue out0[state]
    while work has entries:
        pop state
        Split  → enqueue out0[state], then out1[state]
        Jump   → enqueue out0[state]
        Accept → set accept flag
        other  → append the consuming state to the output bank
    if pos == text.length:
        return 1 if accept flag else 0
    if output count == 0:
        return 0
    swap the bank offsets and remember the output count

enqueue s:
    if seen[s] == 0:
        seen[s] = 1
        push s
```

Write the short enqueue sequence at the seed/edge sites because it mutates local arrays. Initialize both `lo` and `hi` for consuming states, using the literal code unit for both in a Literal state. The consuming-list scan can then read both endpoints as pseudocode shows. A position with no consuming states cannot consume further input, even if Accept is reachable there. Each closure is complete before that decision. The ordinary baseline clears the visited array and walks the NFA on every position. Keep literal comparisons, range comparisons and dispatch readable, with explicit branches and ordinary counted loops.

## Corpus files and generated cases

Follow the layout of `sort`, `strings` and `checksum`. Put the implementation in `main.typed`, describe the subset, status codes and suggested inspection points in `notes.md`, and put the oracle walkthrough in `scripts/explore.js`. The walkthrough should run fresh, compare concrete fixtures with JavaScript, apply the configured pipeline, then show check status, the character-test branches and an instruction count for a match and a late miss. Set `focus` to the actual line of the consuming-state scan once the source exists. `tools/corpus.mjs` discovers project directories and appends those omitted from the display order. [Corpus API](../../../../../../corpus/reference.md) · [Example project metadata](../../../../../../corpus/projects/sort/project.json) · [Project discovery](../../../../../../tools/corpus.mjs)

```json
{
  "title": "Thompson NFA regex matcher",
  "about": "Compile a pattern and match a text buffer with explicit NFA state sets.",
  "group": "Programs",
  "sources": ["main.typed"],
  "ingest": { "tape": true },
  "pipeline": "speed",
  "inputs": {
    "regexMatch": {
      "pattern": { "string": "(a|[b-c])*d" },
      "text": { "buffer": [0, 12], "cell": [97, 100] }
    },
    "isLower": { "c": [90, 126] },
    "acceptsUnit": {
      "kind": { "oneOf": [1, 2, 3, 4, 5, 0, -1] },
      "lo": [97, 100],
      "hi": [97, 100],
      "c": [96, 101]
    }
  },
  "scripts": { "explore": { "about": "Compare with RegExp and inspect a checked pipeline", "fresh": true } },
  "try": ["Compare a match with a late miss.", "Which branches stay after speed?"]
}
```

**Tape ingestion is required.** A small feature probe with a local `Int32Array(16)`, a buffer and a scalar helper reproduced `unknown tape opcode 252` through default `ingest`. The Wasm inspection path attempts to decode the expansion of array zeroing to `memory.fill` (opcode `0xfc`). The same probe lifted and ran via `ingest(..., { tape: true })`, returned the expected integer in 56 evaluator statements, preserved guest memory and agreed with the stock reference RV32 image. This verifies the entry-point choice for the design.

The workbench project loader already passes `project.json`'s `ingest` object to `Program`. The general Node constructors `Program.fromProject` and `ingestProject` currently omit it. Start the focused harness with `new Program(name, source, { ingest: { tape: true }, inputs })`. For corpus integration, wire the existing optional `ingest` metadata through both Node entry points while preserving the default when it is absent. Do this before adding the directory to the shared corpus, so every directory-wide tool, including the parity and reference checks, can ingest it. Add a regression that opens the same tape-backed project through both Node constructors and the workbench. [Workbench loader](../../../../../../src/workbench/projects.ts#L249) · [Node program constructor](../../../../../../src/typed/program.ts#L132) · [Node artifact loader](../../../../../../src/typed/project.ts#L77) · [Tape ingestion](../../../../../../src/typed/lift.ts#L758)

The default pattern exercises every NFA tag. The standard check uses 40 cases per function and seed 7. In the implementation test harness, build fresh `Program` instances with the same source and separate `inputs` profiles. Each profile replaces the indicated specs under `inputs.regexMatch` and retains the helper specs. Run the checked pipeline in each profile so that an edit fitted to the default pattern also sees other patterns.

| Profile | Pattern specification | Text specification |
| --- | --- | --- |
| Default and fixed-pattern comparison | `{"string":"(a\|[b-c])*d"}` | `{"buffer":[0,12],"cell":[97,100]}` |
| Varying literal sequences | `{"buffer":[0,12],"cell":[97,99]}` | `{"buffer":[0,12],"cell":[97,99]}` |
| Overlapping ranges and nullable cycle | `{"string":"([a-c]\|[b-d])*"}` and `{"string":"(a*)*"}`, in separate runs | `{"buffer":[0,12],"cell":[96,101]}` |
| Maximum live-state stress | `{"string":"a*a*a*a*a*"}` | `{"buffer":[12,12],"cell":[97,97]}` |
| Malformed input | `{"string":"a["}` | `{"buffer":[0,12],"cell":[97,100]}` |

Use the literal vertical bar in the JSON value as shown in the project metadata. In `casesFrom`, `oneOf` for these integer helper parameters selects numbers. It does not select objects such as buffer specifications. Fixed pattern profiles are useful for coverage but do not supply any optimization facts. Add correlated cases outside the generator. For example, generate a short grammar-valid pattern from an independently seeded grammar generator, reject over-budget draws, and test it with a witness derived during generation plus a mutation. Compute both expectations with the oracle since a mutation can still match. The uniform literal profile by itself will mostly miss. Keep a deterministic fixture list for success, miss and error coverage regardless of generator outcomes. [Case generator and contract](../../../../../../src/typed/evaluate.ts#L117)

## Step budget

`meaningKept` executes the origin and candidate with a 20,000-statement limit per case. The evaluator counts executed IR statements, including branches, bounds-check branches and statements in callees. One expression or one source line can lower to several statements. The initial sizing estimate below allows for the unoptimized control flow and must be verified against the lifted listing and execution counts. These are planning allowances.

| Work | Upper bound on visits | Allowance | Statements |
| --- | ---: | ---: | ---: |
| Parse with EOF handling | 17 cursor events | 200 per event, including alternation and star emission at a group close | 3,400 |
| Per-position setup and visited clearing | 13 positions | 120 per position, including the 16 clears | 1,560 |
| Scan the previous bank | 12 × 16 slots | 35 per slot, including the helper and enqueue | 6,720 |
| Pop and dispatch a closure state | 13 × 16 states | 35 per pop, including bounds checks and up to two enqueue attempts | 7,280 |
| **Total planning allowance** | | | **18,960** |

The scan and pop bounds deliberately count the full 16 states even though Accept cannot appear in the consuming bank. The initial closure is included. Mark-on-push makes worklist pops linear in state count. The parser advances through bounded input, and each close or bar performs at most one alternation merge. Start by measuring `a*a*a*a*a*` on twelve `a` units, `(a*)*` on empty and length-12 text, and the mixed pattern on early failures, late failures and matches. Include maximum pattern length and state-cap failures. Use `evaluate(..., { limit: 2e4, counts: true })` and `Program.check`. Aim for at most 16,000 measured statements in stress fixtures and zero limits across the fixture list and profiles at r0 and in accepted revisions. If the first pass exceeds the headroom target, inspect dynamically counted statements and tighten the bound using the actual listing. If headroom is still inadequate, reduce the agreed text cap and adjust the specs, oracle and fixtures together before admitting the project to the corpus. The emulator has a separate instruction limit and its steps measure speed.

## Correctness and measurement

**Independent semantics.** Decode the input cells to JavaScript code units, for example with `String.fromCharCode(...cells)` after enforcing the small lengths. Preserve lone surrogates. Use numeric cells for fixtures with surrogate pairs so workbench string construction does not lose the low unit. For the valid subset, the JavaScript expectation is:

```js
Number(new RegExp("^(?:" + pattern + ")(?![\\s\\S])").test(text))
```

Use no flags. The noncapturing group scopes alternation under the anchors and the final negative lookahead requires absolute end of input, including when the text has a trailing newline. Use independently specified fixtures for error cases. For random valid patterns, the generator knows the grammar and counts emitted states with the formula above. For arbitrary invalid patterns, use a small independent host grammar recognizer or explicit expected statuses. JavaScript accepts extra syntax and cannot decide the subset or capacity policy alone. On every checked call, require the expected result, no trap or limit, and original input bytes. Compare guest memory before and after. Temporary frame storage belongs to the implementation.

Include these fixtures and freeze them for backend comparisons.

| Pattern | Text | Result | Purpose |
| --- | --- | ---: | --- |
| empty | empty / `a` | 1 / 0 | Empty pattern semantics |
| `ab\|c` | `ab` / `c` / `ac` / `abc` | 1 / 1 / 0 / 0 | Precedence and whole-buffer semantics |
| `a*` | empty / `aaa` / `aa\n` | 1 / 1 / 0 | Prefix acceptance and strict end |
| `(a*)*` | empty / `aaa` / `b` | 1 / 1 / 0 | Nullable epsilon cycle |
| `[b-d]` | `a` / `b` / `c` / `d` / `e` | 0 / 1 / 1 / 1 / 0 | Both range boundaries |
| `([a-c]\|[b-d])*` | `bcdd` | 1 | Convergent epsilon paths |
| `(a\|[b-c])*d` | `d` / `abccd` / `abcc` / `d\n` | 1 / 1 / 0 / 0 | Default pattern and late rejection |
| `a` | cells `[0]` / `[55296,56320]` | 0 / 0 | Zero and surrogate code units |
| `a\|`, `(a`, `a)`, `()`, `a**`, `[c-a]`, `a[`, `.` | empty | −1 each | Grammar and truncated lookahead |
| `(abcdefghijklmn)` | `abcdefghijkl` | 0 | Exactly 16 pattern units |
| `a*a*a*a*a*` | twelve `a` units | 1 | Exactly 16 states and 12 text units |
| `a*a*a*a*a*a` / `a*a*a*a*a*a*` | empty | −2 each | Overflow at Accept / during emission |
| 17 literal units / `a*` | empty / 13 text units | −2 each | Buffer length guards |

Here `\n` denotes an actual line feed in the fixture. Assert inclusion of equal-endpoint classes, nested grouping and chained alternation in the generated or directed suite. An exhaustive small sweep over texts of length 0–4 on `{a,b,c,d}` for several fixed patterns provides repeatable coverage of closure and acceptance errors.

**Compiler checks.** First compare r0 with JavaScript. Keep per-pass checking enabled against r0 on every profile and report rejected passes, counterexamples and inconclusive counts. Accepting a candidate on generated cases is evidence for those cases. Also replay the directed suite against the final IR and the images. Use `tools/reference-check.mjs` for the corpus-wide reference check after integration. For focused, identical-input comparisons in a test harness, build the reference image once with `referenceCompile`, run it with `referenceRun` on the same `Case.args` and `Case.memory`, and compare with the evaluator and workbench `runImage` using `agrees`. Set explicit limits such as 200,000 instructions for reference and workbench image runs. Report any trip of that guard as inconclusive and investigate before recording a speed result. The two compilers share frontend machinery, so JavaScript is the independent language oracle. [Reference check tool](../../../../../../tools/reference-check.mjs) · [Reference runner](../../../../../../src/typed/reference.ts) · [Meaning comparison](../../../../../../src/typed/evaluate.ts#L556)

**Measurements.** Use identical concrete buffers for general r0, O2 and `speed` with the same backend options, then measure `speed` with `chains`, `coalesce` and `homes` enabled as a separate configuration. Include the reference image and record its compiler policy. Record commit, full options, pipeline, seed and cases, per-case instruction counts, total and median for each group, image bytes and per-entry frame and spill counts. Distinguish empty and early failures, matches, and late misses. Run targeted lengths 0, 1, 4, 8 and 12 where results are meaningful. Report end-to-end counts including parsing. Use source heat and IR listings to attribute compile and scan costs, and labeled match cases of different lengths to see whether the per-unit cost changed. Never mix IR statement counts into the RV32 speed measure.

## Optimization experiments

- **IRWB-003** supplies the baseline `speed` pipeline. Observe whether it inlines scalar helpers and rotates the scan loops. Examine the bounds checks, copy count, spills and repeated constants in the selected image, then compare the three backend options on and off. The program uses small i32 constants. Any benefit from putting them in registers is a measurement question, since immediates may already suffice. [Speed pipeline](../../../../../../src/typed/passes.ts#L1104) · [Backend options](../../../../../../src/typed/backend/options.ts)
- **IRWB-007** calls for fixed-data partial evaluation. Bind the full pattern buffer by entry parameter, including its length and exact u16 cells, for the duration of the call. Use `(a|[b-c])*d` first. The address can vary and the text stays dynamic. Include at least two different pattern addresses in the specialization suite, for example by padding the host allocations before placing the pattern in one run. Restrict the contract to that exact pattern and check the specialized candidate against the general r0 and JavaScript on varied texts including over-length text. If exposed beyond the fixed-pattern experiment, dispatch other patterns to the general entry. The current scalar/record-field `specialize` pass in `src/typed/specialize.ts` does not bind buffer contents. A first experiment should eliminate parsing and resolve the NFA data. A second can specialize the scan on known tags, edges and class bounds. Removing the visited lists altogether requires reasoning about reachable sets, for example building a DFA over reachable closures and grouping characters that have identical transition behavior. Bound code growth and report the residual arrays and branches after each stage. [IRWB-007 guide at `69ae7a0`](#design-references)
- **IRWB-006, IRWB-008 and IRWB-010** meet in the residual CFG. Once opcodes or active-state facts become known, SCCP on SSA can expose constant branches. Jump threading can route predecessor paths directly to their known successors. Loop unswitching applies to predicates proved invariant for the chosen loop, for example a known per-transition tag in a residual per-character loop. The tag of the general consuming-state loop varies with the state, so it cannot be hoisted just because the pattern is fixed. The range predicate provides a small rule-search window, such as comparing two ordered endpoint tests with one unsigned offset/range test when the bounds are valid. Test endpoints and adjacent values, and use the rule verifier and exact validation for rewrites whose load, branch and trap preconditions can be discharged. Keep sampled checks for transformations outside that proof, such as changes to the whole state-set algorithm. [Design references](#design-references)
- **IRWB-011** has a different acceptance model for float-heavy programs. This matcher uses integer code units and exact discrete outcomes, so compare the result and memory exactly for every experiment. [Design references](#design-references)

For an optional ceiling in a later implementation task, put a small hand-written DFA in a sibling project named `regex-nfa-fixed`. For the default pattern, the start state loops on `a`, `b` or `c`, takes `d` to the accepting state and takes any other unit to the dead state. Any further unit after entering the accepting state goes dead. Only the accepting state at EOF succeeds. Keep the same text-cap behavior and compare the same fixed pattern/text pairs with JavaScript. Measure it alongside the general one-shot entry, including all work each does for a call, and label the assumption that the pattern is fixed. The gap gives a target for the compiler without changing the source workload.

## Implementation sequence

1. Ingest a minimal entry via tape with a local fixed-size array and scalar helpers, then implement the parser and simulate literal and empty-pattern cases through r0. Inspect the listing for guarded array access.
2. Add ranges, groups, alternation and star in that order. Add capacity and malformed-input checks at the corresponding parser sites. Verify fragments and closure invariants with the directed fixtures and the independent JavaScript oracle.
3. Route the opt-in tape metadata through the Node corpus loaders. Add the corpus metadata, notes and walkthrough. Execute the generated profiles and measure the statement budget on stress cases before promoting the project. Check zero traps, memory changes, disagreements and inconclusive verdicts on the required fixtures and profiles.
4. Run the focused reference and workbench image comparisons and record the r0/O2/`speed` benchmark. Run the broader reference check after integration. Use the baseline series for later fixed-pattern, rule and CFG experiments.

## Design references

Paths below are relative to the repository root. The IRWB-007, IRWB-010 and IRWB-011 guides are available in local Git revisions. Use `git ls-tree -r --name-only REV ttmp` to locate the design document under the matching ticket, then `git show REV:PATH` to read it.

| Ticket | Guide consulted |
| --- | --- |
| IRWB-003 | Intern guide to closing the speed gap, especially the instruction measurement method and outcomes |
| IRWB-006 | Intern guide to verified rewrite rules and the SSA view, including sparse conditional constant propagation |
| IRWB-007 | Intern guide to partial evaluation over constant memory at `69ae7a0`, particularly the existing binding contract and the proposed region and residualization model |
| IRWB-008 | Intern guide to exact checking, particularly rule citations and regional obligations |
| IRWB-010 | Rewrite search sketch at `d0e6415`, including verified discovery, equality saturation and instruction windows |
| IRWB-011 | Image-level tolerance sketch at `d0e6415`, particularly the contract design |
