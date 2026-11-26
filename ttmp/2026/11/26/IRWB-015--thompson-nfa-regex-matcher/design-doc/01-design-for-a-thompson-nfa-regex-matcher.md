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

Build `corpus/projects/regex-nfa/` to compile a pattern buffer into a Thompson NFA and match it against a text buffer using explicit state sets. Use `[a-c]*d|ab*` for the fixed-pattern experiment. On the first `a`, both alternatives can advance. One arm then loops on a range and needs a terminal `d`. The other can accept immediately and loop on `b`. This gives the compiler overlapping paths, epsilon transitions and both literal and range predicates to specialize.

## Contract and grammar

`regexMatch(pattern: buffer, text: buffer): i32` returns `1` for a whole-buffer match, `0` for a miss and `-1` for invalid input. Both buffers are read-only and limited to 12 UTF-16 code units each. Check length at entry. The text may contain any code unit. A pattern is one or more nonempty alternatives, with concatenation binding more tightly than alternation.

```text
pattern := seq ("|" seq)*
seq     := piece+
piece   := atom "*"?
atom    := lower | "[" lower "-" lower "]"
lower   := "a" … "z"
```

Classes have one inclusive, ascending range. Equal endpoints are valid. The grammar rejects empty patterns or alternatives, groups, escapes, and repeated stars. Text may be empty and can match a starred sequence. Parse the entire pattern before returning a match or miss. Check lookahead before reading each class or star. Every call with valid workbench buffers must return a status without trapping.

## Typed implementation

