At r0, open [search step](focus:fn:chessSearchStep) in [IR](view:ir).

The attack code has loops for [directions](focus:bb:chessAttacked.16)
and [ray traversal](focus:bb:chessAttacked.19).

Ported from `apps/typed/chess/` in ds-js-os at revision
`b19062b29fe4fb6b02863e92510501dc5c4bc9b3`. The board is a
caller-supplied u16 buffer with eight ranks at stride 16, starting at
rank 8. The first eight cells of each rank hold files a–h. Cells 128–134
store side to move, castling rights, the en passant square, both king
squares, and both clocks.

- `chessPerft(board, depth)` takes a 2,048-cell legal position buffer
  and depth 0–3. It counts legal move paths of exactly that depth and
  returns 1 at depth zero.
- `chessSearch(board, state, depth, budget, advanced)` takes a
  9,216-cell legal position buffer, a fresh zeroed `SearchState`,
  depth 1–3, a positive node budget, and an advanced-evaluation flag.
  It runs iterative-deepening alpha-beta and returns a packed move,
  or zero at a terminal position. On budget exhaustion it returns the
  last completed iteration's move or the first legal move if the search
  completed no iteration. The state records the score, visited nodes,
  and completed depth.

Both entries restore cells 0–134 and use the remaining cells as scratch.
Packed moves use `4096 * promotion + 64 * fromDense + toDense`, with
dense square zero at a8. Promotion codes 1–4 represent queen, rook,
bishop, and knight.

Run **explore** in Scripts to check `speed` on a fresh
copy and find the search step and attack-ray loop headers in the IR.
The generated cases use pinned en passant at depth one and a promotion
position with budget two. The concrete cases use the included chess
1.11.2 fixtures and compare the evaluator with all three RV32 images.

From the repository root, after `npm run build`

```sh
node --test tests/typed/chess-search.test.mjs
node tools/parity.mjs chess-search
node corpus/projects/chess-search/scripts/fixtures.mjs
node corpus/projects/chess-search/scripts/fixtures.mjs measure
```

The measurement uses `quiet-mate-in-two` at depth 3, budget 1,600, with
advanced evaluation. All images returned `d6c7`, scored 29,997,
completed depth 3 in 1,344 search nodes, and agreed with the evaluator
on every guest memory byte. The table gives executed RV32 instructions.

| Position | r0 | Checked speed | Reference |
| --- | ---: | ---: | ---: |
| Quiet mate in two | 14,804,396 | 10,079,349 | 10,827,760 |

The speed image enables `chains`, `coalesce`, and `homes`. The reference
compiler receives the exact same assembled Typed source.
