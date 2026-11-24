# Imported sources

## `ir-source-workbench-v6/`

This directory holds a subset of `ir-source-workbench-v6-complete.zip` (IR Workbench 0.6.0, archive created 2026-11-24T21:49:56Z). The files are extracted unchanged: 200 files plus the release's `WORKSPACE-MANIFEST.json`. Every imported file matches its manifest entry byte for byte (SHA-256). To re-check:

```sh
python3 -I ../scripts/01-verify-manifest.py ir-source-workbench-v6
```

**Imported:** `src/`, `docs/`, `tests/`, `scripts/`, the top-level READMEs, `IMPLEMENTATION.md`, `package.json`, `package-lock.json`, `tsconfig.json`, `requirements-docs.txt`, `WORKSPACE-MANIFEST.json`, and the small v6 verification records in `output/`:

- `v6-verification.json`
- `v6-release-validation.log`
- `v6-browser-verification.json`
- `v6-ir-verification.json`
- `v6-guide-verification.json`

**Not imported.** These are all reproducible or not worth keeping in git:

| Path | Count | Why it was left out |
| --- | ---: | --- |
| `node_modules/` | 261 files | Linux-x64 build dependencies; `npm ci` restores them from `package-lock.json` |
| `dist/` | 319 files | Compiled JS, declarations and source maps; `npm run build` regenerates them |
| Remaining `output/` | 186 files, ~143 MB | Generated traces (up to 50 MB each), the 11.7 MB standalone `source-workbench.html`, PDFs, and v3–v5 evidence; `npm run verify:release` regenerates them |

To build, test or open the standalone workbench, extract the original zip into a scratch directory, or run `npm ci && npm run build:source` in a copy of this tree. The full archive is not stored in the repository.

The separately delivered `ir-workbench-v6-user-guide.md` is byte-identical to `ir-source-workbench-v6/docs/v6-user-guide.md`, so it is not stored twice.
