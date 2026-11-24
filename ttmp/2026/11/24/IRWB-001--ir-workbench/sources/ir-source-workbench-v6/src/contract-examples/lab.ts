/** Deliberately successful and failing transformations exercise the semantic acceptance boundary. */
import { assert, task, type Registry, type Task, type Artifact } from '../core/types.js';
import type { Compiler } from '../core/runtime.js';
import { boxMesh, cylinderMesh, type Mesh } from '../geometry/mesh.js';
import { cleanupOneVertex } from '../strategy-examples/cleanup.js';
import { semanticContext, getDomainContracts, recordContractSnapshot } from './domain-contracts.js';
import { getProgramStrategyRegistry, type CompiledValue, type ProgramStrategyOptions } from '../pipelines/strategy.js';
import { algorithm, apply, sequence, checkpoint, plan, ref } from '../strategy/builders.js';
import { execute } from '../strategy/interpreter.js';
import type { StrategyPlan, StrategyExecution } from '../strategy/ir.js';
export const CONTRACT_LAB_MODES = [
    {
        id: 'verified-cleanup', label: 'Verified cleanup', description: 'Remove an unused vertex with exact surface preservation and justified property transfer.'
    },
    {
        id: 'invalid-divisor', label: 'Rejected precondition', description: 'A zero ring divisor violates its positive-integer input type before transformation.'
    },
    {
        id: 'bad-transform', label: 'Rejected postcondition', description: 'Moving a vertex violates the promised preservation of oriented surface geometry.'
    },
    {
        id: 'false-preservation', label: 'Rejected preservation', description: 'A fabricated surface label has no valid correspondence or transfer justification.'
    },
    {
        id: 'effect-violation', label: 'Undeclared effect', description: 'A pure contract rejects an attempted read of a safe in-memory resource.'
    },
    {
        id: 'resource-bound', label: 'Tracked resource check', description: 'Geometry is audited against the current versioned in-memory volume limit, including cache hits.'
    },
    {
        id: 'resource-derived', label: 'Resource-derived geometry', description: 'A declared resource read affects vertex coordinates; its revision must invalidate computational reuse.'
    },
    {
        id: 'commit-effect', label: 'Committed effect', description: 'An allowed export-counter write commits atomically after semantic acceptance.'
    },
    {
        id: 'rollback-effect', label: 'Discarded staged effect', description: 'A later geometric postcondition failure discards the staged counter write.'
    }
] as const;
export type ContractLabMode = typeof CONTRACT_LAB_MODES[number]['id'];
export function contractLabMesh(mode: ContractLabMode): Mesh {
    if (mode === 'invalid-divisor')
        return cylinderMesh(.2, 1, 48, 'contract-cylinder');
    const m = boxMesh(2, 1, 3, 'contract-box');
    m.positions.push([0, 0, 0]);
    return m;
}
export function registerContractLabPasses(reg: Registry, compiler: Compiler): void {
    reg.register<{
        key: string;
    }, Mesh>({
        id: 'contracts.lab-source', version: '1', kind: 'geometry.mesh', description: 'Read the mesh fixture used by the semantic contract lab.', run(ctx, { key }) {
            return ctx.read<Mesh>(key);
        }
    });
    reg.register<{
        mesh: Task;
    }, Mesh>({
        id: 'contracts.verified-cleanup', version: '1', kind: 'geometry.mesh', description: 'Use the existing one-vertex cleanup kernel with checked semantic preservation.', async run(ctx, { mesh }) {
            const a = await ctx.require<Mesh>(mesh), semantic = semanticContext(compiler, ctx), definitions = getDomainContracts(compiler).definitions;
            await semantic.require(definitions.named, a);
            const topology = await semantic.analysis(definitions.topology, a), fact = await semantic.check(definitions.named, a);
            semantic.record('body semantic queries', {
                topology, namedFact: fact
            });
            return cleanupOneVertex(a.value).mesh;
        }
    });
    reg.register<{
        mesh: Task;
    }, Mesh>({
        id: 'contracts.bad-transform', version: '1', kind: 'geometry.mesh', description: 'Intentional violation: alter a vertex despite an exact surface-preservation contract.', async run(ctx, { mesh }) {
            const a = await ctx.require<Mesh>(mesh), m = structuredClone(a.value);
            m.positions[0][0] += .25;
            return m;
        }
    });
    reg.register<{
        mesh: Task;
    }, Mesh>({
        id: 'contracts.false-preservation', version: '1', kind: 'geometry.mesh', description: 'Intentional violation: rename a surface while claiming its semantic label is preserved.', async run(ctx, { mesh }) {
            const a = await ctx.require<Mesh>(mesh);
            return {
                ...a.value, faceIds: a.value.faceIds.map((id, i) => i === 0 ? 'fabricated/surface' : id)
            };
        }
    });
    reg.register<{
        mesh: Task;
    }, Mesh>({
        id: 'contracts.effect-violation', version: '1', kind: 'geometry.mesh', description: 'Intentional violation: an undeclared in-memory resource read in a pure transformation.', async run(ctx, { mesh }) {
            const a = await ctx.require<Mesh>(mesh);
            semanticContext(compiler, ctx).readResource(getDomainContracts(compiler).definitions.exportRead);
            return a.value;
        }
    });
    reg.register<{
        mesh: Task;
    }, Mesh>({
        id: 'contracts.resource-bound', version: '1', kind: 'geometry.mesh', description: 'The geometry is unchanged; its acceptance policy reads the current versioned volume limit.', async run(ctx, { mesh }) {
            return (await ctx.require<Mesh>(mesh)).value;
        }
    });
    reg.register<{
        mesh: Task;
    }, Mesh>({
        id: 'contracts.resource-derived', version: '1', kind: 'geometry.mesh', description: 'Scale real mesh coordinates from a declared versioned resource; stale computational output must be rejected for reuse.', async run(ctx, { mesh }) {
            const a = await ctx.require<Mesh>(mesh), factor = semanticContext(compiler, ctx).readResource(getDomainContracts(compiler).definitions.volumeRead) / 10;
            assert(factor > 0, 'Resource scale must be positive');
            return {
                ...a.value, positions: a.value.positions.map(p => [p[0] * factor, p[1], p[2]])
            };
        }
    });
    reg.register<{
        mesh: Task;
    }, Mesh>({
        id: 'contracts.commit-effect', version: '1', kind: 'geometry.mesh', description: 'Stage a versioned in-memory export counter increment and return unchanged geometry.', async run(ctx, { mesh }) {
            const a = await ctx.require<Mesh>(mesh), s = semanticContext(compiler, ctx), d = getDomainContracts(compiler).definitions;
            s.writeResource(d.exportWrite, s.readResource(d.exportRead) + 1);
            return a.value;
        }
    });
    reg.register<{
        mesh: Task;
    }, Mesh>({
        id: 'contracts.rollback-effect', version: '1', kind: 'geometry.mesh', description: 'Stage an export increment, then deliberately violate geometric preservation.', async run(ctx, { mesh }) {
            const a = await ctx.require<Mesh>(mesh), s = semanticContext(compiler, ctx), d = getDomainContracts(compiler).definitions;
            s.writeResource(d.exportWrite, s.readResource(d.exportRead) + 1);
            const m = structuredClone(a.value);
            m.positions[0][0] += .25;
            return m;
        }
    });
}
export function prepareContractLab(mode: ContractLabMode, prefix = 'contract-lab') {
    assert(CONTRACT_LAB_MODES.some(m => m.id === mode), 'Unknown contract lab mode');
    const source = task(`${prefix}/source`, 'contracts.lab-source', { key: `${prefix}.mesh` });
    const transform = mode === 'invalid-divisor' ? task(`${prefix}/transform`, 'scene.reduce-rings', {
        mesh: source, divisor: 0
    }) : task(`${prefix}/transform`, `contracts.${mode}`, { mesh: source });
    return {
        mode, source, transform
    };
}
export function planContractLab(mode: ContractLabMode, prefix = 'contract-lab'): StrategyPlan {
    const p = prepareContractLab(mode, prefix);
    return plan(`contracts.${mode}`, sequence('contracts/steps', apply('contracts/source', algorithm(p.source.pass), {
        input: null, args: { task: ref('input', ['source']) }
    }), apply('contracts/transform', algorithm(p.transform.pass), {
        input: null, args: { task: ref('input', ['transform']) }
    }), checkpoint('contracts/accepted', 'Accepted semantic contract output')), CONTRACT_LAB_MODES.find(m => m.id === mode)!.description, [algorithm(p.source.pass), algorithm(p.transform.pass)]);
}
export const getContractLabStrategyRegistry = (compiler: Compiler) => getProgramStrategyRegistry(compiler);
export async function compileContractLab(compiler: Compiler, mode: ContractLabMode, label = 'Contract lab', prefix = 'contract-lab', options: ProgramStrategyOptions = {}) {
    const strategyPlan = options.strategyPlan ?? planContractLab(mode, prefix), data = prepareContractLab(mode, prefix);
    compiler.setInput(`${prefix}.mesh`, contractLabMesh(mode));
    let trace: StrategyExecution | undefined;
    const result = await compiler.run(label, async (run) => {
        try {
            trace = await execute(strategyPlan, getProgramStrategyRegistry(compiler, run, strategyPlan), data, {
                id: `${run.id}/strategy`, signal: options.signal, maxSteps: options.maxSteps ?? 5000, maxConcurrency: options.maxConcurrency ?? 8
            });
            run.recordExtension('strategy.execution', trace);
            if (trace.status !== 'succeeded')
                throw new Error(`Strategy ${trace.status}: ${trace.error?.message ?? 'execution did not succeed'}`);
            const output = trace.value as CompiledValue;
            assert(output?.artifact, 'Contract lab must return a compiled artifact');
            const value = run.artifact(output.artifact);
            assert(value, 'Contract lab artifact missing');
            return value;
        }
        finally {
            recordContractSnapshot(compiler, run);
        }
    });
    return {
        ...result, strategy: {
            plan: strategyPlan, trace: trace!
        }
    };
}
