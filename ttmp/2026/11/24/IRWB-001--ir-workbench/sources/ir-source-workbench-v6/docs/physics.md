# Shared mathematics and the four-bar example

## What is implemented

The mathematics package is independent of CAD, games, and mechanisms. It supplies a scalar expression DAG, a serializable residual program, a numeric instruction tape, forward automatic differentiation, numerical rank diagnostics, and a deterministic damped nonlinear least-squares solver. Both CAD sketch solving and linkage solving use these facilities. The shared `math.compile-tape` pass and the two mathematical IR registrations are installed once by `registerMath`.

The physics example implements planar four-bar **kinematics**. Its chain is:

1. Four body definitions and four revolute joints form a validated constraint graph.
2. Fixed ground coordinates and the prescribed crank angle are substituted, leaving two unknown coupler-point coordinates.
3. Two length constraints become a symbolic residual DAG.
4. The shared compiler lowers that DAG to a numeric tape with expression-to-register correspondence.
5. A damped numerical solver and a recognized two-circle construction independently produce sampled motion.
6. A generic constrained-selection strategy chooses one result and records both alternatives and the reason.

Lengths use meters, angles radians, and time seconds. Bodies and joints have explicit stable names. A motion result contains named body poses, joint positions, sample times, residual norms, geometric length error, Jacobian rank, iteration counts, and aggregate metrics.

## Mathematics of the example

Let the ground pivots be O=(0,0) and D=(g,0), the driven crank length be a, the coupler length be b, and the rocker length be c. At prescribed angle theta, the crank endpoint is A=(a cos(theta), a sin(theta)). The unknown point B=(x,y) closes the linkage. The compiled residuals are:

```text
r1(x,y;theta) = ((x-Ax)^2 + (y-Ay)^2 - b^2) / (2b)
r2(x,y;theta) = ((x-g)^2 + y^2 - c^2) / (2c)
```

Each residual has length units and approaches the corresponding signed length error near a solution. The formulation avoids differentiating a square root at a coincident point. The reported geometric error is independently computed from ordinary Euclidean link lengths; it is not merely a renamed residual norm.

The alternative solver intersects the circle centered on A with radius b and the circle centered on D with radius c. The signed side of the line AD selects one assembly branch. Impossible circle intersections, coincident circle centers, and toggle singularities produce explicit errors. Every closed-form result is checked against the same compiled residual tape and against the original graph's link lengths.

## Reusable expression and solver contracts

`ExprBuilder` interns scalar nodes by operation, operands, and payload. It supports constants, variables, addition, subtraction, multiplication, division, negation, sine, cosine, and square root. `residualProgram` records named residual roots and separates unknowns from fixed parameters. These values contain no executable closures.

`compileTape` removes nodes unreachable from the residual roots, folds operations with constant operands, and interns repeated instructions. It preserves source node IDs in instruction `origins`. It deliberately performs no algebraic reassociation: identities that change floating-point behavior are not silently introduced. The original DAG and the tape remain separate inspectable artifacts.

`evaluateTape` performs forward automatic differentiation with one derivative component per unknown. It returns residuals, a Jacobian, and a scalar-operation count. Division by zero, non-finite values, negative square roots, and the derivative of a nonconstant square root at zero are rejected.

`solveLeastSquares` solves a damped augmented least-squares system using Householder QR rather than forming normal equations. It scales damping by Jacobian-column norms, accepts only residual-reducing steps, increases damping on rejected steps, and reduces damping after accepted steps. A separate column-pivoted, reorthogonalized Gram-Schmidt calculation reports rank. Residual convergence without full column rank is reported as `rank-deficient`, not as a unique converged solution.

The initial guess, tolerance, iteration bound, and sampling sequence are explicit inputs. Continuation uses the previous verified sample within one invocation. There is no process-global warm-start state. Failed convergence, wrong-branch convergence, and graph/tape mismatches are explicit failures with recorded diagnostics.

## Public entry points

