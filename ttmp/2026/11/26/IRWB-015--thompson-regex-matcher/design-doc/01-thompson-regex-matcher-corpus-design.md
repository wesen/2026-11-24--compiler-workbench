---
Title: Thompson regex matcher corpus design
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
      Note: Corpus-facing project, input and emulator APIs
    - Path: repo://src/typed/evaluate.ts
      Note: Input specifications, memory and the pass check statement budget
    - Path: repo://src/typed/lift.ts
      Note: Tape ingestion and frame-array lowering
    - Path: repo://src/typed/program.ts
      Note: Node project loader and checked pass execution
    - Path: repo://src/typed/project.ts
      Note: Corpus source metadata and Node project ingestion
    - Path: repo://src/workbench/projects.ts
      Note: Existing per-project tape ingestion in the workbench
    - Path: repo://tools/reference-check.mjs
      Note: Reference RV32 image oracle
ExternalSources: []
Summary: Design a bounded Typed Thompson-NFA matcher with generated cases and a JavaScript RegExp oracle.
LastUpdated: 2026-11-26T10:58:04.913238898-05:00
WhatFor: ""
WhenToUse: ""
---

# Thompson regex matcher corpus design

Build `corpus/projects/regex-nfa/` around `regexMatch(pattern: buffer, text: buffer): i32`. Each call reads a pattern, compiles it into a Thompson NFA in local frame storage, and walks the text with explicit state sets. Return `1` for a full match and `0` otherwise. A call leaves both buffers unchanged. The benchmark includes pattern compilation because compiling it away is part of the opportunity when the pattern is fixed.

Write normal loops and keep the scalar character test as a helper. The same program then exposes an inner-loop call for inlining, loop entries for rotation, and locals for coalescing. Once the optimizer knows the pattern, the state tags, edges, and range endpoints become candidates for constant propagation. Known tags could thread control directly to a state's action, and an invariant dispatch decision can move outside a loop when the compiler can prove it. A fixed point over reachable state sets could ultimately give the compiler a hard-coded machine in the style of a generated lexer.

- **IRWB-003** exercises the existing `speed` pipeline on the character-test call and the nested parse and state-set loops.
- **IRWB-007** supplies the constant-memory partial evaluation needed to turn the same matcher and a fixed pattern buffer into a specialized machine.

A prebuilt automaton would give the matcher a dispatch loop but remove the pattern compiler from the partial-evaluation workload. Keep the raw pattern in a buffer argument. Its size comes from `pattern.length`.

## Pattern and text

The grammar uses ASCII code units and implicit concatenation.

```text
pattern  = piece{0,4}
piece    = atom ["*"]
atom     = letter | "[" letter "-" letter "]"
letter   = "a" | "b" | "c" | "d"
```

A class has inclusive endpoints in ascending order, with equality allowed. The text contains zero to eight letters from the same alphabet. Every piece consumes one character unless it has `*`, which allows zero or more repetitions. The empty pattern accepts only empty text. Full matching means every input character must be consumed. These constraints define the valid domain.

Literal-only concatenation would be a string comparison. A single inclusive range exercises character-class comparisons, and `*` introduces an epsilon choice, a loop, and simultaneous active states without needing alternation or grouping. Full matching keeps one starting state and one final decision. Searching for a substring would add new starting positions without exercising a different state representation.

## Compile the pattern

Keep the parse and simulation in `regexMatch`. Typed's fixed arrays cannot be passed to a helper or assigned to another local. Use a single `const nfa = new Int32Array(45)`, with nine rows of five words. Row `s` starts at `5 * s` and has `kind, low, high, out, out2` in that order. Use named local `i32` constants for the three tags.

| Kind | Used fields | Operation |
| --- | --- | --- |
| Range | `low, high, out` | Consume one code unit in the inclusive range and go to `out`. |
| Split | `out, out2` | Follow both edges without consuming input. |
| Accept | none | Mark an accepting state at the end of the text. |

Five words give the two edge slots and two range bounds consistent meanings. Packing them into fewer words would make offsets depend on the tag without helping the optimization experiment. Use one Range operation for both a class and a literal, setting a literal's two endpoints equal. A separate Literal opcode would add a dispatch arm for the same predicate.

