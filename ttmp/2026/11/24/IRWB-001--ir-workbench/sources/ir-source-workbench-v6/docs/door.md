# Composed mechanical door

## Purpose

The mechanical door is the integration test for the decomposition. It combines the CAD bracket's named geometry, a port-based assembly, the physics residual/tape/solver chain, shared mesh definitions, rigid occurrences, sampled animation and collision geometry. It runs through the same compiler runtime as the three individual examples. There is no separate hard-coded animation loop or imported jig implementation.

## Interfaces between components

| Boundary | Public data exchanged | Responsibility |
| --- | --- | --- |
| CAD to assembly | Two named attachment ports, local positions and unit axes in meters | The CAD adapter extracts bore axes at the base mounting plane. It preserves named bore provenance. |
| Assembly to physics | Four rigid bodies, endpoint ports, revolute joints, driver and branch | A narrow adapter recognizes the supported planar four-bar pattern, checks axes/topology/frames, and emits the physics constraint graph. |
| CAD and procedural geometry to scene | Shared `geometry.mesh` definitions with material slots | The scene references one bracket definition twice, plus one definition for each link, panel and support rail. |
| Physics to animation | Verified discrete rigid-body poses with sample times | Link occurrences follow their bodies. The door leaf shares the rocker pose. No intersample interpolation is claimed. |
| Meshes to collision | One local AABB per definition | Conservative boxes enclose the actual definition vertices and follow the same rigid occurrence transform. |

The reusable assembly schema and shared scene schema are outside the CAD, game and physics frontends. The assembly-to-physics adapter is explicit about the limited family it recognizes. It rejects unsupported topology, driver placement, axes and local endpoint frames rather than silently projecting them into a four-bar mechanism.

## Geometry and attachment semantics

The default CAD bracket has two bore centers at x = 0.03 and 0.09 meters. The left bracket is placed so its first mounting port is the left ground pivot. The right bracket is translated by the support-origin spacing, and its second mounting port is the right ground pivot. Therefore the ground span is:

`supportSpacing + rightPort.x - leftPort.x`.

For the default support spacing of 1.14 meters, the resulting span is 1.20 meters. This dependence is real: editing the CAD bracket width changes the relative port positions, ground span, constraint graph and motion. Changing the bore diameter alters geometry while preserving those attachment positions.

At default settings there are six geometry definitions and seven occurrences: two bracket occurrences, a support rail, three moving links and a door leaf. The bracket is reused rather than copied into each occurrence. There are 732 triangles across the unique definitions and 1,404 rendered triangles after counting occurrences.

The exported motion has 65 verified samples over a four-second complete crank revolution. Every assembly joint is checked independently in tests by transforming both connected local port positions into world coordinates from the exported scene poses. The tests do not infer closure merely from a solver success label.

## Incremental behavior

| Edit | Geometry consequences | Mechanism consequences |
| --- | --- | --- |
| CAD hole diameter | Bracket history, solid and mesh change; mesh-set and package update | Port extraction executes but returns equal content. Assembly, constraints, tape and both solver results remain cached. |
| Door leaf width, height or thickness | Panel, collected meshes, collision bounds and package update | Assembly and every mechanism stage remain cached. |
| CAD bracket width | CAD geometry and attachment coordinates change | The ground span changes, so assembly, graph, residuals, tape, numerical motion, closed-form motion and selection are recomputed. |
| Motion sampling or solver settings | Geometry definitions remain reusable | Only the dependent computation stages are invalidated. |

The diameter edit also demonstrates content-based cutoff: the collision task recomputes from the changed mesh-set, but its bounding boxes can remain identical because the external dimensions did not change. Logical identity and value revision remain separate from whether a pass executed.

## Collision and motion limits

The collision output is conservative geometry, not a contact simulation. A bracket AABB fills its holes and concavities. The package validator checks that every definition has one collider and that the declared bounds contain its vertices. The test suite also transforms the box corners and actual mesh vertices through every sampled occurrence pose and verifies containment.

The physics is a prescribed, planar kinematic mechanism. It does not model forces, material deformation, friction, impacts, backlash or interference between moving surfaces. The leaf is a rigid attachment to the rocker; dimensions do not feed a mass or load model. Samples are explicitly discrete and interpolation is `none`, so no continuous-time constraint guarantee is implied between them.

## Provenance and audit

The two attachment datums trace back to the actual CAD surface names `hole:left/wall` and `hole:right/wall`, then to the drilling feature. Body-to-body lowering preserves identity even if the input assembly's declaration order changes. Geometry provenance, body identity and computation dependencies are distinct relations.

The independent door tests cover shared definitions and instance counts, joint coincidence at every sample, driver phase and closed-cycle endpoints, actual CAD port placement, local and world-space collider containment, rejection of invalid package data, diameter/leaf/width invalidation, unsupported adapter inputs, order-independent identity preservation, and named-bore lineage.
