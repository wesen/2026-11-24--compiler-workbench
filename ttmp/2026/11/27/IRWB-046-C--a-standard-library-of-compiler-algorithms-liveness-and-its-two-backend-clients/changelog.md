# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Design: the liveness interface, the scope decision and the src/stdlib layout (design-doc/01); probe 01 shows the two scopes disagree on the unreachable block

### Related Files

- ttmp/2026/11/27/IRWB-046-C--a-standard-library-of-compiler-algorithms-liveness-and-its-two-backend-clients/scripts/01-unreachable-block-scopes.mjs — probe 01, the unreachable-predecessor case

## 2026-11-27

src/stdlib skeleton + liveness; regalloc intervals and coalesce read it; baselines unchanged; tests in tests/stdlib

### Related Files

- src/stdlib/flow/liveness.ts — the primitive
- src/typed/backend/coalesce.ts — edges built in walkBackwards
- src/typed/backend/regalloc.ts — machineLiveness, intervals without its own sweep
