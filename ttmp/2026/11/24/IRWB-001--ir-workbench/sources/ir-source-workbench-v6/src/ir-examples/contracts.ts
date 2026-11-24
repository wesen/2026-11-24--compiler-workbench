/** Semantic contracts remain domain-owned; generic edits are only structural candidates. */
import { canonical } from '../core/data.js';
import {
    Check,
    FiniteNumber,
    JsonValue,
    defineAnalysis,
    defineInvariant,
    defineObjective,
    defineProperty,
    defineTransformation
} from '../contracts/index.js';
import type { IRType, CheckResult } from '../contracts/index.js';
import { ExpressionIR, expressionPolynomial, evaluateExpression, type ExpressionProgram } from './expressions.js';
import { SceneIR, sceneEquivalent, scenePlacements, type NativeScene } from './scenes.js';
import { MeshIR, fanCheck, meshBoundaryError, type NativeMesh } from './meshes.js';
import { ConstraintIR, constraintEquivalent, constraintRowSpace, solveConstraints, type ConstraintSystem } from './constraints.js';
function property<T>(ir: IRType<T>, check: (v: T) => CheckResult) {
    const analysis = defineAnalysis({
        id: `${ir.id}.well-formed-analysis`, version: '1', description: 'Check the semantic preconditions required by this example compiler', input: ir, output: Check, run(_ctx, a) {
            return check(a.value);
        }
    });
    return defineProperty({
        id: `${ir.id}.well-formed`, version: '1', description: 'Domain preconditions have been checked for this exact artifact revision', subject: ir, check: analysis
    });
}
export const expressionValid = property(ExpressionIR, v => {
    try {
        return {
            ok: true, evidence: { polynomial: expressionPolynomial(v) }
        };
    }
    catch (e) {
        return {
            ok: false, reason: e instanceof Error ? e.message : String(e)
        };
    }
});
export const sceneValid = property(SceneIR, v => ({
    ok: true, evidence: {
        instances: v.objects.length, definitions: v.assets.length
    }
}));
export const meshValid = property(MeshIR, fanCheck);
export const constraintsValid = property(ConstraintIR, v => {
    try {
        return {
            ok: true, evidence: solveConstraints(v)
        };
    }
    catch (e) {
        return {
            ok: false, reason: e instanceof Error ? e.message : String(e)
        };
    }
});
export const expressionEquivalent = defineInvariant({
    id: 'ir-lab.expression.equivalent', version: '1', description: 'Compare canonical safe-integer polynomials, then record differential evaluation samples', inputs: {
        before: ExpressionIR, after: ExpressionIR
    }, check(_ctx, { before, after }) {
        const a = expressionPolynomial(before.value), b = expressionPolynomial(after.value), variables = [...new Set([...Object.values(before.value.nodes), ...Object.values(after.value.nodes)].flatMap(n => n.op === 'variable' ? [n.name] : []))].sort();
        const samples = [-3, -1, 0, 1, 4].map((n, i) => {
            const environment = Object.fromEntries(variables.map((name, j) => [name, n + j + i % 2]));
            return {
                environment, before: evaluateExpression(before.value, environment), after: evaluateExpression(after.value, environment)
            };
        });
        return {
            ok: canonical(a) === canonical(b), reason: 'Canonical polynomial coefficients must be identical; sample evaluations are additional evidence', evidence: {
                before: a, after: b, samples
            }
        };
    }
});
export const placementsEquivalent = defineInvariant({
    id: 'ir-lab.scene.placements-equivalent', version: '1', description: 'Definition sharing must preserve each named instance shape, dimensions and translation', inputs: {
        before: SceneIR, after: SceneIR
    }, check(_ctx, { before, after }) {
        return {
            ok: sceneEquivalent(before.value, after.value), reason: 'Expanded named placements remain identical', evidence: {
                before: scenePlacements(before.value), after: scenePlacements(after.value)
            }
        };
    }
});
export const meshApproximation = defineInvariant({
    id: 'ir-lab.mesh.approximation', version: '1', description: 'A convex fan reduction must retain input vertices and stay within the stated contour error', inputs: {
        before: MeshIR, after: MeshIR, tolerance: FiniteNumber
    }, check(_ctx, { before, after, tolerance }) {
        const error = meshBoundaryError(before.value, after.value), subset = after.value.points.every(p => before.value.points.some(q => canonical(p) === canonical(q)));
        return {
            ok: tolerance >= 0 && subset && error <= tolerance + 1e-12, reason: `Contour error ${error} must be within ${tolerance}; retained coordinates must be unchanged`, evidence: {
                error, tolerance, retainedCoordinatesUnchanged: subset, metric: 'symmetric boundary distance of nested convex polygons'
            }
        };
    }
});
export const solutionEquivalent = defineInvariant({
    id: 'ir-lab.constraints.solution-equivalent', version: '1', description: 'Redundant equation elimination and solver substitution must preserve reduced row space and solution values', inputs: {
        before: ConstraintIR, after: ConstraintIR
    }, check(_ctx, { before, after }) {
        const a = solveConstraints(before.value), b = solveConstraints(after.value), same = Object.keys(a.values).every(id => Math.abs(a.values[id] - b.values[id]) < 1e-9);
        return {
            ok: constraintEquivalent(before.value, after.value) && same, reason: 'Canonical row spaces and independently scheduled dense/component solves agree within 1e-9', evidence: {
                beforeRowSpace: constraintRowSpace(before.value), afterRowSpace: constraintRowSpace(after.value), beforeSolution: a, afterSolution: b
            }
        };
    }
});
const bindings = {
    before: {
        from: 'inputs' as const, port: 'input'
    }, after: {
        from: 'outputs' as const, port: 'output'
    }
};
export const expressionContract = defineTransformation({
    id: 'ir-lab.expression.transform', version: '1', description: 'Accept structural rewrites only when checked polynomial semantics are preserved', inputs: { input: ExpressionIR }, outputs: { output: ExpressionIR }, requires: [{
            property: expressionValid, subject: {
                from: 'inputs', port: 'input'
            }
        }], preserves: [{
            property: expressionValid, from: 'input', to: 'output', mode: 'check'
        }], ensures: [{
            invariant: expressionEquivalent, bindings
        }], correspondence: [{
            id: 'entities', from: 'input', to: 'output', relation: 'generic-ir-edit'
        }]
});
export const sceneContract = defineTransformation({
    id: 'ir-lab.scene.transform', version: '1', description: 'Accept sharing changes only when all expanded scene placements remain identical', inputs: { input: SceneIR }, outputs: { output: SceneIR }, requires: [{
            property: sceneValid, subject: {
                from: 'inputs', port: 'input'
            }
        }], preserves: [{
            property: sceneValid, from: 'input', to: 'output', mode: 'check'
        }], ensures: [{
            invariant: placementsEquivalent, bindings
        }], correspondence: [{
            id: 'entities', from: 'input', to: 'output', relation: 'generic-ir-edit'
        }]
});
export const meshContract = defineTransformation({
    id: 'ir-lab.mesh.transform', version: '1', description: 'Require an oriented convex fan; verify topology, retained coordinates and the explicit geometric error bound', inputs: {
        input: MeshIR, tolerance: FiniteNumber
    }, outputs: { output: MeshIR }, requires: [{
            property: meshValid, subject: {
                from: 'inputs', port: 'input'
            }
        }], preserves: [{
            property: meshValid, from: 'input', to: 'output', mode: 'check'
        }], ensures: [{
            invariant: meshApproximation, bindings: {
                ...bindings, tolerance: {
                    from: 'inputs', port: 'tolerance'
                }
            }
        }], correspondence: [{
            id: 'entities', from: 'input', to: 'output', relation: 'generic-ir-edit'
        }]
});
export const constraintContract = defineTransformation({
    id: 'ir-lab.constraints.transform', version: '1', description: 'Require a uniquely solvable system and preserve its linear solution space across rewrites and solver substitution', inputs: { input: ConstraintIR }, outputs: { output: ConstraintIR }, requires: [{
            property: constraintsValid, subject: {
                from: 'inputs', port: 'input'
            }
        }], preserves: [{
            property: constraintsValid, from: 'input', to: 'output', mode: 'check'
        }], ensures: [{
            invariant: solutionEquivalent, bindings
        }], correspondence: [{
            id: 'entities', from: 'input', to: 'output', relation: 'generic-ir-edit'
        }]
});
export const meshCost = defineAnalysis<NativeMesh, number>({
    id: 'ir-lab.mesh.triangle-count', version: '1', description: 'Count emitted triangles for strategy selection', input: MeshIR, output: FiniteNumber, run(_ctx, a) {
        return Object.keys(a.value.cells).length;
    }
});
export const minimizeTriangles = defineObjective({
    id: 'ir-lab.mesh.minimize-triangles', version: '1', description: 'Prefer the fewest triangles among feasible candidates', analysis: meshCost, direction: 'min'
});
export const constraintDecomposition = defineAnalysis<ConstraintSystem, unknown>({
    id: 'ir-lab.constraints.decomposition', version: '1', description: 'Solve and expose independent connected linear systems', input: ConstraintIR, output: JsonValue, run(_ctx, a) {
        return solveConstraints(a.value);
    }
});
export const semanticDefinitions = {
    expressionContract, sceneContract, meshContract, constraintContract, expressionEquivalent, placementsEquivalent, meshApproximation, solutionEquivalent, minimizeTriangles, constraintDecomposition
};
