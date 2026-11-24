import { immutable } from '../core/data.js';
import { assert, finite, positive } from '../core/types.js';
import { validateAssembly, type PlanarAssembly, type RigidBody, type PortReference } from '../assembly/planar.js';
import type { MotionSettings } from '../math/four-bar.js';
export interface MotionPolicy {
    objective: 'work' | 'accuracy';
    maxError: number;
}
export interface MechanismProgram {
    kind: 'mechanism';
    name: string;
    assembly: PlanarAssembly;
    settings: MotionSettings;
    policy: MotionPolicy;
}
const endpoint = (s: string): PortReference => {
    const [body, port, ...extra] = s.split(':');
    assert(body && port && !extra.length, `Expected body:port, got ${s}`);
    return { body, port };
};
export const link = (id: string, length: number, fixed = false): RigidBody => ({ id, fixed, ports: [{ id: 'a', position: [0, 0, 0], axis: [0, 0, 1] }, { id: 'b', position: [length, 0, 0], axis: [0, 0, 1] }] });
export class MechanismBuilder {
    constructor(private readonly p: MechanismProgram) { }
    private with(p: Partial<MechanismProgram>) { return new MechanismBuilder(immutable({ ...this.p, ...p })); }
    private assembly(p: Partial<PlanarAssembly>) { return this.with({ assembly: { ...this.p.assembly, ...p } }); }
    body(b: RigidBody) { return this.assembly({ bodies: [...this.p.assembly.bodies, b] }); }
    revolute(id: string, a: string, b: string) { return this.assembly({ joints: [...this.p.assembly.joints, { id, type: 'revolute', a: endpoint(a), b: endpoint(b) }] }); }
    drive(joint: string, from: number, to: number, seconds: number, samples: number) { return this.with({ assembly: { ...this.p.assembly, driver: { joint } }, settings: { ...this.p.settings, thetaStart: from, thetaEnd: to, duration: seconds, sampleCount: samples } }); }
    branch(branch: 1 | -1, initial: {
        bx: number;
        by: number;
    }) { return this.with({ assembly: { ...this.p.assembly, branch }, settings: { ...this.p.settings, initial } }); }
    optimize(objective: MotionPolicy['objective'], maxError: number) { return this.with({ policy: { objective, maxError } }); }
    solver(tolerance: number, maxIterations = 100) { return this.with({ settings: { ...this.p.settings, tolerance, maxIterations } }); }
    build() {
        validateMechanism(this.p);
        return immutable(this.p);
    }
}
export const mechanism = (name: string) => new MechanismBuilder({ kind: 'mechanism', name, assembly: { units: 'm', plane: 'xy', bodies: [], joints: [], driver: { joint: '' }, branch: 1 }, settings: { sampleCount: 65, thetaStart: .15, thetaEnd: .15 + 2 * Math.PI, duration: 4, initial: { bx: .7, by: .7 }, tolerance: 1e-10, maxIterations: 100 }, policy: { objective: 'work', maxError: 1e-7 } });
export function validateMechanism(v: unknown): asserts v is MechanismProgram {
    const p = v as MechanismProgram;
    assert(p && p.kind === 'mechanism' && typeof p.name === 'string' && p.name.length > 0, 'Expected a mechanism program');
    validateAssembly(p.assembly);
    const s = p.settings;
    assert(s && Number.isInteger(s.sampleCount) && s.sampleCount >= 2 && s.sampleCount <= 360, 'Motion sample count must be integer 2–360');
    finite(s.thetaStart, 'start angle');
    finite(s.thetaEnd, 'end angle');
    positive(s.duration, 'duration');
    positive(s.tolerance, 'tolerance');
    assert(Number.isInteger(s.maxIterations) && s.maxIterations > 0 && s.maxIterations <= 300, 'Iteration limit must be integer 1–300');
    finite(s.initial.bx, 'initial bx');
    finite(s.initial.by, 'initial by');
    assert(p.policy && ['work', 'accuracy'].includes(p.policy.objective), 'Unknown solver objective');
    positive(p.policy.maxError, 'maximum link error');
}
