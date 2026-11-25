# Where this workbench differs from Compiler Workbench

The `wb` API keeps Compiler Workbench's names and result shapes where it
can. The kernel underneath is new (`src/typed`, on the IR framework),
and these are the places where that shows.

## Async passes, synchronous scripts

The kernel's pass manager is asynchronous: `p.apply`, `p.pipeline`,
`p.dryRun`, `p.actions` and `p.verify` run passes through the
framework's `applyPass`, whose analyses and contracts are async.

- In scripts (`scripts/*.js`), UI scripts' queries, button handlers and
  tasks, the console and the agent's eval, these calls are synchronous,
  as in the prototype. The code runs in a replay context
  (`src/workbench/sync.ts`): the first time it reaches a new pass, the
  attempt stops, the pass runs on a scratch copy of the program, its
  outcome is recorded, and the code runs again from the top, replaying
  recorded outcomes. Code with k new passes runs k + 1 times. It must
  make the same calls each time (no clocks or random numbers before a
  pass).
- Outside such a context (a free handle, such as `wb.current` in the
  browser's own console), these calls return Promises: `await
  p.apply('fold')`. `await` also works inside scripts.
- `wb.sync(({ wb, p, project }) => …)` runs any function in a replay
  context.
- A query that needs a pass the first time (`ui.query(({ p }) =>
  p.actions())`) is pending until it is done: components show
  "Running…", annotations show nothing, and everything that read it
  updates when it settles.
- Read-only results (`dryRun`, `actions`, `verify`) are cached per
  revision; results of scripts run on a fresh copy are cached by the
  project's files, the arguments and the parameter values.

## Passes are gated

`p.apply(pass)` checks the new revision against r0 (40 generated cases)
before keeping it, as the kernel's `Program.apply` does; a pass that
changes the meaning throws `contractRejected` and nothing changes. The
prototype applied the pass and left the check to `p.check()`.
`p.apply(pass, { check: false })` applies without the gate.
`p.pipeline(…)` reports a rejected step as `rejected` and goes on; `{
checkEach: false }` turns the gate off.

## Ids, facts and images

- Instruction ids are the kernel's, `insn:blend+0x1c`, without the
  revision (`@r4`); they resolve against the image compiled last
  (`p.image()`).
- Images are compiled with the kernel's backend (`lowerToImage`); their
  ids are `img:<program>@r<rev>`, with a `~<hash>` suffix for
  non-default options.
- Facts (`fn.fact(name)`, `fn.loops()`) are computed synchronously with
  the kernel's own analyses (`cfgOf`, `dominatorsOf`, `loopsOf`, and
  `solveArtifact` of the dataflow analyses) and cached per revision
  artifact. There is no "stale" status: a fact belongs to one revision.
  Dataflow facts carry the kernel's query views (`liveAfter`,
  `reachingAt`, `at`, `of`) next to `in` and `out`.
- Removed entities are found in the revision that still has them
  (`Program.lookup`), so `p.get(id)` works for them.

## Removed or reduced

- Reference images (`p.reference()`, `p.check({ against: 'reference'
  })`) are not shipped: `reference()` returns null and the check fails
  with `noReference`.
- `wb.pipeline(name)` builds a plain list of passes (`pipe`,
  `checkEach`, `build`, `explain`); `repeat` and `when` are gone.
- User analyses (`wb.analysis(name)`) take their lattice from
  `wb.lattice` (`set`, `map`, `interval`): the framework's lattices,
  which encode their values as JSON.
- `wb.source` is the source of this build (src/workbench, src/typed,
  site-src), not the prototype's.
- The agent panel is off unless the page defines `window.WB_AGENT = {
  sample(messages, options) }`; the build has no model connection and
  the page's Content-Security-Policy blocks network requests
  (`connect-src 'none'`).
