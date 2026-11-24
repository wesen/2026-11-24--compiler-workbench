/** Native mesh storage: packed vertex tuples and a keyed triangle table. */
import { assert } from '../core/types.js';
import { defineIR } from '../contracts/index.js';
import { defineAdapter } from '../ir/index.js';
import type { IRGraph, IREdit } from '../ir/types.js';
import { array, closedGraph, edge, entity, fields, jsonDeserialize, number, object, ordered, relationId, root, text, unique } from './common.js';
export type MeshPoint = [
    string,
    number,
    number,
    number
];
export interface NativeMesh {
    points: MeshPoint[];
    cells: Record<string, [
        string,
        string,
        string
    ]>;
    boundary: string[];
}
export const MESH_ROOT = '$mesh';
export function validateMesh(v: unknown): asserts v is NativeMesh {
    object(v, 'Mesh');
    fields(v, ['points', 'cells', 'boundary'], 'Mesh');
    array(v.points, 'Packed vertices');
    object(v.cells, 'Triangle table');
    array(v.boundary, 'Boundary ring');
    assert(v.points.length >= 4 && v.points.length <= 10000, 'Mesh vertex count must be 4..10000');
    const ids: string[] = [];
    for (const p of v.points) {
        array(p, 'Packed vertex');
        assert(p.length === 4, 'Packed vertex is [id,x,y,z]');
        text(p[0], 'Vertex id');
        p.slice(1).forEach(x => number(x, 'Vertex coordinate'));
        ids.push(p[0]);
    }
    unique(ids, 'Vertex ids');
    const pointIds = new Set(ids);
    for (const [id, c] of Object.entries(v.cells)) {
        text(id, 'Face id');
        array(c, 'Triangle corners');
        assert(c.length === 3, 'Triangle needs three corners');
        unique(c as string[], 'Triangle corners');
        assert(c.every(x => typeof x === 'string' && pointIds.has(x)), 'Triangle references missing vertex');
        ids.push(id);
    }
    unique(ids, 'Mesh entity ids');
    assert(!ids.includes(MESH_ROOT), 'Reserved mesh root id');
    assert(v.boundary.length >= 3 && v.boundary.every(x => typeof x === 'string' && pointIds.has(x)), 'Boundary must refer to at least three existing vertices');
    unique(v.boundary as string[], 'Boundary vertices');
}
export const MeshIR = defineIR<NativeMesh>({
    id: 'ir-lab.mesh', version: '1', description: 'Packed coordinate tuples, indexed triangle table and ordered boundary loop', validate: validateMesh
});
export const meshEntities = (v: NativeMesh) => [entity(MESH_ROOT, 'mesh.root'), ...v.points.map(([id, x, y, z]) => entity(id, 'mesh.vertex', {
        x, y, z
    })), ...Object.keys(v.cells).map(id => entity(id, 'mesh.face'))];
