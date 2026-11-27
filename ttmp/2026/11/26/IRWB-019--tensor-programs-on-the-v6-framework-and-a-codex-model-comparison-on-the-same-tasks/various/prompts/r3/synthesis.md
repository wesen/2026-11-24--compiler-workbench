You are the synthesis reviewer for round R3 of the IR Workbench project (IRWB-019). Four agents (Opus, Fable, gpt-6.2-sol, gpt-6.2-astra) each wrote an independent design-level review of the project's IR framework: where complexity lives that the framework should absorb, how good the core structure is, which fundamental changes to make, a standard library of compiler building blocks, and a migration path. Your job is to verify, consolidate and judge them, and to write two durable outputs: a detailed vault report and a detailed HTML artifact page. The user's framing: "I think we have a lot of material now to take a step back and figure out what it all means and how good our core framework structure is. ... v6 was really just one iteration we already adapted and that's how it should go, it's an ongoing research artifact on building a powerful compiler development and research environment."

## Read
- The brief they answered: `/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/prompts/r3/common.md` (and `turn2-standard-library.md`: Sol and Astra received the standard-library question as a second turn, Opus and Fable by message mid-run).
- The four reviews, each a ticket with a design document, a diary and probes in `scripts/`:
  - A (Sol): `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/`
  - B (Astra): `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-am-irwb-038-b/ttmp/2026/11/27/IRWB-038-B--composing-compiler-transformations-and-their-evidence/`
  - C (Opus): `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-op-irwb-038-c/ttmp/2026/11/27/IRWB-038-C--framework-design-review-where-complexity-lives-and-what-the-core-structure-should-become/`
  - D (Fable): `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-fa-irwb-038-d/ttmp/2026/11/27/IRWB-038-D--framework-structure-review-what-two-domains-and-forty-implementations-say-the-framework-should-absorb/`
- The framework and both domains in the main checkout `/home/manuel/code/wesen/2026-11-24--compiler-workbench` (`src/framework`, `src/typed`, `src/tensor`), `BACKLOG.md`, and the coordinator's report page `ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/report-artifact/index.html`. The unmerged worktrees the brief lists are read-only evidence.

## Verify before you consolidate
Rerun or rewrite a probe for every load-bearing claim, at least these:
- a sampled check is recorded with the same assurance as an exact one, and `assuranceOf` is never called (C);
- Tix passes do run in a strategy plan through `passAlgorithm`, with their meaning gate silently dropped (B, C). The coordinator earlier told the user that the bridge's async `applyPass` and AnalysisManager requirement kept Tix out of strategies, and wrote BACKLOG F27 on that basis: say plainly whether that was wrong;
- a rejected candidate can stay visible as the store head, or a fact can be accepted before the enclosing pass rejects it (A, B);
- correspondence with complete endpoint lists and zero mapping groups is accepted (B); Tix `inline` is recorded as a removal (C, D); Typed's in-place edits are `retained` (C, D: 98.5 % of 190,716 entries);
- no domain imports the framework's rewrite, transaction or traversal modules; the Tix adapter is not rewritable (D); the core runtime (about 1,240 lines) has no domain caller (C, D);
- the dataflow solver runs a binding-time analysis on a Tix function (C, D); `planFusion`'s join test is a dependence-distance test (D);
- T6-D's order validator misses a permutation that changes an f32 sum (B);
- the edit-record counts: 2,021 (A0 cells, on t6-base) against 1,774 (D, on main after the D1 merge).
Keep every probe in `/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/scripts/`, numbered, with its output beside it. Record which claims held, which failed, and which you could not test.

## Consolidate and judge
- the findings all four share, those only one made, and where they disagree, with your adjudication;
- the proposed framework concepts merged into one coherent target architecture (a "v7"), each with its theory, interface sketch, the code it absorbs and the evidence for it; mark what is evidenced and what is conjecture;
- one standard-library catalogue with explicit layering criteria (core, library, domain), each primitive's interface, theory and the code it replaces;
- what to keep as it is;
- one ordered migration plan, each step small and checkable, with what it deletes and what to measure; and the decision points where the evidence could withdraw a proposal;
- the research questions this opens;
- an assessment of the four reviews themselves: what each found that the others missed, errors, depth, and how far their probes held up. Earlier rounds showed that judges favour their own model family. You are a Claude model judging two Claude and two OpenAI reviews, so state that, rely on verified findings rather than style, and say which conclusions would survive if your judgment of style were discounted.

## Write
1. **The vault report**, in Manuel's Obsidian vault: `/home/manuel/code/wesen/go-go-golems/go-go-parc/Projects/2026/11/27/PROJECT REPORT - IR Workbench - What Forty Implementations Say About the Framework - R3 Synthesis - A Technical Deep Dive.md`. Match the style of the earlier reports in `Projects/2026/11/26/` (read one): YAML frontmatter (title, aliases, tags, status, type, created, repo), an opening paragraph, a summary callout, prose-first technical sections with code, tables and mermaid diagrams, concrete `path:line` evidence, and a "Related notes" section linking the earlier IR Workbench reports and the playbooks in `Research/playbooks/agents/` with wikilinks. Write it for a capable reader who has not seen the material: explain each concept before using it. Do not commit or push the vault; the coordinator does.
2. **The artifact page**, an HTML fragment at `/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/index.html`. The coordinator publishes it. Rules:
   - **Structure:** no doctype, html, head or body tags; start with `<title>` (a 2–4 word name), `<meta name="claude:viewport-fit-sides" content="cover">`, then `<style>`, then content.
   - **Colors:** every color is a token on `:root`. Redefine the tokens under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }` and again under `:root[data-theme="dark"]`, each with `color-scheme: dark`. `body` gets an explicit background from a token.
   - **Fonts:** only Google Fonts links, with fallbacks.
   - **No JavaScript libraries;** diagrams as `<pre class="mermaid">` blocks, which render natively.
   - **Layout:**
     - side gutter `padding-left: max(16px, env(safe-area-inset-left, 0px))` and `padding-right: max(16px, env(safe-area-inset-right, 0px))` on body;
     - works at 400px width;
     - wide tables and code in `overflow-x: auto` containers;
     - running text about 72ch.
   - **Style:**
     - deliberate typography and a restrained, non-generic palette, utilitarian rather than flashy;
     - avoid cream-and-terracotta, purple gradients and emoji markers.
   - **Content:** the same as the report, organized for scanning:
     - the verdict first;
     - the target architecture with a diagram;
     - the standard library as a table;
     - the migration plan as an ordered list;
     - verified claims with their status;
     - the reviewers' contributions.

   You may copy the visual tokens of the coordinator's page (`ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/report-artifact/template.html`), or design your own.
3. **Verification notes** at `/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/verification.md`: each claim, the probe, the result.

Change nothing else in the main checkout or any worktree, and do not commit; the coordinator commits. Never use `git stash`. Every claim about code cites `path:line`. Your final message: the three output paths, the verdict in five lines, the claims that failed verification, and anything the coordinator must correct in BACKLOG.md or its own earlier statements.
