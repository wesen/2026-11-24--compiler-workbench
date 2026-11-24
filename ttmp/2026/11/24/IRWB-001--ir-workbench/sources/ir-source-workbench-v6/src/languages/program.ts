import { validatePart, type PartProgram } from './cad.js';
import { validateMechanism, type MechanismProgram } from './mechanism.js';
import { validateScene, type SceneProgram } from './scene.js';
import { assert, type Registry, type Task } from '../core/types.js';
export type Program = PartProgram | MechanismProgram | SceneProgram;
export function validateProgram(v: unknown): asserts v is Program {
    const p = v as Program;
    assert(p && typeof p === 'object', 'Export a DSL program with .build()');
    switch (p.kind) {
        case 'part':
            validatePart(p);
            break;
        case 'mechanism':
            validateMechanism(p);
            break;
        case 'scene':
            validateScene(p);
            break;
        default: throw new Error('Unknown program kind; export a built scene, part or mechanism');
    }
}
export function registerSource(reg: Registry) {
    reg.registerKind<Program>({ id: 'dsl.program', version: '1', description: 'The data constructed by the authored TypeScript program; not a JavaScript AST.', validate: validateProgram });
    reg.register<{
        key: string;
    }, Program>({
        id: 'dsl.source', version: '1', kind: 'dsl.program', description: 'Read the immutable reified result of host-language execution', run(ctx, { key }) { return ctx.read(key); }
    });
    reg.register<{
        parent: Task;
        slot: {
            kind: 'cad';
            id: string;
        } | {
            kind: 'motion';
        };
    }, Program>({
        id: 'dsl.import', version: '1', kind: 'dsl.program', description: 'Project an embedded domain program from the scene, retaining the source link', async run(ctx, { parent, slot }) {
            const src = await ctx.require<Program>(parent);
            assert(src.value.kind === 'scene', 'Imports require a scene');
            const s = src.value;
            const shape = slot.kind === 'cad' ? s.definitions.find(d => d.id === slot.id)?.shape : null;
            const p = slot.kind === 'motion' ? s.motion : shape?.kind === 'cad' ? shape.part : null;
            const id = slot.kind === 'cad' ? slot.id : 'motion';
            assert(p, `Missing imported program ${id}`);
            ctx.derive(src, { from: [id], relation: 'import-program' });
            return p;
        }
    });
}
