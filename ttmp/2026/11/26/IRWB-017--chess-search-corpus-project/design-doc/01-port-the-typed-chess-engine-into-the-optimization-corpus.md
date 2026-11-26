---
Title: Port the Typed chess engine into the optimization corpus
Ticket: IRWB-017
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/code/wesen/2026-10-20--ds-js-os/apps/typed/chess/moves.typed
      Note: Move generation and perft traversal
    - Path: abs:///home/manuel/code/wesen/2026-10-20--ds-js-os/apps/typed/chess/position.typed
      Note: Board layout and make and unmake
    - Path: abs:///home/manuel/code/wesen/2026-10-20--ds-js-os/apps/typed/chess/search.typed
      Note: Explicit-stack search and tactical extensions
    - Path: abs:///home/manuel/code/wesen/2026-10-20--ds-js-os/bench/reference/chess/reference-positions.json
      Note: Independent legal moves and perft fixtures
    - Path: repo://src/typed/evaluate.ts
      Note: Generated cases and statement-limited meaning checks
    - Path: repo://src/typed/project.ts
      Note: Source assembly and entry metadata integration
    - Path: repo://tools/reference-check.mjs
      Note: RV32 reference image comparison
ExternalSources: []
Summary: Port the existing Typed chess core as one checked corpus project with bounded pass cases and fixture-backed RV32 search.
LastUpdated: 2026-11-26T10:58:13.849223459-05:00
WhatFor: ""
WhenToUse: ""
---

# Port the Typed chess engine into the optimization corpus

## What the project measures

Add `corpus/projects/chess-search/` using the existing Typed engine from
`/home/manuel/code/wesen/2026-10-20--ds-js-os/apps/typed/chess/`. One entry runs
its explicit-stack negamax alpha-beta search. A second entry counts legal move
paths to a fixed depth, a chess test known as perft. This design uses upstream revision
`b19062b29fe4fb6b02863e92510501dc5c4bc9b3`. The search runs branches
that depend on the board, on intermediate scores, and on which candidate was
visited first. Perft alone would be a smaller port, but it would miss move
ordering, search frame transitions, and pruning. Keep perft in the same
project so the fixture oracle can isolate failures in move generation.

Carry over the ordinary helper calls and arithmetic in the source. In
particular, keep the division and remainder in the square and move codecs,
the direction loops in `chessAttacked`, and the copies and branches in
`chessOrder`. These give the compiler integer expressions and control flow
to improve. Keep the position as caller-supplied array data and depth, node
budget, and advanced evaluation as scalar parameters. A literal board inside
Typed would bake one workload into the baseline and prevent running the same
code on other reference positions.

- **IRWB-003** exercises inlining through move and square helpers, rotation through ray and traversal loops, and the `chains`, `coalesce`, and `homes` backend options.
- **IRWB-006** gets integer rewrite candidates in the codecs and joined loop-carried values such as the ray cursor and compacted move count for the SSA view.
- **IRWB-008** can check rule-backed edits to the codecs and integer expressions exactly where the rule hypotheses hold.

## Typed engine and storage

Port `position.typed`, `moves.typed`, and `search.typed`. Keep the search
fields of `WorldState` in a `SearchState` record in `state.typed`. Those are
`running` and `advanced` as `bool`, plus `ply`, `depth`, `maxDepth`,
`budget`, `nodes`, `completed`, `bestMove`, and `score` as `i32`.
Keep the clock bookkeeping in make/unmake so the full position round-trips.
Drop the opening initializer, position copier, UI state, and timer slicing. Omit the source's
bad-depth, budget-clamping, and move-list overflow handling. The valid
domain below covers the storage and knob constraints.

Use these two host entries. The host supplies a fresh zeroed state record
for each search.

```typed
function chessSearch(board: buffer, state: SearchState, depth: i32,
                     budget: i32, advanced: bool): i32 {
    chessStartSearch(board, state, depth, budget, advanced);
    while (state.running) { chessSearchStep(board, state); }
    return state.bestMove;
}
```

The second entry is the existing `chessPerft(board: buffer, depth: i32): i32`.
It returns 1 at depth zero and otherwise the number of legal paths of
exactly that depth. Both entries restore board cells 0–134 before returning.
Scratch cells can retain their last contents. Compare scratch for compiler
parity because the evaluator compares guest memory. The chess fixture
checks only use defined chess outputs and the restored position.

