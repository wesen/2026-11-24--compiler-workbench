# Game assets and the developer workbench

## The implemented language

The game example describes a small modular building in meters with Z up. Its recipe declares eight geometry definitions: front/back wall, side wall, entrance wall, front/back glazing, side glazing, floor, roof, and column. Repetition counts and numeric source inputs are separated. Definitions own geometry; occurrences own stable identities and rigid placements.

The default building is 8 m wide, 5 m deep and two 2.8 m floors tall, with four bays on each side. It contains 70 occurrences referencing eight definitions. A gabled roof is a closed triangular prism; columns are closed polygonal cylinders. Windows and the entrance are actual openings. Masonry frame modules consist of separate closed piers, lintels and sills. Their touching interfaces remain in the compound mesh. They are explicitly **not Boolean-unioned solids**; this is an asset assembly representation.

All numeric geometry passes read only their needed source fields through the compiler context. For example, the column geometry reads radius and total building height, while appearance is read only by final packaging. A column-radius edit can therefore preserve every unrelated mesh. The recipe itself records floors and bays; when those change, definition lowerers can run again even if some resulting values are unchanged. Content revisions then stop propagation to those unchanged mesh definitions. The prototype promises correct dependency tracking at declared artifact granularity, not magically minimal work at every arithmetic operation.

## The chain of IRs

`game.recipe` expands the grammar and declares stable modules. `game.definition` evaluates the dimensions of one reusable primitive or frame. `game.layout` instantiates occurrences with translations and Z rotations. `game.mesh` uses the shared geometry library to tessellate one definition. `game.mesh-set` collects these artifacts into the shared `scene.mesh-set` schema. `game.lod` produces concrete alternative meshes. `game.select` uses the shared `selectByMetrics` strategy helper. `game.package` joins the chosen meshes, occurrences and material bindings through the generic `scene.package` boundary.

This sequence is a dependency network: all mesh lowerings are individually reusable, layout has its own dependencies, and all LOD candidates can be reused when only the objective changes. The game module imports compiler contracts, shared strategy policy, geometry primitives, and scene schemas. It does not import compiler implementation internals or the physics or CAD frontends.

## A real bounded LOD transformation

The LOD pass recognizes the canonical indexed ring representation of a cylinder with 48 angular segments. Its candidates retain every first, second, fourth or eighth ring vertex, producing 48, 24, 12 or 6 sides. It reconstructs the cap fans and side quads. Triangle counts are obtained from the resulting arrays; this is not a setting change or triangle-count estimate.

Recognition verifies radius, height, ring coordinates, cap centers, oriented connectivity, and semantic face IDs. A metadata flag alone is insufficient to obtain an error certificate. Unexpected or distorted cylinders fail recognition. Other geometry definitions are retained unchanged. Arbitrary mesh decimation, material baking and topology repair are outside this implementation's scope.

For a radius `R` and a reduced ring with `m` sides, `R * (1 - cos(pi/m))` bounds the radial gap from the coarse inscribed polygon to the analytic circle. Because the original polygon lies between those surfaces, this also conservatively bounds the distance between original and coarse mesh boundaries. The implementation adds a floating-point recognition tolerance in Euclidean distance. The source cylinder's own approximation to its analytic surface is recorded separately. A zero error on the retained candidate means no change from the original **mesh**, not exact equivalence to an analytic cylinder.

Default radius is 0.16 m and the allowed mesh-to-mesh bound is 0.006 m. The triangle objective chooses the 12-sided candidate. The six-sided candidate fails the budget. The quality objective chooses the original 48-sided candidate. The selection helper records the objective, constraint, every candidate's actual metrics, feasibility reasons, selected candidate and deterministic name-based tie break. Measured pass duration remains a runtime observation; it is not treated as a deterministic geometry-quality metric.

Caps retain their semantic IDs. Each reduced side explicitly corresponds to the original side group it replaces. These many-to-one derivations survive mesh collection, LOD creation and the compiler's revision-specific provenance queries.

## Inspection and local execution

The workbench is a self-contained HTML file built from TypeScript, embedded CSS and real trace JSON. It makes no network requests and opens from the filesystem. A local source compiler is bundled into the same file. The Inputs tab accepts JSON values and runs all four examples in the browser. The first live run starts a fresh in-memory compiler; subsequent live runs reuse that compiler's cache. Reloading returns to the report's recorded scenario set. There is no server or remote execution service.

The generic inspector provides an execution picker, invocation list, IR/revision inspection, cache explanations and changed dependency values, decision alternatives, structural/dependency/provenance/invocation graphs, value diffs, source snapshots, and commands for `why`, `cache`, `history`, `alternatives` and `dependencies`. Commands delegate to the same `Queries` implementation used by programmatic callers. Execution graphs preserve failed requests even when no value dependency was produced. A failed local compilation retains diagnostics and does not synthesize an output artifact.

Visualizations are registered by IR kind. The generic inspector never dispatches on pass names. A mesh provider renders indexed surfaces with orthographic projection, orbit, zoom and surface picking. A scene provider resolves definitions and occurrences without destroying their identities. A linkage provider plays the recorded kinematic samples. The composed-door provider applies each verified sample's complete occurrence poses to the real meshes. Playback follows recorded sample times and performs no unverified interpolation. Collision proxies remain inspectable data; the viewer does not run collision response.

Canvas previews use a simple depth-sorted orthographic renderer. They are developer inspection views, not production rendering backends. Large graphs and diffs have visible display limits; the underlying exported trace retains complete records. Full traces and live execution can consume considerable memory for very large source models, so this workbench targets the bounded examples and similarly sized experiments.

## Validation

The game tests independently check closed edge incidence and cylinder volumes, sample distances from original polygon edges to reduced polygons, validate the roof's analytic volume, recompute scene triangle counts from definitions and instances, verify candidate feasibility, and exercise cold/warm runs, appearance-only changes, objective changes, column-radius changes and invalid inputs.

An independent review added adversarial tests for corrupted primitive metadata and coordinates, bad ring connectivity and orientation, fake error claims, incomplete LOD contracts, missing definitions, inconsistent scene metrics/materials/references, unsupported divisors and complete many-to-one side lineage. Workbench unit tests check query equivalence with the compiler API, failed-request graph semantics, safe standalone HTML embedding, revision diffs and view registration without core changes. Browser interaction checks are recorded separately by the overall validation workflow.
