---
Title: Chess search corpus project
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
    - Path: abs:///home/manuel/code/wesen/2026-10-20--ds-js-os/apps/typed/chess/search.typed
      Note: Explicit-stack alpha-beta and search budgets
    - Path: abs:///home/manuel/code/wesen/2026-10-20--ds-js-os/bench/host/chess-engine.mjs
      Note: Host FEN encoding and upstream search assertions
    - Path: abs:///home/manuel/code/wesen/2026-10-20--ds-js-os/bench/reference/chess/reference-positions.json
      Note: Independent legal move and perft fixtures
    - Path: repo://corpus/reference.md
      Note: Project API and input formats
    - Path: repo://src/typed/evaluate.ts
      Note: Generated inputs and the per-pass statement cap
    - Path: repo://src/typed/lift.ts
      Note: Default front end and u16 buffer lowering
    - Path: repo://tools/reference-check.mjs
      Note: Reference compiler parity runner
ExternalSources: []
Summary: Port the existing Typed chess core as a checked corpus project with bounded pass cases and independent chess fixtures.
LastUpdated: 2026-11-26T10:34:45.107891853-05:00
WhatFor: ""
WhenToUse: ""
---

# Chess search corpus project

Add `corpus/projects/chess` using `state.typed`, `position.typed`, `moves.typed`, and `search.typed` from the user's ds-js-os repository at `b19062b29fe4fb6b02863e92510501dc5c4bc9b3`. The existing engine gives the compiler branchy integer code with piece dispatch, early exits from attack scans, and an explicit-stack alpha-beta search. Preserve move order, tie breaking, and the upstream material and advanced modes. Keep the small helpers, signed division and remainder in coordinate decoding, and insertion sort in move ordering as written. The host supplies legal positions and drives the engine directly.

## Port and memory layout

Keep the four-file split and extract the search fields from the app state into `record ChessSearchState`. The bool fields are `running` and `advanced`. The i32 fields are `ply`, `depth`, `maxDepth`, `budget`, `nodes`, `completed`, `bestMove`, and `score`. The host allocates the record separately from the board, one 32-bit word per field, and uses the front-end layout when decoding it.

| Region | Layout in u16 cells after the buffer length word |
| --- | --- |
| Board 0–127 | Rank stride 16 with eight playable cells per rank, starting at a8. Zero means empty. Piece kinds 1–6 follow PNBRQK, with 8 added for black. |
| Metadata 128–134 | Side (0 white, 1 black), castling rights (KQkq = 1,2,4,8), en-passant square (128 for absent), white and black king squares, halfmove clock, fullmove number. |
| Search frame at `160 + 16*ply` | Keep the upstream frame slots for depth, bounds, score, list cursor, pending move and flags. Scores in the frame have bias 32768. |
| Search undo at `384 + 10*ply` | Metadata cells 129–134, moving piece, captured piece, capture square, and one spare cell. |
| Search list at `1024 + 1024*ply` | 512 move slots followed by 512 priority slots. A move is `promotion*4096 + fromDense*64 + toDense`. Dense squares run a8 to h1, promotion codes 1–4 mean Q/R/B/N, and zero means no move. |
| Perft scratch | Four-cell frames at `160 + 4*ply`, undo at `256 + 10*ply`, lists at `512 + 512*ply`. Run perft and search separately because their scratch overlaps. |

Use zero-initialized 12,288-cell arenas for full workloads. The search cap is six ordinary plies plus four quiescence plies, so the last search list ends at cell 12,287. Use the upstream `charCodeAt` and `setCharCodeAt` operations and preserve the explicit stacks. The prior read-only probe ingested all 53 upstream functions with the default front end and produced both RV32 images. [Probe record](../log/01-diary.md), [lifter](../../../../../../src/typed/lift.ts)

