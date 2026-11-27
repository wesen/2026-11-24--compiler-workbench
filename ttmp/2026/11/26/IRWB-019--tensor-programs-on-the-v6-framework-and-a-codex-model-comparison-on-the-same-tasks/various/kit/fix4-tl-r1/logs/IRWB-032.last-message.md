Committed the F26 browser fix as **`3900b3e`**. Reuse checks now compare a stored, browser-compatible digest and raise `ContractError` when cases change.

`node tools/build-site.mjs` and `npm run build` passed. The final test run had **425 tests: 423 passed and 2 skipped**.

In a same-process measurement of 20 warm checks, detection added approximately **4.13 ms per Typed check** and **1.66 ms per tensor check**. These local measurements exclude GPU execution.