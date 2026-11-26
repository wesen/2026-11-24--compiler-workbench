# Review protocol: stage-1 designs (engineering review sent back to each author)

You are reviewing design documents written against the brief in `specs/brief.md`. Each review goes back to its author, who will revise the design and then implement it. Apply the same standard to every document. Check claims about the repository against the repository at `REPO` (read-only), for example whether a framework API the design relies on exists and behaves as the design says.

For each document, write at most 350 words in four parts:
1. **Must change** (at most 5 items): deviations from the brief's fixed Tix core, f32 meaning or API; unsound or under-specified contract parts (domain, observation, relation, tolerance, the rejection of `split-sum` by the exact relation, the rejection of a wrong variant of each pass); misuse of `src/framework` (or reliance on an API that does not exist); anything that would make the implementation guess.
2. **Cut** (at most 5 items): material beyond stage 1's purpose (later-stage design, unrequested features or modes, error contracts beyond compile errors with line:col, speculative abstraction, measurement plans). Name each item precisely.
3. **Framework changes:** for each change to `src/framework` the design proposes, say whether it is needed, minimal, and correctly placed; name any needed change it missed.
4. **Keep:** one or two sentences on what is right and must survive the revision.

Quote the design for every item in parts 1 and 2. Do not rewrite the design and do not suggest new features. Write the reviews to `reviews/doc-X.md`, one file per document.