- **Position and legal moves.** `chessMake` and `chessUnmake` manage the board, rights, clocks, and undo state. `chessPseudoMoves` dispatches by piece and emits into a bounded list. `chessLegalMoves` filters candidates by making them and checking the moving king before restoring the position.
- **Perft.** Call `chessPerft(board, depth)`. It counts legal sequences to exactly that depth, with one leaf at depth zero. The host exercises only the supplied depths, where the i32 count fits.
- **Search.** Change the existing entry to `chessStartSearch(board: buffer, state: ChessSearchState, options: buffer): i32`. It reads three u16 cells for depth, budget, and the advanced flag (0 or 1), then uses the existing clamps and fallback selection. The host supplies valid options. Call `chessSearchSlice(board, state, steps)` with the same arena and record until `running` is false, then read the move, score, completed depth, and nodes from the record. The original step function traverses children with negated bounds, applies cutoffs on return, and unwinds pending moves when the budget is exhausted. The options buffer is read-only and separate from the mutable arena, so future specialization can bind the settings on the same source and vary the position.

## Correctness and measurement

Use one Node harness in `tests/typed/chess.test.mjs`. Copy upstream `bench/reference/chess/reference-positions.json` with its `chess 1.11.2` attribution. Encode each FEN once in the host, including the king caches, castling and en-passant state, and clocks. Decode legal moves to UCI with promotion suffixes and compare the sorted list and check flag with the fixture. Compare perft with the supplied counts and assert that legal generation, perft, and finished search restore all 135 position cells. The opening's 20/400/8,902 counts and the pinned en-passant, castling, and promotion fixtures cover distinct paths. Exercise depth 3 through the same harness as an opt-in long case.

Use the upstream host runner's chess assertions on a small set of search cases. Check the forced move on the compact fixture below, mate-in-one membership and score +29999, quiet mate in two `d6c7` and +29997, and the defended rook's `d1d5` choice in material mode versus a different legal move in advanced mode. Check mate and stalemate scores (-30000 and 0), and that a budget-one search retains the first legal move, reports no completed depth, and restores the position. Use slice size 19 for the full runs. Use depth 1 and budget 1800 for the material and advanced depth-1 searches, depth 3 and budget 1600 for the quiet mate, and depth 4 and budget 1 for the budget case.

Build fresh images for r0, checked O2, checked `speed`, and the vendored reference compiler with a recorded policy. Use `benchCase` for initial memory and `runImage` for execution, threading returned bytes through the start and slice calls. Compare concrete results and memory with evaluator r0 using `agrees`. Read full guest memory when decoding outputs. Verify the fixture assertions before reporting speed. Run the larger oracle cases with explicit higher statement and instruction ceilings in the host harness, and treat timeouts as inconclusive. For measurement, report per-fixture RV32 instructions on opening perft 2, legal en passant perft 2, quiet mate, and defended rook in both modes. Sum start and slice instructions for each search and include node count and completed depth to show the work matched. [Reference runner](../../../../../../tools/reference-check.mjs), [evaluator](../../../../../../src/typed/evaluate.ts), [RV32 runner](../../../../../../src/typed/backend/run.ts)

## Generated pass checks

The normal project loader and parity runner check every function, so give each stateful helper valid arguments using the current input format. Use one fixed board per function, a shared 3,072-cell arena for the small fixtures, and only a few live snapshots:

- For `chessStartSearch`, use the forced position `k7/2K5/8/8/8/8/8/8 b - - 0 1`, zeroed state, and `options: {"cells":[1,4,0]}`. The only legal move is a8a7 (packed 8).
- For search helpers, capture the started root, prepared root, and pending child from that same search. The started root with `steps: 8` checks a full `chessSearchSlice`. The prepared root supplies real list and frame offsets for `chessSearchStep` and `chessAcceptScore`. For the latter, give the frame a narrow beta bound and sample scores on both sides of it. The pending child supplies the undo for completion and stop.
- For perft, use the forced board and `depth: [0,2]`. For move helpers, use the promotion and legal en-passant fixtures with matching offsets, piece, side, and move. Use an actual pseudo list for ordering/filtering and its corresponding count, and an actual post-make board and undo for unmake. Use the castling fixture for the direct castle helper. Reuse the forced board for other board helpers where its arguments fit.
- Encode buffers as `{"cells":[...]}`, state as `{"record":{...}}` with all fields set, and correlated scalars as fixed values. Scalar-only functions can use small valid domains such as `chessRay.direction: [0,7]`. Reuse the host FEN encoder and snapshot reads to prepare the checked-in specs.