| Area | Layout in u16 cells |
| --- | --- |
| Position, both entries | 0–127 use eight ranks of stride 16 from rank 8 to rank 1, files a–h in slots 0–7. Cell 128 is side (0 white, 1 black), 129 is the castling mask (KQkq weights 1, 2, 4, 8), 130 is the en passant square (128 for none), 131–132 are white and black king squares, 133–134 are halfmove and fullmove clocks. |
| Perft, depth 0–3 | 2,048 cells total. Per ply `p`, the four-cell cursor frame starts at `160 + 4*p`, undo at `256 + 10*p`, and a 512-cell list at `512 + 512*p`. At the last ply, count the legal moves directly. |
| Search, depth 1–3 | 9,216 cells total. The 16-cell frame starts at `160 + 16*p`, undo at `384 + 10*p`, and the 512 moves and 512 priority keys start at `1024 + 1024*p`. Quiescence can reach ply `depth + 4`, at most 7. At that cap, checked nodes score evasions in place. |

Reuse the source layout. Separate arrays for position, undo, and frames
could make ownership clearer, but would require rewriting the helpers and
would change the memory access workload. Each legal side has at most 16
pieces, each producing at most 27 pseudo-moves, so the 512 slots have
headroom even with promotions and castling. An undo slot uses nine cells
within its ten-cell stride. It saves metadata cells 129–134, the original
piece, the captured piece, and the capture square. Search stores signed
frame scores with the source's 32768 bias.

For square conversion and FEN encoding, use `bench/host/chess-engine.mjs`
from the source repository. Empty cells are zero. White p/n/b/r/q/k use
1–6 and black uses the same values plus eight. Move codes are
`4096*promotion + 64*fromDense + toDense` with dense square 0 at a8.
Promotion codes 1–4 mean queen, rook, bishop, and knight. Zero indicates
no move. The host pads each encoded position with zeroes to the entry's
buffer size.

Preserve pseudo-move enumeration order. Pawns handle pushes, captures, en
passant, and all four promotions. Sliding pieces walk rays and kings test
castling rights and transit attacks. Test legality with make, king attack
check, and unmake. Perft compacts legal moves before descending. Search
tests each candidate on demand and updates the parent when the child
returns. The parent owns the pending move and its undo slot. Negate the
child score and swap and negate alpha and beta on descent. Keep the
source's material and activity scores, tactical extensions, stable move
ordering, iterative deepening, and budget unwind. A single fixed-depth
material search would be smaller, but it would skip the checked-evasion,
ordering, and unwind paths that make this port useful. On budget
exhaustion, report the last completed iteration or the first legal move
if none completed.

## Generated cases and the statement budget

Use one legal fixture per checked entry. A per-cell random generator
cannot keep placements, king coordinates, castling, and en passant
mutually consistent. A whole-board choice would add variety, but would
require extending the current input generator, whose `oneOf` produces
scalar values. Use `{cells: [...]}` with the actual zero-padded FEN
encoding. The concrete fixture suite below supplies board diversity.

| Entry | Exact `project.json.inputs` specification |
| --- | --- |
| `chessPerft` | `board: {cells: encode("en-passant-pinned", 2048)}`, `depth: 1`. Expected perft is 6. |
| `chessSearch` | `board: {cells: encode("promotion-and-underpromotion", 9216)}`, `state: {record: {...}}` with every field listed above set to 0, `depth: {oneOf: [1, 2, 3]}`, `budget: 2`, `advanced: {bool: true}`. Here the boolean spec randomly generates both values. |

`encode` is a host-side generation step. The checked-in JSON contains
the numeric arrays and record fields. The search cases prepare the root,
descend, and exercise the leaf or tactical preparation path and budget
unwind. At this budget they return the fallback and leave `completed`
at 0. Completed iterations and deep cutoffs are exercised by the
concrete fixture checks. Raising the pass limit would put the full search
in every pass replay. Keep the existing 20,000-statement gate and require
zero traps and zero inconclusives for both entries.

**Probe results.** Workbench ingested all four original source files
(25,501 characters, 53 functions) through the vendored front end and
`Program.fromProject`. A two-file smoke test confirmed ordered source
assembly, cross-file calls, short-circuit loops, braced break/continue,
explicit record input, bools, and u16 buffer load/store. The game source
also qualified the actual integer arithmetic and control flow in both
RV32 backends. The probe used the upstream code and an in-memory
search wrapper with the proposed loop and the original state record.
Pinned en passant perft took 9,206 evaluator statements. Promotion
search took 12,054–12,953 at budget two across all proposed depth and
boolean values. At budget three it took 19,524–19,851, too close to the
limit for pipeline revisions. Opening perft at depth one exceeded
20,000. The scoped probe completed `speed` with 18 changed revisions,
then agreed on 20 generated cases per entry with no traps or limits.
Recheck the limits after trimming the port.

## Corpus files and entry metadata

Under `corpus/projects/chess-search/`, put the wrapper in `main.typed`,
the record in `state.typed`, and the three core files alongside them.
Use the following metadata plus the exact `inputs` above. Set the focus
to the actual source line of the wrapper's call to `chessSearchStep`
after the files are assembled.