Keep the frame arrays in `regexMatch`. Typed requires literal array sizes and permits indexing, but arrays cannot be assigned, passed or returned. Use a scalar helper `acceptsUnit(kind: i32, lo: i32, hi: i32, c: i32): bool`. For Literal it tests `c === lo`, for Range it tests `lo <= c && c <= hi`, and for any other tag it returns false. Use ordinary loops and branches so the optimizer has the original dispatch, calls, array accesses and control flow to work on. [Typed array parser](../../../../../../vendor/ds-js-os/compiler/typed/typed-wasm.js#L1280) · [Lifting](../../../../../../src/typed/lift.ts#L584) · [Corpus buffer reads](../../../../../../corpus/projects/strings/main.typed)

### Compile the NFA

Use five `Int32Array(13)` arrays named `kind`, `lo`, `hi`, `out0` and `out1`. State 0 is Accept. Tags 1–4 denote Literal, Range, Split and Accept respectively. Literal and Range have a consuming edge in `out0` and initialize both bounds. Split has two epsilon edges. Accept has no edges.

Use a cursor, a current sequence head and tail, and the accumulated start for completed alternatives. Use `-1` for an absent head. Every piece has exactly one open edge in `out0[tail]`.

1. Read a lowercase unit or validate all five units of a class before emitting its consuming state with `out0` open. At a non-delimiter, any other token is invalid. If a star follows, emit a Split with an open `out0` (skip) and `out1` pointing to the atom (repeat). Patch the atom's `out0` back to the Split. The Split is both head and tail of this piece.
2. Append the piece to the current sequence. For a nonempty sequence, patch its old tail's `out0` to the new piece head. Keep the sequence head and adopt the new tail.
3. At a bar or EOF, require a nonempty sequence and patch its tail to Accept. The first finished sequence becomes the accumulated start. For each later sequence, emit a Split to the accumulated start and the new sequence head, then adopt that Split as the start. After a bar clear the sequence head. At EOF use the accumulated start.

Each atom, star and bar accounts for at least one distinct pattern unit and emits at most one state. With Accept, the array bound is therefore 13 even for a malformed prefix. Any Split emitted at EOF is charged to a previously read bar. All traversed edges are defined once parsing succeeds. In particular, the skip edge of a starred piece can be patched directly to the next piece or Accept.

### Simulate over text

Use `new Int32Array(26)` for two active flag banks with scalar offsets 0 and 13. Use `new Int32Array(13)` for the epsilon work stack. Each bank doubles as the visited set while its closure is being built. With the five NFA arrays, the bank array and the stack, the actual payload is 104 words (416 bytes).

```text
for pos = 0 through text.length:
    clear destination flags for the emitted state IDs
    reset stack size
    if pos == 0:
        enqueue start
    else:
        c = text.charCodeAt(pos - 1)
        for state in emitted IDs:
            if previous[state] and acceptsUnit(kind[state], lo[state], hi[state], c):
                enqueue out0[state]
    while stack is nonempty:
        pop state
        if kind[state] is Split:
            enqueue out0[state]
            enqueue out1[state]
    swap the scalar bank offsets
return previous[0]

enqueue s:
    if destination[s] == 0:
        destination[s] = 1
        push s
```

Here `previous[state]` and `destination[state]` index the same array with different offsets. Write the short enqueue sequence where needed. Marking on push means every worklist pop is unique within a closure. After each swap, the previous bank contains exactly the states reachable after consuming `pos` units and taking all available epsilon edges. Accept can be active at an intermediate position. Only its flag after the last unit decides the result.

## Corpus integration and generated cases

Put the source in `main.typed`, the grammar and an inspection prompt in `notes.md`, and a small match/miss walkthrough in `scripts/explore.js`. The script should compare the two inputs with JavaScript and show the checked `speed` result. Set `focus` in `project.json` to the actual consuming-state scan line. A single `main.typed` file is discovered automatically. [Corpus API](../../../../../../corpus/reference.md) · [Project loader](../../../../../../src/typed/project.ts)

```json
{
  "title": "Thompson NFA regex matcher",
  "group": "Programs",
  "ingest": { "tape": true },
  "pipeline": "speed",
  "inputs": {
    "regexMatch": {
      "pattern": { "string": "[a-c]*d|ab*" },
      "text": { "buffer": [0, 12], "cell": [97, 101] }
    }
  },
  "scripts": { "explore": { "fresh": true } }
}
```

Keep tape ingestion. The feature probe recorded in the diary reproduced opcode 252 in the default Wasm inspector and ran successfully through tape ingestion and the stock RV32 reference compiler. The workbench already honors `ingest` metadata. For the focused harness, pass `ingest: { tape: true }` to `Program`. Before adding the project to the shared corpus, wire the existing metadata through `Program.fromProject` and `ingestProject` so the Node reference and parity tools can open it. Smoke-test both paths with the same project. [Probe](../log/01-design-diary.md#step-2-write-the-design-and-verify-its-assumptions) · [Workbench loader](../../../../../../src/workbench/projects.ts#L249) · [Node program loader](../../../../../../src/typed/program.ts#L132) · [Node artifact loader](../../../../../../src/typed/project.ts#L77)

Run the default checked pipeline with this profile (40 cases per function, seed 7). Repeat on a fresh program with `pattern: { buffer: [1, 12], cell: [97, 99] }` and the same text spec to exercise varying patterns. The scalar helper is total on arbitrary i32 inputs and can use the default case generator. Use the directed fixtures below for positives, errors and other operator combinations. [Case generator](../../../../../../src/typed/evaluate.ts#L117) · [Meaning check](../../../../../../src/typed/evaluate.ts#L594)

## Check correctness and cost

For valid patterns, decode buffers with `String.fromCharCode(...cells)` and use this flag-free JavaScript oracle. The final lookahead requires absolute end of input, including for text with a trailing newline. Use explicit expected statuses for malformed and oversized inputs.

```js
Number(new RegExp("^(?:" + pattern + ")(?![\\s\\S])").test(text))
```

| Pattern | Text | Expected |
| --- | --- | --- |
| `[a-c]*d\|ab*` | `d`, `a`, `abbd`, `abb`, `abbe`, `d\n` | 1, 1, 1, 1, 0, 0 |
| `ab\|c` | `ab`, `c`, `ac` | 1, 1, 0 |
| `[b-d]` | `a`, `b`, `d`, `e` | 0, 1, 1, 0 |
| `[a-a]*` | empty, `aaa`, one code unit 0 | 1, 1, 0 |
| `a*a*a*a*a*a*` | twelve `a` units | 1 |
| Empty pattern, `a\|`, `(a)`, `a**`, `[c-a]`, `a[` | empty | −1 each |
| Thirteen literal units / `a*` | empty / thirteen `a` units | −1 each |

`\n` denotes a line feed. For each fixture, compare r0 with the oracle, and replay through the optimized evaluator and both RV32 images. Require the expected status, unchanged input bytes, and zero traps or limits. Keep per-pass comparisons against r0 on both generated profiles. Record any rejected or inconclusive pass. For focused reference comparisons, use `referenceCompile` and `referenceRun` with the same case memory used by the workbench image, following the corpus reference check. [Reference runner](../../../../../../src/typed/reference.ts) · [Corpus reference check](../../../../../../tools/reference-check.mjs)

**Budget.** Each of at most 13 closures clears and pops at most 13 entries. Each of at most 12 input steps scans at most 13 states. This bounds the three repeated operations by 494 visits total, before parser and loop overhead. The 20,000-statement limit leaves roughly 40 statements per visit before overhead. That is an order-of-magnitude check, since one visit can lower to several statements. Measure r0 and accepted revisions on both profiles and on the 13-state, 12-unit fixture with `evaluate` statement counts. Require zero inconclusive cases and check that the stress fixture has headroom. If lowering consumes the margin, use the measured counts to reduce the text cap and adjust the fixtures together. Keep the framework limit at 20,000.

**Measurements.** Record per-case RV32 instructions and image bytes for general r0 and `speed`, with the same backend options and inputs. Include the fixed pattern on empty, matching and last-character-miss texts, with a match and a miss at length 12. Count the whole call, including parsing. When a specialized candidate exists, measure it on the same fixed-pattern cases. Use the IR or image listing to attribute changes to parsing, dispatch or the scan. For IRWB-003, inspect helper inlining and loop rotation. If needed, toggle copy coalescing, constant homes or chain layout to explain a change. [Speed pipeline](../../../../../../src/typed/passes.ts#L1104) · [Backend options](../../../../../../src/typed/backend/options.ts)

## Fixed-pattern experiment

Bind the exact length and u16 cells of `[a-c]*d|ab*` by parameter. Keep the address and text dynamic, and replay at two valid placements of the pattern buffer. Check specialized results against general r0 and JavaScript over matching, missing and oversized texts. The current `specialize` pass binds scalar parameters or record fields. Constant buffer contents are the proposed IRWB-007 input. [Current specialization pass](../../../../../../src/typed/specialize.ts)

First look for the parser to disappear and for NFA tags and edges to become constants. The next target is direct control flow for reachable state sets. It gives jump threading known successors and lets loop unswitching move predicates proved invariant in a residual loop. The generic scan's tag varies by state. For IRWB-006, IRWB-008 and IRWB-010, the literal/range tests are a small target for SSA propagation, verified rewrite rules and exact checking. Require exact result and memory comparisons throughout. IRWB-011's float tolerance is outside this integer workload.

## Implementation order

1. Implement the tape-backed literal matcher and add range, star and top-level alternation. Check r0 against the fixtures and measure the step budget.
2. Wire project tape metadata into Node ingestion, then add the corpus files. Check both generated profiles and compare the images with the reference.
3. Record general r0 and `speed` measurements. Use those cases for the later fixed-pattern compiler experiment.

## Cuts after self-review

- **Grouping, empty-pattern semantics and the parser frame stack.** Top-level alternation and atom stars give overlapping paths and loops, and starred sequences still test acceptance of empty text.
- **Synthetic Jump states and a separate state-overflow status.** Directly patched edges bound the graph by the pattern length plus Accept, so one input cap and one error value suffice.
- **Compact state lists, counters, a separate visited array and early termination.** Dense flag banks serve as both state sets and closure deduplication for 13 states.
- **Parser-only helper and explicit helper input profiles.** The hot scalar predicate preserves the inlining target and works with default generated inputs.
- **Extra generated profiles, a grammar generator, a host recognizer and exhaustive sweeps.** Two per-pass profiles and directed JavaScript fixtures cover variation, overlap and errors.
- **Per-operation statement estimates and a second budget threshold.** The visit bound and measured headroom under the existing pass limit drive sizing.
- **Separate DFA corpus project, runtime fallback and a prescribed determinization plan.** A measured specialization on exact-pattern inputs tests the compiler hypothesis directly.
- **Full benchmark matrix and cross-ticket reading list.** Paired RV32 counts and direct source links support the initial experiment.