Run the ordinary `casesFrom` and `meaningKept` checks against r0 on every changed pass. Verify that the generated r0 cases run without traps, then require decisive agreement and zero inconclusives in the evidence for each pass. An inconclusive sample can coexist with decided agreement. The cap is 20,000 evaluator statements per execution and the generated reference check uses 200,000 RV32 instructions. The prior probe measured 3,422 evaluator statements to start the forced search and 9,381 for its eight-step slice. Forced perft 2 used 14,662. Opening perft 1 already used 20,778, so leave opening and tactical searches in the explicit host suite. Recheck the port against both caps, including both checked pipelines. [Project loader](../../../../../../src/typed/program.ts), [parity runner](../../../../../../tools/parity.mjs), [input spec](../../../../../../corpus/reference.md)

## Corpus integration and optimization targets

Ship the four Typed files, `project.json`, `notes.md`, and `fixtures/reference-positions.json`. Use title “Chess search”, group `Programs`, pipeline `O2`, the upstream source order, the per-function inputs, and focus at `chessSearchStep` in the joined source. Add `chess` to the corpus index with the complete programs. Put the source revision and one reproducible run in the notes.

1. Import the core, trim the state record, and change the start signature. Confirm default ingest and lowering.
2. Bring over the fixtures and build the Node harness. Qualify the chess assertions and reference image at r0, then prepare and size the generated inputs.
3. Run `npm test` and `node tools/parity.mjs chess`. Use the harness to qualify O2 and `speed` and record the instruction baseline on matching runs.

| Compiler work | What chess gives it |
| --- | --- |
| IRWB-003 | Look for call reductions from inlining, rotation of ray or insertion loops, and register effects from coalescing and repeated constants such as frame strides and 32768. |
| IRWB-006 and IRWB-008 | Inspect SSA at the cursor and score joins. Coordinate packing and checked index arithmetic are candidates for rule-backed rewrites with exact evidence. |
| IRWB-007 | Bind contents of the read-only options buffer, then compare general and specialized runs on the same settings across multiple boards. Keep the mutable board outside the constant-memory promise. |
| IRWB-010 | Use instruction heat to pick a small coordinate or frame-address expression for rewrite discovery, equality saturation, or a verified machine window. Preserve signed-range preconditions. |
| IRWB-011 | Use chess as an integer control in tolerance experiments, with exact moves, scores, counts, and memory. |

A separate hand-optimized project could later provide a ceiling using the same search tree and oracle.

## Cuts after self-review

- Removed the extra search wrapper, source file, and input-validation API. The existing start/slice pair and valid host inputs are sufficient.
- Moved slice width out of the options buffer. Depth, budget, and mode are the settings worth specializing on.
- Replaced per-helper arena sizing and fixture-generation machinery with one small arena size and shared snapshots. The stock checks need coherent inputs for every function.
- Dropped the second override pipeline and extra coverage accounting. The checked pipelines and explicit advanced-search regressions already exercise the intended cases.
- Dropped Kiwipete, the duplicated perft table, and dedicated divide tooling. The supplied fixture JSON carries the counts and covers special moves.
- Dropped separate make/unmake, slice-width invariance, and upstream tuple suites. Position restoration, search assertions, and byte comparisons cover the experiment's correctness requirements.
- Consolidated the performance matrix and qualification into one host harness. The selected workloads distinguish move generation from the two search modes.
- Removed project-specific exploration and benchmark scripts, extra UI prompts, and a prescribed hand-optimized design. The workbench already exposes IR and source, and the baseline experiment needs only the Node harness.
