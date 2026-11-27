Review of <ID>: F2, F3, F4 and F6 are accepted as they are. F5 needs another pass.

**F5 removes properties.** The brief asked you to keep every property the tests check now. Several of your changes replace an exact corpus-wide quantity with `> 0`, which no longer checks anything:
- `backend.test.mjs`, the O2 image sizes: `{ ours: 5160, theirs: 7628 }` became `ours > 0 && theirs > 0`;
- `backend.test.mjs`, P2.4: the bound `inconclusive <= 4` was dropped;
- `backend.test.mjs`, the r0 agreement: `inconclusive: 14` and the function count became unchecked;
- `passes.test.mjs`, FULL mode: `{ projects: 44, fns: 70, total: 7000, agree: 6986, inconclusive: 14 }` became two identities;
- `ssa.test.mjs`: `[135, 3322]` became `fns > 0 && gets > 0`;
- `tape.test.mjs`: `{ identical: 24, checked: 22 }` became `> 0`.

These totals are regression checks on the compiler's output and on the checks' coverage. A code-size regression in one project, or a check that silently decides fewer cases, must still fail a test.

**What to do instead:** keep each quantity, but per project, so that adding a valid project adds an entry and breaks nothing.
- Give each test a table of the expected value per project (bytes, decided and inconclusive cases, SSA gets, tape results), and assert each project's value against its row.
- A project that is not in a table fails with a message saying to add its row. That is a deliberate, one-line change when a project is added.
- Where a total is fully determined by per-function rules (for example 40 cases per function), derive it, as you did.
- Keep the inconclusive bound as a per-project expectation. Today only `my-analysis` has inconclusive cases in P2.4.
- Before changing a total, find out what it measures. Some comments cite the book (chapter 13's "6986 decided cases (44 projects)"), while the asserted values cover the current corpus. Keep the book's figures wherever a test states them as the book's, over the projects the book used.

Keep the tests' names and the rest of your commits. Commit the change as `<ID>: F5 per-project expectations`. Your final message: the tests changed, what each now asserts, how you checked that a temporary valid project only needs table rows, and the test counts.
