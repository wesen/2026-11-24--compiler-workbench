/** Native linear constraint storage is sparse equations plus a variable environment. */
import { assert } from '../core/types.js';
import { defineIR } from '../contracts/index.js';
import { defineAdapter } from '../ir/index.js';
import type { IRGraph } from '../ir/types.js';
import { array, closedGraph, edge, entity, fields, jsonDeserialize, number, object, root, text, unique } from './common.js';
export interface LinearEquation {
    id: string;
    coefficients: Record<string, number>;
    rhs: number;
}
export interface ConstraintSystem {
    variables: Record<string, {
        initial: number;
    }>;
    equations: LinearEquation[];
    solver: 'dense' | 'components';
}
export const CONSTRAINT_ROOT = '$constraints';
export function validateConstraints(v: unknown): asserts v is ConstraintSystem {
    object(v, 'Constraint system');
    fields(v, ['variables', 'equations', 'solver'], 'Constraint system');
    object(v.variables, 'Variables');
    array(v.equations, 'Equations');
    assert(v.solver === 'dense' || v.solver === 'components', 'Unknown solver');
    const vars = Object.keys(v.variables);
    assert(vars.length > 0 && vars.length <= 128 && v.equations.length <= 512, 'Constraint system exceeds supported size');
    for (const [id, x] of Object.entries(v.variables)) {
        text(id, 'Variable id');
        object(x, 'Variable');
        fields(x, ['initial'], 'Variable');
        number(x.initial, 'Initial value');
    }
    const ids = [...vars];
    for (const e of v.equations) {
        object(e, 'Equation');
        fields(e, ['id', 'coefficients', 'rhs'], 'Equation');
        text(e.id, 'Equation id');
        number(e.rhs, 'Equation right hand side');
        object(e.coefficients, 'Sparse coefficients');
        assert(Object.keys(e.coefficients).length > 0, 'Empty equations are not supported');
        for (const [k, c] of Object.entries(e.coefficients)) {
            assert(vars.includes(k), 'Equation refers to unknown variable');
            number(c, 'Coefficient');
            assert(c !== 0, 'Zero coefficients must be omitted');
        }
        ids.push(e.id);
    }
    unique(ids, 'Constraint entity ids');
    assert(!ids.includes(CONSTRAINT_ROOT), 'Reserved constraint root id');
}
export const ConstraintIR = defineIR<ConstraintSystem>({
    id: 'ir-lab.constraints', version: '1', description: 'Sparse native linear equations with a selectable solver', validate: validateConstraints
});
export const constraintEntities = (v: ConstraintSystem) => [entity(CONSTRAINT_ROOT, 'constraints.system', { solver: v.solver }), ...Object.entries(v.variables).map(([id, x]) => entity(id, 'constraints.variable', { initial: x.initial })), ...v.equations.map(e => entity(e.id, 'constraints.equation', { rhs: e.rhs }))];
export const constraintRelations = (v: ConstraintSystem) => [...Object.keys(v.variables).map(id => edge('contains', 'containment', CONSTRAINT_ROOT, id)), ...v.equations.map(e => edge('contains', 'containment', CONSTRAINT_ROOT, e.id)), ...v.equations.flatMap(e => Object.entries(e.coefficients).map(([id, coefficient]) => edge('term', 'dependency', e.id, id, undefined, { coefficient })))];
export function rebuildConstraints(base: ConstraintSystem, g: IRGraph): ConstraintSystem {
    const system = root(g, CONSTRAINT_ROOT, 'constraints.system');
    closedGraph(g, ['constraints.system', 'constraints.variable', 'constraints.equation'], ['contains', 'term']);
    const variables = Object.fromEntries(g.entities.filter(e => e.kind === 'constraints.variable').map(e => [e.id, { initial: e.attributes.initial as number }]));
    const ranks = new Map(base.equations.map((e, i) => [e.id, i]));
    const equations = g.entities.filter(e => e.kind === 'constraints.equation').sort((a, b) => (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER)).map(e => ({
        id: e.id, rhs: e.attributes.rhs as number, coefficients: Object.fromEntries(g.relations.filter(r => r.kind === 'term' && r.from === e.id).map(r => [r.to, r.attributes?.coefficient as number]))
    }));
    const result = {
        variables, equations, solver: system.attributes.solver as ConstraintSystem['solver']
    };
    validateConstraints(result);
    return result;
}
export const constraintAdapter = defineAdapter<ConstraintSystem>({
    id: 'adapter.sparse-constraints', version: '1', kind: ConstraintIR.id, schemaVersion: ConstraintIR.version, description: 'Sparse equation coefficients become dependency edges; solver choice stays on the native system', relationKinds: {
        contains: 'containment', term: 'dependency'
    }, entities: constraintEntities, resolve(v, id) {
        return constraintEntities(v).find(e => e.id === id);
    }, relations: constraintRelations, roots() {
        return [CONSTRAINT_ROOT];
    }, describe(v, id) {
        const equation = v.equations.find(e => e.id === id);
        return {
            label: id === CONSTRAINT_ROOT ? 'Linear constraints' : id, detail: equation ? `${Object.entries(equation.coefficients).map(([x, c]) => `${c}·${x}`).join(' + ')} = ${equation.rhs}` : id in v.variables ? `variable, initial ${v.variables[id].initial}` : `${v.solver} solver`
        };
    }, validate: validateConstraints, rebuild: rebuildConstraints, serialize: v => JSON.stringify(v, null, 2), deserialize: s => jsonDeserialize<ConstraintSystem>(s, validateConstraints), visualize(v, selection) {
        return {
            kind: 'constraint-components', data: {
                variables: v.variables, equations: v.equations, components: constraintComponents(v), selection
            }
        };
    }
});
export function exampleConstraints(): ConstraintSystem {
    return {
        variables: {
            x: { initial: 0 }, y: { initial: 0 }, u: { initial: 0 }, v: { initial: 0 }
        }, equations: [{
                id: 'sum-xy', coefficients: {
                    x: 1, y: 1
                }, rhs: 4
            }, {
                id: 'difference-xy', coefficients: {
                    x: 1, y: -1
                }, rhs: 2
            }, {
                id: 'duplicate-xy', coefficients: {
                    x: 2, y: 2
                }, rhs: 8
            }, {
                id: 'sum-uv', coefficients: {
                    u: 1, v: 1
                }, rhs: 6
            }, {
                id: 'difference-uv', coefficients: {
                    u: 1, v: -1
                }, rhs: 2
            }], solver: 'dense'
    };
}
export function constraintComponents(v: ConstraintSystem): string[][] {
    const adjacency = new Map(Object.keys(v.variables).map(id => [id, new Set<string>()]));
    for (const e of v.equations) {
        const ids = Object.keys(e.coefficients);
        for (const a of ids)
            for (const b of ids)
                if (a !== b)
                    adjacency.get(a)!.add(b);
    }
    const seen = new Set<string>(), components: string[][] = [];
    for (const id of [...adjacency.keys()].sort()) {
        if (seen.has(id))
            continue;
        const component: string[] = [], queue = [id];
        seen.add(id);
        while (queue.length) {
            const a = queue.shift()!;
            component.push(a);
            for (const b of [...adjacency.get(a)!].sort())
                if (!seen.has(b)) {
                    seen.add(b);
                    queue.push(b);
                }
        }
        components.push(component.sort());
    }
    return components;
}
export function rref(input: readonly (readonly number[])[], columns: number): number[][] {
    assert(Number.isSafeInteger(columns) && columns > 0 && columns <= 128, 'RREF supports 1..128 variables');
    assert(input.length <= 512, 'RREF supports at most 512 equations');
    const rows = input.map(r => {
        assert(r.length === columns + 1 && r.every(Number.isFinite), 'RREF requires finite augmented rows');
        return [...r];
    });
    const checked = (v: number) => {
        assert(Number.isFinite(v), 'Non-finite intermediate in numerical elimination');
        return v;
    };
    let row = 0;
    for (let col = 0; col < columns && row < rows.length; col++) {
        let pivot = row;
        for (let i = row + 1; i < rows.length; i++)
            if (Math.abs(rows[i][col]) > Math.abs(rows[pivot][col]))
                pivot = i;
        if (Math.abs(rows[pivot][col]) < 1e-10)
            continue;
        [rows[pivot], rows[row]] = [rows[row], rows[pivot]];
        const d = rows[row][col];
        rows[row] = rows[row].map(x => checked(x / d));
        for (let i = 0; i < rows.length; i++)
            if (i !== row) {
                const f = rows[i][col];
                rows[i] = rows[i].map((x, j) => checked(x - checked(f * rows[row][j])));
            }
        row++;
    }
    return rows.map(r => r.map(x => Math.abs(x) < 1e-10 ? 0 : x)).filter(r => r.some(x => x !== 0)).sort((a, b) => {
        const ai = a.findIndex(x => x !== 0), bi = b.findIndex(x => x !== 0);
        return ai - bi;
    });
}
export function constraintRowSpace(v: ConstraintSystem): number[][] {
    const vars = Object.keys(v.variables).sort();
    return rref(v.equations.map(e => [...vars.map(id => e.coefficients[id] ?? 0), e.rhs]), vars.length);
}
export function constraintEquivalent(a: ConstraintSystem, b: ConstraintSystem): boolean {
    const av = Object.keys(a.variables).sort(), bv = Object.keys(b.variables).sort();
    if (av.join('\0') !== bv.join('\0'))
        return false;
    const aa = constraintRowSpace(a), bb = constraintRowSpace(b);
    return aa.length === bb.length && aa.every((row, i) => row.every((x, j) => Math.abs(x - bb[i][j]) < 1e-9));
}
export function normalizedEquation(e: LinearEquation): string {
    const entries = Object.entries(e.coefficients).sort(([a], [b]) => a.localeCompare(b)), scale = entries[0][1], terms = entries.map(([id, c]) => [id, c / scale] as [
        string,
        number
    ]), rhs = e.rhs / scale;
    assert(Number.isFinite(rhs) && terms.every(([, x]) => Number.isFinite(x)), 'Equation normalization overflowed the supported numerical range');
    return JSON.stringify({
        terms, rhs
    });
}
export function solveConstraints(v: ConstraintSystem): {
    values: Record<string, number>;
    components: string[][];
    matrices: number[][][];
    residuals: {
        equation: string;
        absolute: number;
        relative: number;
    }[];
    residualTolerance: number;
} {
    const components = v.solver === 'components' ? constraintComponents(v) : [Object.keys(v.variables).sort()];
    const values: Record<string, number> = {}, matrices: number[][][] = [];
    for (const vars of components) {
        const rows = v.equations.filter(e => Object.keys(e.coefficients).some(id => vars.includes(id))).map(e => [...vars.map(id => e.coefficients[id] ?? 0), e.rhs]);
        const reduced = rref(rows, vars.length);
        matrices.push(reduced);
        assert(!reduced.some(row => row.slice(0, -1).every(x => x === 0) && row.at(-1) !== 0), 'Inconsistent constraint system');
        assert(reduced.length === vars.length, 'The demonstration solver requires a unique solution');
        for (let i = 0; i < reduced.length; i++) {
            const p = reduced[i].slice(0, -1).findIndex(x => x !== 0);
            assert(p >= 0, 'No pivot for solution row');
            const value = reduced[i].at(-1)!;
            assert(Number.isFinite(value), 'Non-finite solution value');
            values[vars[p]] = value;
        }
    }
    const residualTolerance = 1e-9;
    const residuals = v.equations.map(e => {
        const products = Object.entries(e.coefficients).map(([id, c]) => c * values[id]);
        assert(products.every(Number.isFinite), 'Non-finite residual product');
        const lhs = products.reduce((a, b) => a + b, 0), scale = Math.max(1, Math.abs(e.rhs), products.reduce((a, b) => a + Math.abs(b), 0)), absolute = Math.abs(lhs - e.rhs), relative = absolute / scale;
        assert(Number.isFinite(lhs) && Number.isFinite(scale) && Number.isFinite(relative), 'Non-finite residual calculation');
        assert(relative <= residualTolerance, `Equation ${e.id} residual ${relative} exceeds ${residualTolerance}`);
        return {
            equation: e.id, absolute, relative
        };
    });
    return {
        values, components, matrices, residuals, residualTolerance
    };
}
