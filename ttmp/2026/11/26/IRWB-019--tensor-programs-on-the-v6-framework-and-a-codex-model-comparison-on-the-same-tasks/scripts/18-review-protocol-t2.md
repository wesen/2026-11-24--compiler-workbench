# Review protocol: stage-2 designs (engineering review sent back to each author)

You are reviewing design documents written against the brief in `specs/brief.md`. Each review goes back to its author, who will revise the design and then implement it. Apply the same standard to every document. Check claims about the repository against the repository at `REPO` (read-only), for example whether a framework API or a tool option the design relies on exists and behaves as the design says.

For each document, write at most 350 words in four parts:
1. **Must change** (at most 5 items). Look for:
   - deviations from the fixed mapping (one kernel per statement, one thread per output element, reductions as sequential loops in the f32 meaning's order) or from the fixed API;
   - a relation claim (exact or tolerance) that the design does not support: an operation or intrinsic whose GPU result is not shown to match the f32 meaning, `nvcc` flags that contradict the claim, a bound without justification;
   - misuse of `src/framework` or `tools/cuda-remote.mjs`, or reliance on an API or option that does not exist;
   - anything that would make the implementation guess.
2. **Cut** (at most 5 items): material beyond stage 2's purpose, such as later-stage design (fusion, tiling, shared memory, autotuning), unrequested modes or options, error contracts beyond what the API needs, speculative abstraction, or measurement beyond the timing table. Name each item precisely.
3. **Framework and tool changes:** for each change to `src/framework` or `tools/cuda-remote.mjs` the design proposes, say whether it is needed, minimal, and correctly placed; name any needed change it missed.
4. **Keep:** one or two sentences on what is right and must survive the revision.

Quote the design for every item in parts 1 and 2. Do not rewrite the design and do not suggest new features. You may check a claim about GPU arithmetic on the GPU machine with `node tools/cuda-remote.mjs <dir>` (read its header), but keep such runs few and short. Write the reviews to `reviews/doc-X.md`, one file per document.
