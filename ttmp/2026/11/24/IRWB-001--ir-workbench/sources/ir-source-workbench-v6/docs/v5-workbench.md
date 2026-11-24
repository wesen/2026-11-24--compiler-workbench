# Using the v5 semantic contract workbench

The workbench runs the TypeScript compiler locally in its standalone HTML. It embeds the actual source files from the build, including compiler passes, strategy interpreter, semantic contract engine, examples and tests. A contract inspector reads the evidence recorded by that compiler; opening an inspector does not run new checks against historical output.

## Start with the code

The top left panel shows the authored TypeScript for Building, Pavilion, CAD bracket, Four-bar linkage and Mechanical door. Edit that source and select **Compile source**. The two labs show their exact implementation modules as read-only source; their executable Strategy IR remains editable below. The contract lab also has a scenario selector.

The top right panel shows the compiled artifact. A failed compilation removes its preview, so a previous successful model cannot be mistaken for the failed run's result. Earlier successful results remain accessible through **Compilation history**.

For a selected pass, **Pass code** opens its actual registration and implementation. **Executed source** shows the program source snapshot used by that compilation. The contract inspector's **Implementation** view adds exact definition navigation: literal `defineIR`, `defineType`, `defineProperty`, `defineAnalysis`, `defineTransformation`, `defineInvariant`, `defineObjective` and `defineEffect` calls are indexed by category, ID and version. Definitions created by a factory are labelled as dynamically constructed, with their runtime declaration and the complete source browser available. The UI does not invent source locations.

## Follow the strategy and the passes

**Strategy plan** displays the executable plan in a compact sidebar. Selecting a node shows its actual dynamic executions, input/output values, branch decisions and linked compiler invocations. **Contract evidence** beside a linked invocation opens its contract inspector directly.

**Compiler passes** uses a dependency-first compact invocation list. An IR route above the details shows one recorded path through the dependency graph. It is a navigational route, not a claim that the whole compiler is a linear pipeline. Other branches remain in the sidebar and graphs.

Select **Focus passes** to hide the source and model panels while keeping the IR route, pass list and details together. Use **Show source & model** to restore them. YAML views and TypeScript source use syntax highlighting. Source and plan downloads preserve the actual text rather than a screenshot.

## Read a semantic contract

Select a pass and open **Contracts**. The header identifies the exact transformation version and its acceptance status. The count of checks, analyses, properties and effects comes from that contract execution. Compiler output reuse and semantic analysis reuse are separate recorded decisions.

The evidence section selector provides five views:

| View | What it answers |
|---|---|
| Checks & acceptance | Which preconditions, postconditions, establishment, preservation and correspondence checks ran? What verdict and evidence did each produce? |
| Analyses & properties | Which exact analysis records and property facts supported those checks? Which artifact revision, checker version and dependencies do they describe? |
| Typed contract | What are the named input and output ports, their types and versions, and the declared clauses, effects and cache policy? |
| Effects & correspondence | Which resources were read or staged for writing? What input/output and entity relations justified a transformation? |
| Implementation | Where are the actual versioned definition and checker implementations? |

The declaration is shown alongside the recorded checks. Declaring `preserves` does not itself verify preservation or authorize transferring cached analysis to another revision. A checked transfer has its own rule, correspondence, source analysis and evidence.

**Explain analysis** displays the complete record, including dependencies, invalidation and any transfer justification. **Explain property** displays the fact and its checker analysis. The inspector follows dependencies transitively, so a reused property can still expose the underlying analysis even when that invocation did not call the analysis directly. The ordered event list shows actual lookup, computation, reuse, transfer and verification events with their evidence.

Statuses have distinct meanings. `prepared` is provisional. `accepted` indicates committed verification. `rejected`, `failed` and `rolled-back` retain diagnostic evidence without establishing accepted output facts. `declared`, `checked`, `transferred` and `proof` are assurance labels recorded by the engine. A proof label requires a configured external certificate verifier; this framework is not a general theorem prover.

## Exercise failures deliberately

The contract lab has nine scenarios: verified cleanup, invalid divisor, invalid transformation result, unjustified preservation, undeclared resource access, tracked resource check, resource-derived geometry, committed effect and discarded staged effect. Select a scenario, inspect its source and Strategy IR, then open the pass's contract evidence. Failure is the expected result of the negative scenarios.

In **Tracked resource check**, set **Live volume limit** to `1` and select **Set limit & compile**. The same geometry now fails its acceptance condition. Set the limit back to `10` to accept it again while reusing its compiler output. The contract evidence captures the resource revision used by each invocation. In **Committed effect**, each compilation increments the mock export counter because its write contract disables caching. **Discarded staged effect** stages an increment but rejects its changed geometry, leaving the counter unchanged. The live counter is labelled separately from historical evidence.

**Resource-derived geometry** reads that same resource in the transformation body and uses its value divided by ten as a scale along the X axis. Changing `10` to `20` changes the actual vertex coordinates and forces the transformation to execute; compiling again at `20` reuses the new output. This exercises a computational dependency, in addition to the acceptance-only dependency in the resource-check scenario.

Each lab scenario retains its own draft strategy. Switching scenarios or returning to an earlier run does not overwrite another scenario's draft. Returning to a successful history entry restores its preview and exact recorded evidence. Regenerating the default strategy and compiling again is available through the existing Strategy IR controls.

The effect lab uses an explicit in-memory resource interface. Contract effects constrain operations through that interface; they do not sandbox arbitrary JavaScript. The source editor is intended for trusted local code.

## Preserve a session and reproduce the build

**Export trace** saves the compiler snapshot with its Strategy IR and contract execution extensions. **Save source set** saves edited authored modules. Download an edited strategy as YAML to preserve it separately. The browser's live compiler, caches and drafts are in memory; reloading the HTML starts a new session.

The complete workspace contains the build scripts, source, generated output and tests. Build the standalone HTML with `npm run build:source` and run the automated checks with `npm test`. The contract UI tests include real AnalysisManager executions in addition to isolated historical trace fixtures. The source-workbench integration uses the real TypeScript evaluator and compiler with DOM, Worker transport and Canvas test doubles.

`scripts/check-contracts-browser.py` is an optional local Playwright suite for real rendering, Web Workers, offline behavior and desktop/mobile layouts. It was not executed in the restricted authoring environment. Component tests do not establish browser layout or compatibility; the browser suite explicitly records a blocked launch rather than treating it as a pass.
