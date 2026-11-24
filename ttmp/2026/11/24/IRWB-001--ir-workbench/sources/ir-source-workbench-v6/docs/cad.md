# Geometry and CAD implementation

## Scope and real geometry

The CAD example is a dimensioned L mounting bracket with two cylindrical through bores in the horizontal front plate. Lengths are meters. The supported construction is deliberately explicit: extrude a rectangular base, join a full-width rear upright, then drill two symmetric bores. The implementation evaluates this construction into an analytic solid description and tessellates its actual boundary. It does not depend on OpenCascade, another CAD kernel, or jig code.

The CAD kernel is bounded. It supports this parametric construction, not arbitrary Boolean operations or arbitrary polygon-with-hole extrusion. Invalid dimensions, nonmatching feature placement, intersecting holes, nonpositive clearance, or unsupported tessellation settings fail with an error. It never silently substitutes a box or drops a bore.

The two drilled front cells use radial annular tessellation. The rectangle corner angles are inserted into the circular sample sequence; this preserves every straight rectangular boundary. Congruent cells have identical seam subdivisions. The upright is attached with the same subdivisions and the internal join face is omitted. Vertices are welded with tolerance `max(width, depth, height) * 1e-12`. The result is one oriented surface, not two intersecting boxes. The supported scale excludes dimensions at or below one nanometer.

At the default dimensions (width 0.12, depth 0.08, thickness 0.008, height 0.06, bore diameter 0.012) and 32 angular segments, the generated mesh has 334 vertices and 672 triangles. Its Euler characteristic is -2, which is consistent with a closed orientable surface with two through holes. There are no boundary, nonmanifold, inconsistently oriented, or degenerate edges/triangles in the validated default mesh. Tests additionally fire independent vertical rays through the bore centers to check that the holes are physically open.

The analytic volume is

`width * depth * thickness + width * thickness * (height - thickness) - 2 * pi * radius^2 * thickness`.

The default analytic volume is approximately `0.00012491044263153225 m^3`. The 32-segment mesh volume is approximately `0.00012492096652865663 m^3`. Circular holes are represented by inscribed polygons, so the mesh removes slightly less material than the analytic bores. A conservative maximum bore radial gap is `radius * (1 - cos(pi / segments))`. Rectangle-corner samples only reduce this bound. Planar surfaces remain exact up to floating point arithmetic. The bound is a property of this tessellator, not a generic mesh simplification error estimate.

## Reuse across compiler domains

The sketch pass emits `math.residual-program`, the same scalar expression DAG used by the linkage example. Both domains run the **same registered `math.compile-tape` transformation**. The CAD solver consumes that tape and calls the same damped least-squares implementation used by numerical linkage solving. The rectangle has eight unknown coordinates and eight scalar constraints. Its initial values are deliberately perturbed, so this is an actual solve. Full Jacobian rank and residual tolerance are required before extrusion.

Once feasibility is verified numerically, the exact prescribed rectangular dimensions are used to project away numerical roundoff. This decision is recorded. It is valid only for the recognized rectangle family; it does not claim that arbitrary sketch solutions can be replaced by parameter values.

The shared `geometry.mesh` IR is also used by game assets and the composed door. `src/geometry/mesh.ts` contains box and cylinder generation, transforms, mesh concatenation, structural validation, edge-incidence and connected-component analysis, surface area, bounds, signed volume and Euler characteristic. These utilities do not import CAD or game domain code.

Mesh concatenation creates a compound mesh. It deliberately does not perform Boolean union and does not remove coincident interior faces. Topological watertightness is reported separately from connected-component count. The analysis does not detect every self-intersection or prove that arbitrary input meshes form valid solid boundaries.

## IR chain and task boundaries

| Stage | IR / responsibility | Direct input dependencies |
| --- | --- | --- |
| Parameters | Base rectangle dimensions | Width, depth |
| Sketch constraints | Shared residual expression DAG | Parameters artifact |
| Numeric tape | Shared registered `math.compile-tape` | Residual program artifact |
| Solved sketch | Coordinates, solver evidence, constraints | Parameters, residual program, numeric tape, tolerance |
| Base extrusion | Verified rectangular profile extruded to thickness | Solved sketch, thickness |
| Upright definition | Independently reusable upright dimensions | Width, thickness, height |
| Feature history | Ordered base, upright placement, and drilling | Base, upright, hole diameter |
| Named analytic solid | Supported construction and ten named surfaces | Feature history |
| Mesh | Indexed triangles with semantic surface IDs | Analytic solid, segment count |
| Mesh analysis | Area, volume, bounds, topology | Mesh |

Changing the hole diameter rebuilds feature history, named solid, mesh and analysis. It reuses the parameters, constraints, tape, solved sketch, base extrusion and upright definition. Changing only the tessellation segment count rebuilds mesh and analysis. Changing base depth preserves the independently compiled upright definition. These boundaries are exercised by automated cache tests.

## Provenance

The solid names ten semantic surfaces: base bottom/front/top, bracket left/right, upright front/back/top, and left/right bore walls. The history-to-solid relation records which ordered feature created each surface. The solid-to-mesh relation links each named surface to all its triangle IDs. Triangle IDs are local to an artifact revision; semantic face names are the stable domain identities within this construction.

A query beginning at a bore triangle can trace to `hole:left/wall`, then to the `mounting-holes` feature, while the computation dependency graph supplies the exact `cad.holeDiameter` value read in that run. These are complementary graphs: geometric correspondence and computational dependency are not conflated.

## Validation

The CAD test file independently checks box area/volume, regular polygon cylinder volume, mirrored transform orientation, bracket topology, through-bore rays, analytic volume convergence, geometric error bounds, explicit invalid-input failures, solver residuals, registered math pass reuse, incremental invalidation, triangle lineage, queryable failure records, and distinct logical identities for equal content. The compiler owns immutable snapshots and caching; CAD neither imports runtime internals nor handles cache state.
