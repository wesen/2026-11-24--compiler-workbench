Committed as `fab6334` (`IRWB-031: validate correspondence entry entities`).

Before the fix, the direct-correspondence regression failed with **“Missing expected rejection”** for `made-up-source`. After the fix, it passed for unknown entry IDs on both source and target sides.

The last run reported **412 tests: 410 passed, 2 skipped, 0 failed**. The build also passed.