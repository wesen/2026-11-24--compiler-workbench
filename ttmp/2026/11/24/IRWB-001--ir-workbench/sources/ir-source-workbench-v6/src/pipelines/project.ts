import { createDomainContractSetup } from '../contract-examples/domain-contracts.js';
import { registerContractLabPasses } from '../contract-examples/lab.js';
import { registerCleanupPasses } from '../strategy-examples/cleanup.js';
import { compileWithStrategy, type ProgramStrategyOptions } from './strategy.js';
import { Compiler } from '../core/runtime.js';
import { assert, task, type Task } from '../core/types.js';
import { registerSource, validateProgram, type Program } from '../languages/program.js';
import { registerMath } from '../math/register.js';
import { registerGeometry } from '../geometry/mesh.js';
import { registerScene } from '../scene/schema.js';
import { registerAssembly } from '../assembly/planar.js';
import { registerCADPipeline, cadPipeline } from './cad.js';
import { registerMechanismPipeline, mechanismPipeline } from './mechanism.js';
import { registerScenePipeline, scenePipeline, type SceneImports } from './scene.js';
/** Cross-domain compilation is wired here, not in scene pass implementations. */
const sceneImports: SceneImports = {
    geometry(prefix, parent, definition) {
        assert(definition.shape.kind === 'cad', 'Unsupported geometry import');
        const source = task(`${prefix}/source`, 'dsl.import', { parent, slot: { kind: 'cad', id: definition.id } });
        return cadPipeline(prefix, source, definition.shape.part).mesh;
    },
    motion(prefix, parent) {
        const source = task(`${prefix}/source`, 'dsl.import', { parent, slot: { kind: 'motion' } });
        return mechanismPipeline(prefix, source).motion;
    }
};
export function createSourceCompiler() {
    const c = new Compiler({ maxCacheEntries: 4096 });
    const setup=createDomainContractSetup(c),registry=setup.registry;
    registerMath(registry);
    registerGeometry(registry);
    registerScene(registry);
    registerAssembly(registry);
    registerSource(registry);
    registerCADPipeline(registry);
    registerMechanismPipeline(registry);
    registerScenePipeline(registry);
    registerCleanupPasses(registry);
    registerContractLabPasses(registry,c);
    setup.install();
    return c;
}
export function planProgram(program: Program, prefix = 'program'): {
    source: Task;
    root: Task;
    analysis?: Task;
} {
    validateProgram(program);
    const source = task(`${prefix}/source`, 'dsl.source', { key: `${prefix}.program` });
    switch (program.kind) {
        case 'part': {
            const p = cadPipeline(prefix, source, program);
            return { source, root: p.mesh, analysis: p.metrics };
        }
        case 'mechanism': return { source, root: mechanismPipeline(prefix, source).motion };
        case 'scene': return { source, root: scenePipeline(prefix, source, program, sceneImports).root };
    }
}
export async function compileProgram(c: Compiler, program: Program, label: string, prefix = 'program', options: ProgramStrategyOptions = {}) {
    return compileWithStrategy(c, program, label, prefix, options);
}
