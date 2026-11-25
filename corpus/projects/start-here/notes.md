A project is a folder of plain files: project.json, the typed sources,
scripts/*.js and ui/*.js. Open the Files view to see them; edit any one
and the workbench rebuilds what depends on it.

- `helpers.typed` and `kernels.typed` compile together, in the order
  project.json lists them. Line numbers in every view name the file they
  come from.
- `scripts/shape.js` is a read-only query; `scripts/o2-report.js` runs
  O2 on a fresh copy.
- `ui/status.js`, `ui/report.js` and `ui/next-pass.js` add the Status,
  Report and Next pass tiles. The report tile shows the o2-report
  script's result through `ui.from`; the status tile uses `shape`.
