# Changelog

## 2026-11-26

- Initial workspace created.
- Research design written: four rules (`Split`, `Factor`, `Fuse`, `Rebase`), one new IR construct (a `fold`
  statement over a declared monoid, with a non-scalar state, a user-supplied combine and a single-assignment
  region body), the derivation P0 → P1 → P2 → P3 → P4 plus the lowering P5 and the argument that the lowering adds
  no rounding of its own, per-rule checking with measured f32 drift, a generality map (reached / fails), the
  alternatives considered, and a falsifiable experiment on the GB10.
- Two CPU probes added under `scripts/` with outputs in `various/`: the derivation is exact over the rationals at
  every intermediate program; `Fuse` and one-block `Rebase` are bit-identical in f32; the raw relative drift is
  dominated by the output contraction's conditioning (up to 4.2e6), so the tolerance relation is specified as
  term-scaled with `abs = ε·√K`.
- The brief is recorded verbatim in `reference/01-ticket-brief.md` as the ticket's scope of record.
- Verified: `nvidia-smi`, `nvcc`, `ncu` are absent from this worktree, so the design's GPU numbers are stated as
  predictions to be produced on the GB10 host, not as measurements.

### Related Files

- `design/01-deriving-streaming-attention-by-checked-rewrites.md` — the deliverable
- `reference/01-ticket-brief.md` — the authored request, verbatim
- `scripts/02-derivation-stages-probe.mjs` — per-stage exactness and f32 drift for every intermediate program
- `scripts/01-f32-and-exact-algebra-probe.mjs` — end-to-end drift, conditioning, `Factor` in isolation, rescale
  frequency
