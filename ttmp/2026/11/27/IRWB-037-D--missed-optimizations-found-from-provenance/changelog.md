# Changelog

## 2026-11-27

- Initial workspace created. Baselines re-measured (regex 6,933, LZ 156,782, chess 10,038,193 under `speed`;
  corpus `speed` 867,770 against the reference's 875,417).
- Design committed (`60307df`) before any change to `src/`.
- `bce` compares linear forms over named values (`src/typed/linear.ts`), so a check on `i + c` goes when a
  dominating test proved the bound; `ranges` maps a bottom environment to bottom.
- `bounds-offset` 1,355 → 1,215 and `bounds-lab` 5,012 → 4,788 under `speed`; corpus `speed` 867,406, `O2`
  1,089,907. No rule added: the hot shapes no pass improves are loads, calls, control flow and increments
  (40.9 % of executed instructions), and none is expressible as a verified rule.
