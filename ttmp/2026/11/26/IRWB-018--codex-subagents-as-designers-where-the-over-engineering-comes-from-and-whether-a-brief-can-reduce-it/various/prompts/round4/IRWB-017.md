## Your program — ticket IRWB-017: the existing chess search, ported into the corpus
The user already has a chess engine written in Typed in their own repository `/home/manuel/code/wesen/2026-10-20--ds-js-os` (read only; do not modify it): `apps/typed/chess/` (`position.typed`, `moves.typed`, `search.typed`, `state.typed`, and others), with reference positions in `bench/reference/chess/reference-positions.json` and a host runner in `bench/host/`. Design how to bring its engine core (position, move generation, search) into this repository as a corpus project.
- Why: branchy integer code, an explicit-stack alpha-beta search and move generation — realistic control flow, unlike loop-heavy kernels.
- Oracle: perft node counts for known positions, and the reference positions.
