import { immutable } from '../core/data.js';
import { assert, finite, positive } from '../core/types.js';
export type XY = [
    number,
    number
];
export interface Rectangle {
    kind: 'rectangle';
    width: number;
    depth: number;
}
export type Feature = {
    kind: 'extrude';
    id: string;
    sketch: string;
    thickness: number;
} | {
    kind: 'join-upright';
    id: string;
    base: string;
    height: number;
    thickness: number;
} | {
    kind: 'drill-through';
    id: string;
    target: string;
    diameter: number;
    centers: XY[];
};
export interface PartProgram {
    kind: 'part';
    name: string;
    units: 'm';
    sketches: {
        id: string;
        profile: Rectangle;
    }[];
    features: Feature[];
    segments: number;
    tolerance: number;
}
export const rectangle = (width: number, depth: number): Rectangle => ({ kind: 'rectangle', width, depth });
export class PartBuilder {
    constructor(private readonly p: PartProgram) { }
    private with(p: Partial<PartProgram>) { return new PartBuilder(immutable({ ...this.p, ...p })); }
    sketch(id: string, profile: Rectangle) { return this.with({ sketches: [...this.p.sketches, { id, profile }] }); }
    extrude(id: string, sketch: string, thickness: number) { return this.with({ features: [...this.p.features, { kind: 'extrude', id, sketch, thickness }] }); }
    joinUpright(id: string, base: string, height: number, thickness: number) { return this.with({ features: [...this.p.features, { kind: 'join-upright', id, base, height, thickness }] }); }
    drillThrough(id: string, target: string, diameter: number, centers: XY[]) { return this.with({ features: [...this.p.features, { kind: 'drill-through', id, target, diameter, centers }] }); }
    tessellate(segments: number) { return this.with({ segments }); }
    solverTolerance(tolerance: number) { return this.with({ tolerance }); }
    build() {
        validatePart(this.p);
        return immutable(this.p);
    }
}
export const part = (name: string) => new PartBuilder({ kind: 'part', name, units: 'm', sketches: [], features: [], segments: 32, tolerance: 1e-11 });
export function validatePart(v: unknown): asserts v is PartProgram {
    const p = v as PartProgram;
    assert(p && p.kind === 'part' && p.units === 'm' && typeof p.name === 'string' && p.name.length > 0, 'Expected a named part program in meters');
    assert(Array.isArray(p.sketches) && p.sketches.length > 0 && Array.isArray(p.features) && p.features.length > 0, 'Part requires sketches and features');
    const ids = new Set<string>();
    const add = (id: string) => {
        assert(typeof id === 'string' && id.length > 0 && !ids.has(id), `Duplicate or empty CAD ID: ${id}`);
        ids.add(id);
    };
    for (const s of p.sketches) {
        add(s.id);
        assert(s.profile.kind === 'rectangle', 'Only rectangular profiles implemented');
        positive(s.profile.width, 'profile width');
        positive(s.profile.depth, 'profile depth');
    }
    for (const f of p.features) {
        assert(f && typeof f === 'object', 'Invalid feature');
        if (f.kind === 'extrude') {
            assert(p.sketches.some(s => s.id === f.sketch), `Unknown sketch ${f.sketch}`);
            positive(f.thickness, 'extrusion thickness');
        }
        else if (f.kind === 'join-upright') {
            assert(p.features.some(x => x.id === f.base && ids.has(x.id) && x.kind === 'extrude'), `Unknown earlier extrusion ${f.base}`);
            positive(f.height, 'upright height');
            positive(f.thickness, 'upright thickness');
        }
        else if (f.kind === 'drill-through') {
            assert(p.features.some(x => x.id === f.target && ids.has(x.id)), `Unknown earlier drill target ${f.target}`);
            positive(f.diameter, 'drill diameter');
            assert(Array.isArray(f.centers) && f.centers.length > 0, 'Drill centers required');
            for (const xy of f.centers) {
                assert(Array.isArray(xy) && xy.length === 2, 'Hole center must be XY');
                xy.forEach(x => finite(x, 'hole coordinate'));
            }
        }
        else
            throw new Error('Unknown feature kind');
        add(f.id);
    }
    assert(Number.isInteger(p.segments) && p.segments >= 8 && p.segments <= 256 && p.segments % 4 === 0, 'Tessellation segments must be multiple of four, 8–256');
    positive(p.tolerance, 'sketch tolerance');
}