export const meshRelations = (v: NativeMesh) => [...v.points.map(([id]) => edge('contains', 'containment', MESH_ROOT, id)), ...Object.keys(v.cells).map(id => edge('contains', 'containment', MESH_ROOT, id)), ...Object.entries(v.cells).flatMap(([id, c]) => c.map((to, i) => edge('corner', 'dependency', id, to, i))), ...v.boundary.map((to, i) => edge('boundary', 'binding', MESH_ROOT, to, i))];
export function rebuildMesh(_base: NativeMesh, g: IRGraph): NativeMesh {
    root(g, MESH_ROOT, 'mesh.root');
    closedGraph(g, ['mesh.root', 'mesh.vertex', 'mesh.face'], ['contains', 'corner', 'boundary']);
    const points: MeshPoint[] = g.entities.filter(e => e.kind === 'mesh.vertex').map(e => [e.id, e.attributes.x as number, e.attributes.y as number, e.attributes.z as number]);
    const cells = Object.fromEntries(g.entities.filter(e => e.kind === 'mesh.face').map(e => [e.id, ordered(g, e.id, 'corner').map(r => r.to) as [
            string,
            string,
            string
        ]]));
    const boundary = ordered(g, MESH_ROOT, 'boundary').map(r => r.to);
    const result = {
        points, cells, boundary
    };
    validateMesh(result);
    return result;
}
export const meshAdapter = defineAdapter<NativeMesh>({
    id: 'adapter.packed-triangle-mesh', version: '1', kind: MeshIR.id, schemaVersion: MeshIR.version, description: 'Packed mesh coordinates and face indices exposed without replacing native storage', relationKinds: {
        contains: 'containment', corner: 'dependency', boundary: 'binding'
    }, entities: meshEntities, resolve(v, id) {
        return meshEntities(v).find(e => e.id === id);
    }, relations: meshRelations, roots() {
        return [MESH_ROOT];
    }, describe(v, id) {
        const p = v.points.find(p => p[0] === id);
        return {
            label: id === MESH_ROOT ? 'Planar fan mesh' : id, detail: p ? `(${p.slice(1).join(', ')})` : v.cells[id] ? `triangle ${v.cells[id].join(' → ')}` : 'Packed vertex and triangle tables'
        };
    }, validate: validateMesh, rebuild: rebuildMesh, serialize: v => JSON.stringify(v, null, 2), deserialize: s => jsonDeserialize<NativeMesh>(s, validateMesh), visualize(v, selection) {
        return {
            kind: 'triangle-mesh', data: {
                points: v.points, cells: v.cells, boundary: v.boundary, selection
            }
        };
    }
});
export function exampleMesh(): NativeMesh {
    const boundary = Array.from({ length: 8 }, (_, i) => `v${i}`);
    const points: MeshPoint[] = [['center', 0, 0, 0], ...boundary.map((id, i) => [id, Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4), 0] as MeshPoint)];
    return {
        points, cells: Object.fromEntries(boundary.map((id, i) => [`f${i}`, ['center', id, boundary[(i + 1) % 8]] as [
                string,
                string,
                string
            ]])), boundary
    };
}
export function fanCheck(v: NativeMesh): {
    ok: boolean;
    reason: string;
    evidence: unknown;
} {
    const p = new Map(v.points.map(([id, x, y, z]) => [id, [x, y, z]])), center = p.get('center');
    if (!center)
        return {
            ok: false, reason: 'Fan center is missing', evidence: {}
        };
    if (v.boundary.length > 512)
        return {
            ok: false, reason: 'Convex-contour checker supports at most 512 boundary vertices', evidence: { boundary: v.boundary.length }
        };
    let ok = center.every(x => x === 0) && v.points.every(x => Math.abs(x[3]) < 1e-12) && Object.keys(v.cells).length === v.boundary.length;
    const triangles = Object.values(v.cells);
    for (let i = 0; i < v.boundary.length; i++) {
        const a = v.boundary[i], b = v.boundary[(i + 1) % v.boundary.length], pa = p.get(a)!, pb = p.get(b)!;
        ok = ok && triangles.some(c => c[0] === 'center' && c[1] === a && c[2] === b) && (pa[0] * pb[1] - pa[1] * pb[0]) > 1e-12;
        // Global half-plane membership rejects self-intersecting stars that pass local-turn tests.
        for (const id of v.boundary)
            if (id !== a && id !== b) {
                const q = p.get(id)!;
                ok = ok && ((pb[0] - pa[0]) * (q[1] - pa[1]) - (pb[1] - pa[1]) * (q[0] - pa[0])) > 1e-12;
            }
    }
    return {
        ok, reason: ok ? 'Every boundary edge has one positive fan triangle and all other vertices lie in its interior half-plane' : 'Mesh is not a simple strictly convex planar fan at the origin', evidence: {
            vertices: v.points.length, triangles: triangles.length, boundary: v.boundary.length, globalHalfPlaneCheck: true
        }
    };
}
const pointSegment = (p: readonly number[], a: readonly number[], b: readonly number[]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], den = dx * dx + dy * dy;
    const t = den === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
/** Exact vertex-to-convex-polygon contour bound for nested convex fan polygons. */
export function meshBoundaryError(a: NativeMesh, b: NativeMesh): number {
    assert(fanCheck(a).ok && fanCheck(b).ok, 'Boundary error requires simple strictly convex planar fans');
    assert(b.boundary.every(id => a.boundary.includes(id) && JSON.stringify(b.points.find(p => p[0] === id)) === JSON.stringify(a.points.find(p => p[0] === id))), 'Boundary error requires a retained subset of the original contour vertices');
    const points = (v: NativeMesh) => {
        const m = new Map(v.points.map(([id, x, y]) => [id, [x, y]]));
        return v.boundary.map(id => m.get(id)!);
    };
    const aa = points(a), bb = points(b);
    const directed = (x: number[][], y: number[][]) => Math.max(...x.map(p => Math.min(...y.map((q, i) => pointSegment(p, q, y[(i + 1) % y.length])))));
    return Math.max(directed(aa, bb), directed(bb, aa));
}
export function simplifyFan(edit: IREdit<NativeMesh>, source: NativeMesh, divisor: number): void {
    assert(Number.isSafeInteger(divisor) && divisor >= 1 && source.boundary.length % divisor === 0, 'Divisor must divide the boundary count');
    const keep = source.boundary.filter((_, i) => i % divisor === 0);
    assert(keep.length >= 3, 'Simplification must retain at least three boundary vertices');
    if (divisor === 1)
        return;
    for (const id of Object.keys(source.cells))
        edit.remove(id);
    for (const r of edit.preview().relations.filter(r => r.kind === 'boundary'))
        edit.disconnect(r.id);
    for (const id of source.boundary.filter(x => !keep.includes(x)))
        edit.remove(id);
    for (let i = 0; i < keep.length; i++) {
        const id = `reduced-f${i}`, corners = ['center', keep[i], keep[(i + 1) % keep.length]];
        edit.insert(entity(id, 'mesh.face'));
        edit.connect(MESH_ROOT, {
            kind: 'contains', id: relationId('contains', MESH_ROOT, id)
        }, id);
        corners.forEach((to, j) => edit.connect(id, {
            kind: 'corner', order: j, id: relationId('corner', id, to, j)
        }, to));
        edit.connect(MESH_ROOT, {
            kind: 'boundary', order: i, id: relationId('boundary', MESH_ROOT, keep[i], i)
        }, keep[i]);
        const from = Object.keys(source.cells).filter(f => source.cells[f].some(v => v === keep[i]));
        edit.correspond(from, id, 'fan-faces-retriangulated');
    }
    for (const id of source.boundary.filter(x => !keep.includes(x)))
        edit.correspond(id, [], 'boundary-vertex-removed');
}
