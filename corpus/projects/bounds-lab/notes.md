bce removes a check `i >=u a.length` when a branch that dominates it
already proved `i < a.length` and the ranges analysis proves `i ≥ 0`.
`total` has both; `window` compares `i` with `k`, not the length;
`pairs` proves the bound for `a` and reads `b`; `tail` reads
`a.charCodeAt(i - 1)`, whose index is not the local the loop compares.

The Bounds checks tile (`ui/bce-helper.js`) lists them;
`ui/bce-marks.js` puts a badge on each check in the IR and a mark in the
source gutter. Both read `scripts/checks.js` through
`ui.from('checks')`.
