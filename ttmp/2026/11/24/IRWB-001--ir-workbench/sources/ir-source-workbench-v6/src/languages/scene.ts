import { immutable } from '../core/data.js';
import { assert, finite, positive } from '../core/types.js';
import type { Vec3 } from '../geometry/mesh.js';
import { validatePart, type PartProgram } from './cad.js';
import { validateMechanism, type MechanismProgram } from './mechanism.js';
export type Shape = {
    kind: 'box' | 'gable';
    size: Vec3;
} | {
    kind: 'cylinder';
    radius: number;
    height: number;
    segments: number;
} | {
    kind: 'frame';
    size: Vec3;
    opening: {
        width: number;
        height: number;
        sill: number;
    };
} | {
    kind: 'cad';
    part: PartProgram;
};
export interface Definition {
    id: string;
    shape: Shape;
    material: string;
}
export interface Instance {
    id: string;
    definition: string;
    at: Vec3;
    rotate: number;
    attach: string | null;
}
export interface ScenePolicy {
    divisors: number[];
    objective: 'triangles' | 'quality';
    maxError: number;
}
export interface SceneProgram {
    kind: 'scene';
    name: string;
    units: 'm';
    up: 'z';
    definitions: Definition[];
    instances: Instance[];
    materials: Record<string, {
        color: string;
        opacity: number;
    }>;
    policy: ScenePolicy;
    motion: MechanismProgram | null;
}
export const box = (width: number, depth: number, height: number): Shape => ({ kind: 'box', size: [width, depth, height] });
export const gable = (width: number, depth: number, rise: number): Shape => ({ kind: 'gable', size: [width, depth, rise] });
export const cylinder = (radius: number, height: number, segments = 48): Shape => ({ kind: 'cylinder', radius, height, segments });
export const frame = (width: number, depth: number, height: number, opening: {
    width: number;
    height: number;
    sill: number;
}): Shape => ({ kind: 'frame', size: [width, depth, height], opening });
export const cadMesh = (part: PartProgram): Shape => ({ kind: 'cad', part });
export class SceneBuilder {
    constructor(private readonly p: SceneProgram) { }
    private with(p: Partial<SceneProgram>) { return new SceneBuilder(immutable({ ...this.p, ...p })); }
    material(id: string, color: string, opacity = 1) { return this.with({ materials: { ...this.p.materials, [id]: { color, opacity } } }); }
    define(id: string, shape: Shape, material: string) { return this.with({ definitions: [...this.p.definitions, { id, shape, material }] }); }
    instance(id: string, definition: string, at: Vec3 = [0, 0, 0], rotate = 0, attach: string | null = null) { return this.with({ instances: [...this.p.instances, { id, definition, at, rotate, attach }] }); }
    instances(instances: Instance[]) { return this.with({ instances: [...this.p.instances, ...instances] }); }
    lod(divisors: number[], objective: ScenePolicy['objective'], maxError: number) { return this.with({ policy: { divisors, objective, maxError } }); }
    animate(motion: MechanismProgram) { return this.with({ motion }); }
    build() {
        validateScene(this.p);
        return immutable(this.p);
    }
}
export const scene = (name: string) => new SceneBuilder({ kind: 'scene', name, units: 'm', up: 'z', definitions: [], instances: [], materials: {}, policy: { divisors: [1], objective: 'triangles', maxError: 0 }, motion: null });
export const instance = (id: string, definition: string, at: Vec3 = [0, 0, 0], rotate = 0, attach: string | null = null): Instance => ({ id, definition, at, rotate, attach });
export const repeat = <T>(n: number, f: (i: number) => T): T[] => {
    assert(Number.isInteger(n) && n >= 0 && n <= 1000, 'Repeat count must be integer 0–1000');
    return Array.from({ length: n }, (_, i) => f(i));
};
export function validateScene(v: unknown): asserts v is SceneProgram {
    const p = v as SceneProgram;
    assert(p && p.kind === 'scene' && p.units === 'm' && p.up === 'z' && typeof p.name === 'string' && p.name.length > 0, 'Expected a scene program in meters, Z-up');
    assert(Array.isArray(p.definitions) && p.definitions.length > 0 && p.definitions.length <= 100, 'Scene requires 1–100 definitions');
    assert(Array.isArray(p.instances) && p.instances.length > 0 && p.instances.length <= 1000, 'Scene requires 1–1000 instances');
    assert(p.materials && typeof p.materials === 'object', 'Materials required');
    const ids = new Set<string>();
    for (const d of p.definitions) {
        assert(typeof d.id === 'string' && d.id.length > 0 && !ids.has(d.id), `Duplicate or empty definition ${d.id}`);
        ids.add(d.id);
        assert(Object.hasOwn(p.materials, d.material), `Unknown material ${d.material}`);
        const s = d.shape;
        assert(s && typeof s === 'object', 'Shape missing');
        if (s.kind === 'cad')
            validatePart(s.part);
        else if (s.kind === 'cylinder') {
            positive(s.radius, 'radius');
            positive(s.height, 'height');
            assert(Number.isInteger(s.segments) && s.segments >= 6 && s.segments <= 256, 'Cylinder segments must be integer 6–256');
        }
        else if (s.kind === 'box' || s.kind === 'gable' || s.kind === 'frame') {
            assert(Array.isArray(s.size) && s.size.length === 3, 'Shape size needs 3 dimensions');
            s.size.forEach(n => positive(n, 'size'));
            if (s.kind === 'frame') {
                positive(s.opening.width, 'opening width');
                positive(s.opening.height, 'opening height');
                finite(s.opening.sill, 'sill');
                assert(s.opening.sill >= 0 && s.opening.width < s.size[0] && s.opening.height + s.opening.sill < s.size[2], 'Frame opening must leave positive piers and lintel');
            }
        }
        else
            throw new Error('Unknown shape kind');
    }
    for (const m of Object.values(p.materials)) {
        assert(m && /^#[0-9a-f]{6}$/i.test(m.color), 'Material requires #RRGGBB');
        finite(m.opacity, 'opacity');
        assert(m.opacity >= 0 && m.opacity <= 1, 'Opacity must be 0–1');
    }
    if (p.motion !== null)
        validateMechanism(p.motion);
    const occ = new Set<string>();
    for (const o of p.instances) {
        assert(typeof o.id === 'string' && o.id.length > 0 && !occ.has(o.id), `Duplicate or empty occurrence ${o.id}`);
        occ.add(o.id);
        assert(ids.has(o.definition), `Unknown definition ${o.definition}`);
        assert(Array.isArray(o.at) && o.at.length === 3, 'Instance needs XYZ');
        o.at.forEach(n => finite(n, 'translation'));
        finite(o.rotate, 'rotation');
        assert(o.attach === null || p.motion?.assembly.bodies.some(b => b.id === o.attach), `Unknown attachment ${o.attach}`);
    }
    const l = p.policy;
    assert(l && Array.isArray(l.divisors) && l.divisors.length > 0 && l.divisors.length <= 8 && new Set(l.divisors).size === l.divisors.length && l.divisors.every(d => Number.isInteger(d) && d >= 1 && d <= 32), 'LOD divisors must be 1–32 and unique (up to eight)');
    assert(l.divisors.includes(1), 'LOD candidates must include original mesh (divisor 1)');
    assert(['triangles', 'quality'].includes(l.objective), 'Unknown LOD objective');
    finite(l.maxError, 'error budget');
    assert(l.maxError >= 0, 'Error budget cannot be negative');
}