```ts
registerMath(registry);
registerPhysics(registry);
compiler.setInputs(defaultPhysicsInputs('physics'));
const tasks = physicsTasks('physics');
const { value: selectedMotion, run } = await compiler.run(
  'linkage', run => run.require<MotionIR>(tasks.selected)
);
```

`physicsTasks(prefix, { graph: someOtherFrontendTask })` replaces only the graph-producing frontend. The residual, tape, both solvers, and selection stages remain unchanged. The mechanical-door integration uses this port to provide an assembly-derived graph. The mechanism passes do not import CAD or game implementations.

Pure functions `fourBarGraph`, `lowerFourBar`, `solveFourBarClosed`, and `sampleFourBar` are also exported. Domains can reuse the math layer without adopting the orchestration runtime.

## Observability and cache precision

Each numeric sample records the initial coordinates, angle, final status, and accepted/rejected iteration trace. A trace checkpoint contains the trial residual, damping, and step norm. Full-trace mode retains this evidence; summary mode can omit the detailed checkpoints without changing the computed result.

Selection uses the framework's `selectByMetrics` function. The `work` objective minimizes residual/Jacobian evaluation count subject to a maximum measured link-length error. The `accuracy` objective minimizes maximum measured link-length error. Both are explicit policies; the algorithm does not infer the user's objective.

Changing `physics.objective` recomputes selection while reusing the graph, residual program, tape, and both motion alternatives. Changing `physics.initial` recomputes the numerical solver but preserves the closed-form result, because that solver does not read an initial guess or numerical iteration bound. The tests verify these recorded cache outcomes. Changes to graph geometry flow through the shared mathematical artifacts and invalidate downstream results by recorded artifact revision.

The operation count covers scalar tape evaluation and forward differentiation only. It excludes QR, rank estimation, the closed-form construction, allocation, and orchestration. It is not elapsed time, a hardware instruction count, or a full solver cost estimate. Invocation duration is recorded independently by the runtime and is not used as a deterministic artifact value.

## Measured default result

The default model has ground length 1.2 m, crank 0.35 m, coupler 1.0 m, and rocker 0.8 m. It records 65 samples over a full crank revolution in four seconds, starting at 0.15 rad on the positive assembly branch. With residual tolerance 1e-10 m:

| Measurement | Numerical solve | Closed-form solve |
| --- | ---: | ---: |
| Samples | 65 | 65 |
| Accepted outer iterations | 196 | 0 |
| Residual/Jacobian evaluations | 261 | 65 |
| Counted tape arithmetic operations | 26,100 | 6,500 |
| Maximum residual norm, m | 1.2258218450882638e-11 | 3.3306690738754696e-16 |
| Maximum independently measured link error, m | 9.354406138584181e-12 | 3.3306690738754696e-16 |

The default work policy selects the closed-form result. These measurements are deterministic observations from this implementation, not general performance claims. Floating-point errors near machine precision should not be interpreted as a practically significant accuracy ranking.

## Verification and limits

The physics test module contains 16 tests. They check symbolic sharing and lowering; automatic derivatives against central finite differences; independent residual and derivative formulas; QR solutions; rank-deficient, inconsistent, and iteration-limited cases; numerical versus closed-form agreement; all link lengths and transformed body endpoints across every default sample; branch enforcement; unreachable, singular, and concentric configurations; invalid sampling inputs; unrelated graph/tape rejection; shared-pass registration; recorded alternatives; precise policy/seed cache invalidation; and structured failure diagnostics.

This is a bounded kinematic compiler, not a general rigid-body physics engine. It does not integrate forces, inertia, impacts, friction, unilateral contact, or arbitrary 3D joint systems. It recognizes one explicit loop topology for closed-form solving. The general scalar solver remains reusable, but it has no global-convergence guarantee and will not invent a feasible branch when the initial guess is unsuitable. Samples are verified at their recorded times; there is no certified interpolation error or continuous collision guarantee between samples. Mechanisms approaching singular configurations require additional conditioning and branch-continuation policies before production use.