Walk the pattern with a cursor `p` and the next free state `s`, both initially zero. For a literal, read one code unit into both bounds and advance by one. On `[` (91), read the endpoints at `p + 1` and `p + 3` and advance by five. Next, test `p < pattern.length && pattern.charCodeAt(p) === 42` for the optional star. Emit states as follows.

```text
plain:  s     = Range(low, high, out=s+1)
star:   s     = Split(out=s+1, out2=s+2)
        s+1   = Range(low, high, out=s)
```

Advance `s` by one for a plain piece or two for a star. For a star, also advance the pattern cursor past `*`. After the final piece append Accept at `s`, save `accept = s` and set `stateCount = s + 1`. Start at state zero, which is Accept for the empty pattern. The successor after a piece is the first row of the next piece or the final Accept, so sequential numbering resolves concatenation without a patch list or parser stack. Four pieces use at most eight rows plus Accept and at most 24 pattern code units.

## Simulate explicit state sets

Allocate `current`, `next`, and `queue` as three separate `new Int32Array(9)` declarations. `current` and `next` are dense 0/1 membership sets. The queue holds state indices and has scalar `head` and `tail` counters. Arrays start at zero. Set `current[0] = 1`.

1. At each text position `i`, including `text.length`, compute epsilon closure in place. Reset `head` and `tail` to zero and enqueue all marked states by scanning `0 .. stateCount-1`. While `head < tail`, pop one state. For a Split, visit `out` and `out2`. For each successor whose `current` bit is zero, set it before enqueuing. The membership set doubles as the visited set, so each active state is enqueued once per position. Other tags have no epsilon edges.
2. If `i === text.length`, return `current[accept]`. Otherwise read the current text code unit once. Scan all rows below `stateCount`. For each marked Range, call `inRange(code: i32, low: i32, high: i32): bool`, implemented as `code >= low && code <= high`. If it succeeds, mark the Range's successor in `next`. Split and Accept consume nothing.
3. Scan the states once more, copying `next[s]` to `current[s]` and clearing `next[s]`. Advance the text position and repeat.

At the start of each position the marks represent all destinations reached by consuming exactly that prefix. Closure adds all possible epsilon moves before the next character or the final decision. In `a*b`, for example, the initial closure reaches both the `a` and the `b` rows. Taking the `a` edge reenters the split at the next position. Accept reached before the text ends cannot consume a trailing character.

A dense set is the smallest representation here. A sparse active list would also need membership tracking to avoid duplicates, and a bit mask would fold the state walks into manual bit manipulation. A simple queue avoids rescanning the set to a fixed point and works without exploiting the order of Split destinations. Copying the sets is straightforward Typed. Array swapping is unavailable.

## Corpus files and generated cases

Put both functions in `main.typed`. In `notes.md`, trace `a*b` over `aaab` and point to the Range helper call as the first thing to inspect after `speed`. Add `scripts/explore.js` to run the benchmark at r0 and with `speed` and show both results and instruction counts. Set `focus` to the actual Range helper call line after writing the source. Use this metadata shape.

```json
{
  "title": "Thompson regex matcher",
  "group": "Programs",
  "sources": ["main.typed"],
  "pipeline": "speed",
  "ingest": { "tape": true },
  "inputs": {
    "regexMatch": {
      "pattern": {
        "strings": [
          "", "a", "ab", "a*b", "[a-c]*", "[a-c]*d",
          "[a-c]*[b-d]*a*d", "[a-d]*[a-d]*[a-d]*[a-d]*"
        ]
      },
      "text": { "buffer": [0, 8], "cell": [97, 100] }
    },
    "inRange": { "code": [97, 100], "low": [97, 98], "high": [98, 100] }
  }
}
```

`casesFrom` samples each parameter independently. Every listed pattern can run on every generated text, and the helper specs always give ordered bounds. Checking the scalar helper directly uses the ordinary all-functions gate. A single existing `{ "string": "..." }` would be enough for one pattern but exercise only one NFA topology during pass checks. A finite list covers empty, straight-line, and branching NFAs with a small, readable input specification.

## Small infrastructure changes

