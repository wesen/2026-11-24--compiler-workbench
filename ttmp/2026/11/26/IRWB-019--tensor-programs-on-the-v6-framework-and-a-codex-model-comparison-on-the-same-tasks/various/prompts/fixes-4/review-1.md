Review of IRWB-032. F24 and F25 are accepted as they are. F26 needs one change.

**F26 breaks the browser build.** `src/framework/` is bundled into the browser workbench by `tools/build-site.mjs` (esbuild, `platform: 'browser'`), and no framework file imports a Node built-in. `import { isDeepStrictEqual } from 'node:util'` in `differential.ts` makes `node tools/build-site.mjs` fail: `Could not resolve "node:util"`. The build passes on your base.

Needed:
- Compare the regenerated cases without Node built-ins. The framework already canonicalizes and hashes plain data (`src/framework/core/`, for example the canonical encoding and `sha256.ts` used for content addresses). Use what is there, for example by storing a canonical digest of the cases with the reused entry and comparing digests, so the comparison is also cheaper than a deep equality.
- Use `ContractError` (or the error type the module already throws for contract violations) rather than a bare `Error`, if one fits.
- Run `node tools/build-site.mjs` before your last commit and check that it passes, in addition to the tests you ran before.
- Re-measure the cost on warm reuse checks.
- Commit with a message starting `IRWB-032: F26`.

Your final message: the new commit hash, the build-site result, the test counts from your last run, and the measured cost.