```json
{
  "title": "Chess search",
  "about": "Branch-heavy integer alpha-beta and legal move generation.",
  "group": "Programs",
  "pipeline": "speed",
  "sources": ["main.typed", "state.typed", "position.typed", "moves.typed", "search.typed"],
  "entries": ["chessSearch", "chessPerft"]
}
```

Add `notes.md` with the upstream source revision, the two entry contracts,
and the fixture and measurement commands. Keep the copied reference data
under `fixtures/`. Put a small inspector example in `scripts/explore.js`
to show the checked pipeline and link to the search step and ray loops in
the IR. Use `scripts/fixtures.mjs` as the project-local Node runner for the
fixture and measurement commands. The corpus scanner includes project
directories automatically.

**Small loader change.** `Program` already accepts `entries` and passes
them to the invariant and default `check`. The smoke probe confirmed that
direct construction scoped checks to the requested entry, while
`Program.fromProject` ignored an `entries` field in project metadata and
attempted a standalone call to the helper. Add optional `entries` to
`ProjectMeta` and forward it in `Program.fromProject` and the browser
`kernelFor` path, including fresh runs. Forward the same roots through
`runPipeline` and the corpus parity tool's final `meaningKept` check.
The reference-check tool uses `Program.fromProject` and inherits the
scope. Giving every helper a generated input spec would be larger and
some helpers require valid in-progress frames. Keep the root list explicit
and let root calls exercise helpers.

## Fixture oracle and measurement

Copy `bench/reference/chess/reference-positions.json` from the upstream
repository. Its chess 1.11.2 data give independent legal UCI move sets,
check status, perft counts, and mate witnesses. Port the fixture portions
of `bench/host/chess-engine.mjs` as plain host operations. Use its FEN
encoder and packed-move decoder, and use compiled record offsets for
reading search state. A second chess engine in the corpus would duplicate
move generation. The committed fixture gives independent assertions with
no runtime dependency on the upstream checkout.

1. On each reference position call `chessLegalMoves` and `chessInCheck`
   with the 2,048-cell board, list offset 512, undo offset 256,
   and side-to-move as the check argument. Compare the sorted decoded
   move array and check status. Run `chessPerft` at each depth recorded in
   the JSON, including opening 20, 400, and 8,902. Compare the board's
   first 135 cells with the original after make/unmake traversal. Read
   directly from returned memory since the UI preview truncates buffers.
2. For search, use the source's advanced search at depth one for the two
   mate-in-one positions, the terminal fixtures, and `defended-rook`.
   On `defended-rook` require a legal move other than the poisoned pawn
   capture `d1d5`, matching the upstream runner's assertion. For each
   mate-in-one, check the move against `mate_in_one_uci` and the score
   against 29,999. Expect move zero
   and score −30,000 at checkmate or 0 at stalemate. At depth three and
   budget 1,600 on `quiet-mate-in-two`, require `d6c7`, score 29,997,
   and completed depth 3. Check that any returned move is in the
   reference legal set, the search is stopped at ply zero, and the board
   is restored. Use budget 1,600 for these concrete calls.
3. Build identical-source reference RV32 images as in
   `tools/reference-check.mjs`; compare evaluator and emulator return
   values and guest memory on the generated entries. Use `benchCase`,
   `evaluate`, and `runImage` for the concrete calls so their limits are
   explicit. Require successful completion and agreement on r0 and the
   optimized image. The depth-three probe took 7,885,397 evaluator
   statements and agreed with all three images. The probe executed 14,855,677
   instructions at r0, 10,261,277 with the speed options below, and
   10,880,400 in the reference image. Start the concrete runner with
   limits of 20 million evaluator statements and 30 million emulator
   instructions, then qualify the
   entire fixture before recording results.
4. For the performance row, use that same quiet mate-in-two call from
   fresh input. Report executed RV32 instructions (`runImage(...).steps`)
   for r0, checked `speed` with `chains`, `coalesce`, and `homes`,
   and the reference image. Use the same board, requested depth, and
   budget across images. Report a count only after the result and memory
   agree, so visiting fewer chess nodes cannot masquerade as better codegen.

## Implementation order

1. Port position and move generation and wire the fixture encoder. Get
   legal-move parity and perft before wiring search.
2. Port the search state and driver. Check the mate, terminal, and unwind
   cases, then confirm the bounded inputs finish with margin.
3. Wire entry metadata and run the checked pipeline in the corpus and
   browser paths. Verify it uses both roots and reports zero traps,
   inconclusives, or disagreements.
4. Add the inspector script and run the reference comparison and
   instruction-count row.

## Later

- IRWB-007 could specialize on initial board cells before the first make, once partial evaluation can track initialized and subsequently mutable memory.
- IRWB-010 could use the isolated integer codecs as windows for rewrite search.
- A separate hand-optimized ceiling could keep the same traversal and use direct bit operations in the square and move codecs.