Use the existing workbench `ingest` metadata in `src/workbench/projects.ts`. Teach the Node project entry points `Program.fromProject` and `ingestProject` to honor the same `ProjectMeta.ingest` option. Both can use `IngestOptions` from `src/typed/lift.ts`. Corpus enumerators discover the directory automatically. Keep historical aggregate assertions scoped to the projects they describe, including the chapter 13 reference test in `tests/typed/backend.test.mjs`.

Add `{ strings: [...] }` to `makeValue` in `src/typed/evaluate.ts` and document it next to `{ string: ... }` in `corpus/reference.md`. Sample one member of the nonempty list with the case RNG and allocate it with `mem.string`. Current `oneOf` coerces its choice to an integer. A new string-list form keeps numeric specs and fixed strings on their existing paths.

The ticket's [probe](../scripts/01-probe.mjs) loaded the vendored front end with `tools/node-vendor.mjs`. Default project ingestion failed on array opcode 252. With tape ingestion, indexed array writes and reads, buffer reads and length, short-circuit tests, loops with `break` and `continue`, and the scalar helper all worked. The two evaluator fixtures returned 1 and 0, the reference RV32 checks agreed on 24 cases over both functions, and the workbench loaded the tape project and ran its script. Passing a local array to a function was rejected. Giving `oneOf` string members yielded zero-valued arguments with no buffer allocation.

## Step budget

The four frame arrays total 288 bytes. For text length eight and nine states, there are at most 81 closure seed-scan iterations and 81 queue pops, which consider at most 162 epsilon edges. There are also at most 72 consuming-scan iterations, 72 helper calls, and 72 copy-and-clear iterations. The evaluator counts executed IR statements across calls, including branches, rather than counting these iterations as single steps.

Use 2,000 statements for compilation and outer-loop control and budget up to 24 per seed, edge, or copy iteration, 32 per pop, and 48 per consume iteration including its helper. That totals 15,608 statements. These are planning allowances. Once the source exists, measure the actual r0 and optimized statement counts on `[a-d]*[a-d]*[a-d]*[a-d]*` with `aaaaaaaa`, which keeps all rows active, and verify that the generated pass checks have zero inconclusive cases at the existing 20,000-statement limit.

## Oracle, tests, and measurement

In a focused Node test, read the pattern and text from each case's initial memory using `readBuffer(case.memory, case.args[i])` and convert the cells with `String.fromCharCode(...cells)`. Compute `Number(new RegExp("^(?:" + pattern + ")$").test(text))` with no flags. The restricted alphabet excludes line terminators, so the anchors enforce whole-text matching. The oracle uses the original pattern directly and shares no parser or state-walking code with Typed.

Use `casesFrom` with the project specs, count 100, and seed 7. Add explicit pattern/text pairs with expected results. Empty/empty accepts and empty/`a` rejects. `a*b` accepts both `b` and `aaab`. `[a-c]` accepts `a` and `c` and rejects `d`. `ab` rejects `aba`. Include the maximal active-set example above. Compare each matcher result from r0, the workbench's `speed` RV32 image, and the reference compiler's RV32 image against the same oracle. Require a decided, trap-free result and unchanged input memory. Build and run the reference image using the `imageFromCode` and `runImage` sequence in `tools/reference-check.mjs`. Run `speed` with per-pass checking against r0 enabled and require no rejections. The per-pass check protects changes to Typed IR, while the two machine runs also cover lowering.

Compare emulator `steps` on pattern `[a-c]*[b-d]*a*d` and text `abccabbd` for our r0 image, our `speed` image, and the reference image. Use the same default backend options for both workbench revisions. All three should return 1. Record instructions per call, including the parser. The evaluator statement count is for the check budget.

## Implementation order

1. Forward tape metadata through the Node project loader and add the string-list spec. Verify the project opens in Node and in the workbench with valid generated buffers.
2. Write the straight-line parser and emission loop, then add closure and the consuming loop in the same function. Check the small explicit fixtures against JavaScript.
3. Add the generated oracle and both RV32 paths, verify the step budget and checked pipeline, then finish the notes and exploration script with the benchmark results.

## Later

- Specialize on fixed pattern memory and propagate the resulting NFA rows through the matcher.
- Try jump threading and loop unswitching once the compiler can derive invariant state dispatch.
- If a ceiling is needed, put the hand-written fixed-pattern state machine in its own corpus project.
