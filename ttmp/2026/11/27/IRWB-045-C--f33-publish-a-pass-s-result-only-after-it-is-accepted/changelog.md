# Changelog

## 2026-11-27

- Initial workspace created
- Probe 01 (R3 probe 03 plus three controls) run before the change: the rejected candidate is the caller's store
  head, the manager keeps an accepted execution and a fact through `preserveViolated`, and an accepted application
  with a store cannot publish at all (`ir.unpublished`).
- Design committed (`design-doc/01-publish-a-pass-result-only-after-it-is-accepted.md`): one acceptance boundary,
  a private candidate, a deferred contract, one store publication carrying the manager's evidence.
- `IRStore.publish(next, {base?, generation?, acceptance?})` added; `prepareNative` prepares privately; `applyPass`
  verifies deferred, rolls back on every later rejection, publishes once.
- The two `F33:` tests in `tests/framework/r3-defects.test.mjs` lose their `todo` and pass; suites, baselines,
  `npm run check` and `node tools/build-site.mjs` clean.
- Probe 02 added for the accepted side (a two-step chain on one store, a stale base, accepted evidence, a rejected
  application on a fresh store).
