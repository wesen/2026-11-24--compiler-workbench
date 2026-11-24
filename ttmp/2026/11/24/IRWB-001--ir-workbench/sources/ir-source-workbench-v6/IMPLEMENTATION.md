# Shared implementation contract

This is a new standalone TypeScript project, not a modification of jig.

`src/core/types.ts` is the agreed shared API. Core has no domain imports. Each domain exports a `register*` function accepting `Registry` and pure task builder functions. Passes return JSON-serializable IR values; all inputs enter via `ctx.read(key)` and `ctx.require(task)`, and all algorithm decisions go through `ctx.decision`. Domains do not import runtime implementation classes. Units: geometric lengths in meters, angles in radians, time in seconds. Version strings explicitly invalidate cached algorithms. Artifact logical identity, content revision, and entity identity are distinct.

Assignments: root owns core runtime, strategies, integration, project/build/test harness and final reports. Geometry/CAD agent owns src/geometry and src/domains/cad.ts plus own tests. Physics agent owns src/math and src/domains/physics.ts plus own tests. Game/workbench agent owns src/domains/game.ts and src/workbench plus own tests. Communicate interface additions; do not overwrite colleagues' files.

Node >= 22; browser compatible pure TypeScript. ESM imports use .js extensions. Tests are JavaScript node:test modules importing compiled dist files; no npm runtime dependencies. Root supplies TypeScript/esbuild build plumbing. No network requests in workbench. All pass outputs have structural validators. Errors must be explicit, never silently return plausible-looking geometry or convergence results.
