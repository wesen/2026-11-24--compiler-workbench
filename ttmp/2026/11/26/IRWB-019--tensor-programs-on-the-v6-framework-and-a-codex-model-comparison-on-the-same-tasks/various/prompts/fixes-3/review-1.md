Review of `fc39478`. The list check is right, and the tests show it. One case is still open, and it is the case F23 came from.

**Entry IDs are not checked.** `validateCorrespondence` compares the declared `sourceEntities` and `targetEntities` with the artifacts' enumerations. It does not look at the IDs inside `c.entities` (each entry's `from` and `to`).
- A correspondence built through `makeCorrespondence` is covered, because that function checks its entries against its own lists.
- A `Correspondence` object built directly is not. For example: correct lists, and an entry `{from: ['s1'], to: ['made-up']}`. Stage 3's tensor lowering builds its correspondence that way, with entries like `{from: [m, e, s, y], to: [k0]}`.

Needed:
- When a type enumerates its entities, reject any entry ID on that side that is not among the artifact's entities, with an error naming the ID.
- Add a regression test that builds such a `Correspondence` directly, without `makeCorrespondence`. Run it on `fc39478` first and record in the diary how it fails.
- Keep everything else as it is. Commit with a message starting `IRWB-031:`.

Your final message: the new commit hash, the test that failed before and how, and the test counts from your last run (the same files as before).
