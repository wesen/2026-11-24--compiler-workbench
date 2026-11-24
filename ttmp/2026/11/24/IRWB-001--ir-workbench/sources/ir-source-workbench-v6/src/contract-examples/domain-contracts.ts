/** Semantic contracts on real compiler passes. Registration reuses the existing IR validators. */
import { assert, type Artifact, type IRKind, type Registry, type PassContext, type PassPolicyContext, type Task } from '../core/types.js';
import { immutable, canonical } from '../core/data.js';
import type { Compiler, CompilationRun } from '../core/runtime.js';
import {
    defineIR,
    defineType,
    defineAnalysis,
    defineProperty,
    defineInvariant,
    defineObjective,
    defineEffect,
    defineTransformation,
    createArtifact,
    validateArtifact,
    Check,
    FiniteNumber,
    JsonValue,
    AnalysisManager,
    ContractRegistry,
    MemoryResources,
    ContractError
} from '../contracts/index.js';
import type {
    IRType,
    ValueType,
    Ports,
    TransformationDefinition,
    TransformationTransaction,
    PreparedTransformation,
    Correspondence,
    PropertyDefinition,
    Condition,
    ContractSnapshot,
    ContractContext,
    ContractExecution,
    InvariantDefinition
} from '../contracts/types.js';
import type { Mesh } from '../geometry/mesh.js';
import { validateMesh, meshMetrics } from '../geometry/mesh.js';
import type { MotionIR } from '../math/four-bar.js';
import type { ScenePackage } from '../scene/schema.js';
import type { SceneLOD, SceneSelection } from '../pipelines/scene.js';
import {
    meshCorrespondence,
    checkMeshCorrespondence,
    namedSurfaces,
    faceFamilies,
    surfaceSignature,
    reductionBound,
    motionMeasurements,
    sceneConsistency,
    sceneMeasurements
} from './domain-semantics.js';
const systems = new WeakMap<Compiler, DomainContracts>();
const nonempty: ValueType<string> = defineType({
    id: 'semantic.nonempty-string', version: '1', description: 'A nonempty symbolic name', validate(v: unknown): asserts v is string {
        assert(typeof v === 'string' && v.length > 0, 'Expected a nonempty name');
    }
});
const integer: ValueType<number> = defineType({
    id: 'semantic.positive-integer', version: '1', description: 'A positive integral count or divisor', validate(v: unknown): asserts v is number {
        if (!Number.isSafeInteger(v) || Number(v) <= 0)
            throw new ContractError('input-type', 'Expected a positive integer');
    }
});
const finiteData: ValueType<any> = JsonValue;
type InputSpec = {
    type: ValueType<any> | IRType<any>;
    read(ctx: PassPolicyContext, params: any): unknown | Promise<unknown>;
};
interface Binding {
    definition: TransformationDefinition;
    inputs: Record<string, InputSpec>;
    outputs(artifact: Artifact): Record<string, unknown>;
    correspondence?(inputs: Record<string, unknown>, outputs: Record<string, unknown>): Correspondence[];
}
interface State {
    transaction: TransformationTransaction;
    prepared?: PreparedTransformation;
}
export interface DomainContractSetup {
    readonly registry: Registry;
    install(): DomainContracts;
}
export function createDomainContractSetup(compiler: Compiler): DomainContractSetup {
    const kinds = new Map<string, IRKind<any>>();
    return {
        registry: {
            registerKind(kind) {
                kinds.set(kind.id, kind);
                compiler.registerKind(kind);
            }, register(pass) {
                compiler.register(pass);
            }
        }, install() {
            const system = new DomainContracts(compiler, kinds);
            systems.set(compiler, system);
            system.install();
            return system;
        }
    };
}
export function getDomainContracts(compiler: Compiler): DomainContracts {
    const system = systems.get(compiler);
    assert(system, 'Semantic contracts are not installed');
    return system;
}
export function semanticContext(compiler: Compiler, ctx: PassContext): ContractContext {
    return getDomainContracts(compiler).contextFor(ctx);
}
export function recordContractSnapshot(compiler: Compiler, run: CompilationRun): void {
    const system = systems.get(compiler);
    if (system && !Object.hasOwn(run.record.extensions ?? {}, 'contracts.execution'))
        run.recordExtension('contracts.execution', system.snapshotForRun(run.id));
}
const subject = (property: PropertyDefinition<any>, from: 'inputs' | 'outputs', port: string): Condition => ({
    property, subject: {
        from, port
    }
});
const invariant = (definition: InvariantDefinition, bindings: Record<string, {
    from: 'inputs' | 'outputs';
    port: string;
}>): Condition => ({
    invariant: definition, bindings
});
const input = (port: string) => ({
    from: 'inputs' as const, port
}), output = (port: string) => ({
    from: 'outputs' as const, port
});
export class DomainContracts {
    readonly registry = new ContractRegistry();
    readonly resources = new MemoryResources({
        'mock:volume-limit': 10, 'mock:export-count': 0
    });
    readonly manager = new AnalysisManager(this.registry, this.resources);
    readonly irs = new Map<string, IRType<any>>();
    readonly bindings = new Map<string, Binding>();
    private readonly active = new Map<string, State>();
    private readonly accepted = new Map<string, ContractExecution>();
    readonly definitions: ReturnType<DomainContracts['buildDefinitions']>;
    constructor(readonly compiler: Compiler, kinds: ReadonlyMap<string, IRKind<any>>) {
        for (const kind of kinds.values()) {
            const ir = defineIR({
                id: kind.id, version: kind.version, description: kind.description, validate: kind.validate
            });
            this.irs.set(kind.id, ir);
            this.registry.register(ir);
        }
        this.definitions = this.buildDefinitions();
    }
    ir<T = unknown>(id: string): IRType<T> {
        const type = this.irs.get(id);
        assert(type, `Unknown semantic IR ${id}`);
        return type;
    }
    private buildDefinitions() {
        const MeshIR = this.ir<Mesh>('geometry.mesh'), MotionIRType = this.ir<MotionIR>('physics.motion'), SceneIR = this.ir<ScenePackage>('scene.package'), LOD = this.ir<SceneLOD>('scene.lod');
        const topology = defineAnalysis({
            id: 'semantic.mesh-topology', version: '1', description: 'Reused edge-incidence, orientation, connected-component, area and volume analysis', input: MeshIR, output: finiteData, run: (_ctx, a) => meshMetrics(a.value)
        });
        const surface = defineAnalysis({
            id: 'semantic.oriented-surface', version: '1', description: 'Exact oriented triangle coordinates and semantic face labels, independent of vertex indices', input: MeshIR, output: finiteData, run: (_ctx, a) => ({
                signature: surfaceSignature(a.value), triangles: a.value.triangles.length
            }), transfer: {
                id: 'semantic.transfer-oriented-surface', version: '1', verify(_ctx, { from, to, correspondence }) {
                    const map = checkMeshCorrespondence(from, to, correspondence);
                    return {
                        ok: map.ok && surfaceSignature(from.value) === surfaceSignature(to.value), reason: 'Entity correspondence and exact oriented triangle coordinates must agree', evidence: map
                    };
                }
            }
        });
        const namedCheck = defineAnalysis({
            id: 'semantic.named-surfaces.check', version: '1', description: 'Check semantic surface labels on each triangle', input: MeshIR, output: Check, run: (_ctx, a) => namedSurfaces(a.value), transfer: {
                id: 'semantic.transfer-surface-labels', version: '1', verify(_ctx, { from, to, correspondence }) {
                    const map = checkMeshCorrespondence(from, to, correspondence);
                    const ok = map.ok && canonical(faceFamilies(from.value)) === canonical(faceFamilies(to.value));
                    return {
                        ok, reason: ok ? 'Checked entity correspondence preserves every semantic surface family' : 'Correspondence or semantic surface families do not justify preservation', evidence: {
                            correspondence: map, families: faceFamilies(to.value)
                        }
                    };
                }
            }
        });
        const named = defineProperty({
            id: 'semantic.named-surfaces', version: '1', description: 'Every triangle has a supported semantic surface label', subject: MeshIR, check: namedCheck
        });
        const watertightCheck = defineAnalysis({
            id: 'semantic.watertight.check', version: '1', description: 'Check closed oriented nondegenerate boundary from shared topology analysis', input: MeshIR, output: Check, async run(ctx, a) {
                const m = await ctx.analysis(topology, a);
                return {
                    ok: m.watertight, reason: m.watertight ? 'Closed, oriented, nondegenerate mesh' : 'Mesh has boundary, orientation or degeneracy defects', evidence: m
                };
            }
        });
        const watertight = defineProperty({
            id: 'semantic.watertight', version: '1', description: 'Closed oriented nondegenerate triangle boundary', subject: MeshIR, check: watertightCheck
        });
        const programProperties = Object.fromEntries(['part', 'scene', 'mechanism'].map(kind => {
            const check = defineAnalysis({
                id: `semantic.program-${kind}.check`, version: '1', description: `Check the authored program is a ${kind}`, input: this.ir<any>('dsl.program'), output: Check, run: (_ctx, a) => ({
                    ok: a.value.kind === kind, reason: `Expected authored ${kind} program`, evidence: { actual: a.value.kind }
                })
            });
            return [kind, defineProperty({
                    id: `semantic.program-${kind}`, version: '1', description: `Program belongs to the ${kind} object language`, subject: this.ir('dsl.program'), check
                })];
        })) as Record<string, PropertyDefinition<any>>;
        const preservedSurface = defineInvariant({
            id: 'semantic.preserve-oriented-surface', version: '1', description: 'Vertex cleanup must preserve every ordered triangle coordinate and face identity', inputs: {
                before: MeshIR, after: MeshIR
            }, async check(ctx, { before, after }) {
                const a = await ctx.analysis(surface, before), b = await ctx.analysis(surface, after);
                ctx.record('property explanation', {
                    knownProperties: ctx.properties(before), why: ctx.explainProperty(named, before)
                });
                const ok = a.signature === b.signature && a.triangles === b.triangles;
                return {
                    ok, reason: ok ? 'Exact oriented triangle geometry and face identity are unchanged' : 'Oriented triangle geometry or semantic face identity changed', evidence: {
                        before: a, after: b
                    }
                };
            }
        });
        const reduction = defineInvariant({
            id: 'semantic.ring-deviation-bound', version: '1', description: 'Verify canonical ring geometry and its conservative analytic error bound', inputs: {
                before: MeshIR, after: this.ir<any>('scene.reduced-mesh'), divisor: integer
            }, check(_ctx, { before, after, divisor }) {
                return reductionBound(before.value, after.value, divisor);
            }
        });
        const sceneStats = defineAnalysis({
            id: 'semantic.scene-statistics', version: '1', description: 'Independent unique-reference, material, triangle-cost and topology measurements', input: SceneIR, output: finiteData, run: (_ctx, a) => sceneMeasurements(a.value)
        });
        const sceneCheck = defineAnalysis({
            id: 'semantic.scene-consistent.check', version: '1', description: 'Check shared scene statistics against all package relationships', input: SceneIR, output: Check, async run(ctx, a) {
                const m = await ctx.analysis(sceneStats, a);
                return {
                    ok: m.missingReferences.length === 0 && m.missingMaterials.length === 0 && m.uniqueDefinitions === m.definitions && m.uniqueInstances === m.instances && m.renderedTriangles === m.reportedTriangles && m.watertight, reason: 'All geometry/material references resolve and independent cost/topology measurements agree', evidence: m
                };
            }
        });
        const sceneValid = defineProperty({
            id: 'semantic.scene-consistent', version: '1', description: 'Packaged scene has unique identities, resolved references and correct counts', subject: SceneIR, check: sceneCheck
        });
        const motionStats = defineAnalysis({
            id: 'semantic.motion-residuals', version: '1', description: 'Recompute link-length errors and normalized loop residuals from sampled geometry', input: MotionIRType, output: finiteData, run: (_ctx, a) => motionMeasurements(a.value)
        });
        const motionBound = defineInvariant({
            id: 'semantic.motion-solved', version: '1', description: 'Actual sampled link geometry must satisfy solver tolerance and truthful reported measurements', inputs: {
                motion: MotionIRType, settings: this.ir<any>('physics.settings')
            }, async check(ctx, { motion, settings }) {
                const m = await ctx.analysis(motionStats, motion), limit = settings.value.tolerance, epsilon = 1e-12 * Math.max(...Object.values(motion.value.lengths));
                const settingsMatch = motion.value.samples.length === settings.value.sampleCount && motion.value.samples.every((s, i) => Math.abs(s.time - settings.value.duration * i / (settings.value.sampleCount - 1)) <= epsilon && Math.abs(s.angle - (settings.value.thetaStart + (settings.value.thetaEnd - settings.value.thetaStart) * i / (settings.value.sampleCount - 1))) <= epsilon);
                const ok = settingsMatch && m.correctBranch && m.completeBodyPoses && m.maxResidual <= limit + epsilon && m.maxLinkError <= limit + epsilon && m.maxAnchorError <= epsilon && m.maxPoseError <= epsilon && m.maxReportedError <= epsilon && Math.abs(m.maxLinkError - m.reportedLinkError) <= epsilon && Math.abs(m.maxResidual - m.reportedResidual) <= epsilon;
                return {
                    ok, reason: ok ? 'Recomputed anchors, driver, poses, branch, residuals and sample schedule match the solver evidence' : 'A sampled constraint, pose, schedule or reported measurement is inconsistent', evidence: {
                        ...m, settingsMatch, tolerance: limit, numericalSlack: epsilon
                    }
                };
            }
        });
        const triangles = defineAnalysis({
            id: 'semantic.rendered-triangles', version: '1', description: 'Measured instance-weighted triangle cost from an evaluated LOD artifact', input: LOD, output: FiniteNumber, run: (_ctx, a) => a.value.metrics.renderedTriangles
        });
        const objective = defineObjective({
            id: 'semantic.min-rendered-triangles', version: '1', description: 'Minimize instance-weighted triangle work', analysis: triangles, direction: 'min'
        });
        const volumeRead = defineEffect({
            id: 'semantic.read-volume-limit', version: '1', description: 'Read a versioned in-memory volume acceptance limit', resource: 'mock:volume-limit', access: 'read', type: FiniteNumber
        });
        const exportRead = defineEffect({
            id: 'semantic.read-export-count', version: '1', description: 'Read an in-memory export counter', resource: 'mock:export-count', access: 'read', type: FiniteNumber
        });
        const exportWrite = defineEffect({
            id: 'semantic.write-export-count', version: '1', description: 'Stage an atomic in-memory export-counter update', resource: 'mock:export-count', access: 'write', type: FiniteNumber
        });
        const resourceBound = defineInvariant({
            id: 'semantic.resource-volume-bound', version: '1', description: 'Audit geometry against the current externally versioned acceptance limit', inputs: { mesh: MeshIR }, effects: [volumeRead], async check(ctx, { mesh }) {
                const metrics = await ctx.analysis(topology, mesh), limit = ctx.readResource(volumeRead);
                return {
                    ok: metrics.volume <= limit, reason: `Mesh volume ${metrics.volume} must not exceed resource limit ${limit}`, evidence: {
                        volume: metrics.volume, limit
                    }
                };
            }
        });
        const defs = {
            MeshIR, topology, surface, named, watertight, programProperties, preservedSurface, reduction, sceneStats, sceneValid, motionStats, motionBound, triangles, objective, volumeRead, exportRead, exportWrite, resourceBound
        };
        for (const d of Object.values(defs))
            if (d && typeof d === 'object' && 'category' in d)
                this.registry.register(d as any);
        return defs;
    }
    private taskPort(name: string, kind: string): InputSpec {
        return {
            type: this.ir(kind), read: (ctx, p) => ctx.require(p[name])
        };
    }
    private valuePort(name: string, type: ValueType<any> = finiteData): InputSpec {
        return {
            type, read: (_ctx, p) => p[name]
        };
    }
    private tasksPort(name: string, kind: string, map = false): InputSpec {
        const ir = this.ir(kind), type: ValueType<any> = defineType({
            id: `semantic.${kind}.${map ? 'map' : 'array'}`, version: '1', description: `${map ? 'Named map' : 'Array'} of exact ${kind}@${ir.version} artifacts`, validate(v: unknown): asserts v is any {
                assert(v && typeof v === 'object' && (map ? !Array.isArray(v) : Array.isArray(v)), `Expected artifact ${map ? 'map' : 'array'}`);
                for (const a of Object.values(v))
                    validateArtifact(ir, a);
            }
        });
        return {
            type, read: async (ctx, p) => map ? Object.fromEntries(await Promise.all(Object.entries(p[name] as Record<string, Task>).map(async ([k, t]) => [k, await ctx.require(t)]))) : Promise.all((p[name] as Task[]).map(t => ctx.require(t)))
        };
    }
    private standardInputs(id: string): Record<string, InputSpec> {
        const t = (name: string, kind: string) => this.taskPort(name, kind), v = (name: string, type: ValueType<any> = finiteData) => this.valuePort(name, type), many = (name: string, kind: string, map = false) => this.tasksPort(name, kind, map);
        if (id === 'dsl.source' || id === 'geometry.cleanup-source' || id === 'contracts.lab-source')
            return { key: v('key', nonempty) };
        if (id === 'dsl.import')
            return {
                parent: t('parent', 'dsl.program'), slot: v('slot')
            };
        if (id.startsWith('cad.project-'))
            return {
                source: t('source', 'dsl.program'), ...(id === 'cad.project-sketch' ? { id: v('id', nonempty) } : {})
            };
        if (id.startsWith('physics.project-'))
            return {
                source: t('source', 'dsl.program'), ...(id === 'physics.project-settings' ? { solver: v('solver', nonempty) } : {})
            };
        if (id.startsWith('scene.project-'))
            return {
                source: t('source', 'dsl.program'), ...(id === 'scene.project-shape' ? { id: v('id', nonempty) } : {})
            };
        switch (id) {
            case 'math.compile-tape': return { program: t('program', 'math.residual-program') };
            case 'geometry.mesh-metrics':
            case 'geometry.cleanup-one-vertex': return { mesh: t('mesh', 'geometry.mesh') };
            case 'cad.lower-sketch': return { sketch: t('sketch', 'cad.sketch-spec') };
            case 'cad.solve-profile': return {
                sketch: t('sketch', 'cad.sketch-spec'), options: t('options', 'cad.solve-options'), residual: t('residual', 'math.residual-program'), tape: t('tape', 'math.numeric-tape')
            };
            case 'cad.elaborate-history': return {
                features: t('features', 'cad.feature-list'), sketches: many('sketches', 'cad.sketch', true)
            };
            case 'cad.recognize-solid': return { history: t('history', 'cad.elaborated-history') };
            case 'cad.mesh-boundary': return {
                solid: t('solid', 'cad.solid'), options: t('options', 'cad.tessellation')
            };
            case 'assembly.four-bar': return { assembly: t('assembly', 'assembly.planar') };
            case 'physics.lower-constraints': return { graph: t('graph', 'physics.constraint-graph') };
            case 'physics.sample-motion': return {
                graph: t('graph', 'physics.constraint-graph'), tape: t('tape', 'math.numeric-tape'), settings: t('settings', 'physics.settings'), solver: v('solver', nonempty)
            };
            case 'physics.choose-motion': return {
                candidates: many('candidates', 'physics.motion'), policy: t('policy', 'physics.policy')
            };
            case 'scene.tessellate-primitive': return { spec: t('spec', 'scene.geometry-spec') };
            case 'scene.reduce-rings': return {
                mesh: t('mesh', 'geometry.mesh'), divisor: v('divisor', integer)
            };
            case 'scene.build-candidate': return {
                reduced: many('reduced', 'scene.reduced-mesh', true), layout: t('layout', 'scene.layout'), bindings: t('bindings', 'scene.material-bindings'), divisor: v('divisor', integer)
            };
            case 'scene.choose-candidate': return {
                policy: t('policy', 'scene.policy'), candidates: many('candidates', 'scene.lod')
            };
            case 'scene.package': return {
                selected: t('selected', 'scene.selection'), layout: t('layout', 'scene.layout'), appearance: t('appearance', 'scene.appearance')
            };
            case 'scene.collision-boxes': return { scene: t('scene', 'scene.package') };
            case 'scene.attach-motion': return {
                scene: t('scene', 'scene.package'), motion: t('motion', 'physics.motion'), attachments: t('attachments', 'scene.attachments'), collision: t('collision', 'scene.collision')
            };
            default:
                if (id.startsWith('contracts.'))
                    return { mesh: t('mesh', 'geometry.mesh') };
                throw new Error(`No semantic input contract for ${id}`);
        }
    }
    install(): void {
        for (const pass of this.compiler.passDescriptors())
            this.installPass(pass.id, pass.kind);
    }
    private installPass(id: string, kind: string): void {
        const d = this.definitions, inputs = this.standardInputs(id), outputs: Record<string, any> = { result: this.ir(kind) };
        const requires: Condition[] = [], ensures: Condition[] = [], establishes: Condition[] = [], preserves: any[] = [], correspondence: any[] = [], effects: any[] = [];
        let cache: 'pure' | 'tracked' | 'never' = 'pure';
        let project: (a: Artifact) => Record<string, unknown> = a => ({ result: a }), map: Binding['correspondence'];
        const programKind = id.startsWith('cad.project-') ? 'part' : id.startsWith('physics.project-') ? 'mechanism' : id.startsWith('scene.project-') ? 'scene' : null;
        if (programKind)
            requires.push(subject(d.programProperties[programKind], 'inputs', 'source'));
        if (id === 'dsl.import')
            requires.push(subject(d.programProperties.scene, 'inputs', 'parent'));
        if (id === 'scene.reduce-rings') {
            outputs.mesh = d.MeshIR;
            project = a => ({
                result: a, mesh: createArtifact(d.MeshIR, `${a.id}/semantic-mesh`, (a.value as {
                    mesh: Mesh;
                }).mesh)
            });
            requires.push(subject(d.named, 'inputs', 'mesh'), subject(d.watertight, 'inputs', 'mesh'));
            ensures.push(subject(d.watertight, 'outputs', 'mesh'), invariant(d.reduction, {
                before: input('mesh'), after: output('result'), divisor: input('divisor')
            }));
            preserves.push({
                property: d.named, from: 'mesh', to: 'mesh', mode: 'transfer', correspondence: 'mesh-correspondence'
            });
            correspondence.push({
                id: 'mesh-correspondence', from: 'mesh', to: 'mesh', relation: 'mesh-entities'
            });
            map = (before, after) => [meshCorrespondence(before.mesh as Artifact<Mesh>, after.mesh as Artifact<Mesh>)];
        }
        if (id === 'geometry.cleanup-one-vertex' || id === 'contracts.verified-cleanup' || id === 'contracts.bad-transform' || id === 'contracts.false-preservation' || id === 'contracts.rollback-effect') {
            requires.push(subject(d.named, 'inputs', 'mesh'));
            ensures.push(invariant(d.preservedSurface, {
                before: input('mesh'), after: output('result')
            }));
            preserves.push({
                property: d.named, from: 'mesh', to: 'result', mode: 'transfer', correspondence: 'mesh-correspondence'
            });
            correspondence.push({
                id: 'mesh-correspondence', from: 'mesh', to: 'result', relation: 'mesh-entities'
            });
            map = (before, after) => [meshCorrespondence(before.mesh as Artifact<Mesh>, after.result as Artifact<Mesh>)];
            if (id === 'contracts.bad-transform' || id === 'contracts.rollback-effect') {
                preserves.length = 0;
                correspondence.length = 0;
                map = undefined;
            }
            if (id === 'contracts.false-preservation') {
                ensures.length = 0;
            }
        }
        if (id === 'cad.mesh-boundary' || id === 'scene.tessellate-primitive')
            establishes.push(subject(d.watertight, 'outputs', 'result'), subject(d.named, 'outputs', 'result'));
        if (id === 'scene.build-candidate') {
            const checked = defineInvariant({
                id: 'semantic.candidate-cost-and-materials', version: '1', description: 'Candidate meshes, material assignments, measured instance costs and bounds agree with their inputs', inputs: {
                    candidate: this.ir<SceneLOD>('scene.lod'), layout: this.ir<any>('scene.layout'), bindings: this.ir<any>('scene.material-bindings'), reduced: inputs.reduced.type
                }, async check(ctx, { candidate, layout, bindings, reduced }) {
                    const records = reduced as Record<string, Artifact<{
                        mesh: Mesh;
                        errorBound: number;
                        sourceErrorBound: number;
                    }>>, byId = new Map(candidate.value.definitions.map(def => [def.id, def]));
                    const rendered = layout.value.occurrences.reduce((n: number, o: any) => n + (byId.get(o.definition)?.mesh.triangles.length ?? 0), 0), measured = await ctx.analysis(d.objective.analysis, candidate);
                    const assignments = Object.keys(records).length === candidate.value.definitions.length && candidate.value.definitions.every(def => records[def.id] && canonical(def.mesh) === canonical(records[def.id].value.mesh) && def.materialSlot === bindings.value.slots[def.id]);
                    const bounds = candidate.value.metrics.surfaceErrorBound === Math.max(0, ...Object.values(records).map(a => a.value.errorBound)) && candidate.value.metrics.sourceApproximationBound === Math.max(0, ...Object.values(records).map(a => a.value.sourceErrorBound));
                    ctx.record('semantic objective', {
                        objective: {
                            id: d.objective.id, version: d.objective.version
                        }, direction: d.objective.direction, value: measured, independentValue: rendered
                    });
                    const ok = assignments && bounds && measured === rendered;
                    return {
                        ok, reason: ok ? 'Candidate assignments, source geometry, bounds and objective cost agree' : 'Candidate material/geometry assignments, error bounds or objective cost disagree', evidence: {
                            assignments, bounds, measured, independentRenderedTriangles: rendered
                        }
                    };
                }
            });
            ensures.push(invariant(checked, {
                candidate: output('result'), layout: input('layout'), bindings: input('bindings'), reduced: input('reduced')
            }));
        }
        if (id === 'scene.package') {
            establishes.push(subject(d.sceneValid, 'outputs', 'result'));
            const checked = defineInvariant({
                id: 'semantic.package-assignments', version: '1', description: 'Packaging preserves selected geometry, authored occurrences and material values exactly', inputs: {
                    selected: this.ir<SceneSelection>('scene.selection'), layout: this.ir<any>('scene.layout'), appearance: this.ir<any>('scene.appearance'), result: this.ir<ScenePackage>('scene.package')
                }, check(_ctx, { selected, layout, appearance, result }) {
                    const a = result.value, s = selected.value.selected;
                    const fields = {
                        definitions: canonical(a.definitions) === canonical(s.definitions), occurrences: canonical(a.occurrences) === canonical(layout.value.occurrences), materials: canonical(a.materials) === canonical(appearance.value.materials), name: a.name === appearance.value.name, selection: a.selectedLOD === s.name, metrics: canonical(a.metrics) === canonical(s.metrics)
                    };
                    return {
                        ok: Object.values(fields).every(Boolean), reason: Object.values(fields).every(Boolean) ? 'Packaging preserved geometry, instances, material assignments and values' : 'Packaging changed a selected or authored field', evidence: fields
                    };
                }
            });
            ensures.push(invariant(checked, {
                selected: input('selected'), layout: input('layout'), appearance: input('appearance'), result: output('result')
            }));
        }
        if (id === 'physics.sample-motion')
            ensures.push(invariant(d.motionBound, {
                motion: output('result'), settings: input('settings')
            }));
        if (id === 'contracts.resource-bound') {
            effects.push(d.volumeRead);
            cache = 'tracked';
            ensures.push(invariant(d.resourceBound, { mesh: output('result') }));
        }
        if (id === 'contracts.resource-derived') {
            effects.push(d.volumeRead);
            cache = 'tracked';
            establishes.push(subject(d.watertight, 'outputs', 'result'));
        }
        if (id === 'contracts.commit-effect' || id === 'contracts.rollback-effect') {
            effects.push(d.exportRead, d.exportWrite);
            cache = 'never';
        }
        const definition = defineTransformation({
            id: `contract:${id}`, version: '1', description: `Typed semantic acceptance contract for ${id}`, inputs: Object.fromEntries(Object.entries(inputs).map(([k, s]) => [k, s.type])), outputs, requires, ensures, establishes, preserves, correspondence, effects, cache
        });
        this.attach(id, {
            definition, inputs, outputs: project, ...(map ? { correspondence: map } : {})
        });
    }
    attach(passId: string, binding: Binding): void {
        this.registry.register(binding.definition);
        this.bindings.set(passId, binding);
        const system = this;
        this.compiler.setPassPolicy<State>(passId, {
            id: binding.definition.id, version: binding.definition.version, cache: binding.definition.cache !== 'never',
            async before(ctx, params) {
                const entries: Record<string, unknown> = {};
                for (const [name, spec] of Object.entries(binding.inputs))
                    entries[name] = await spec.read(ctx, params);
                const transaction = await system.manager.beginTransformation(binding.definition, entries, {
                    id: `${ctx.invocationId}/contract`, runId: ctx.runId, invocationId: ctx.invocationId
                });
                const state = { transaction };
                system.active.set(ctx.invocationId, state);
                return state;
            },
            reuse(_ctx, _params, _artifact, state, candidate) {
                assert(state, 'Missing semantic transaction');
                const previous = system.accepted.get(candidate.originInvocation);
                if (!previous)
                    return {
                        allow: false, reason: 'No prior semantic body-dependency manifest is available'
                    };
                if (!previous.bodyCacheable)
                    return {
                        allow: false, reason: 'The prior body performed non-reusable semantic work'
                    };
                if (!system.manager.canReuseDependencies(previous.bodyDependencies))
                    return {
                        allow: false, reason: 'A semantic body analysis or resource revision changed'
                    };
                state.transaction.importBodyDependencies(previous.bodyDependencies);
                return {
                    allow: true, reason: 'Semantic body dependencies remain valid; current acceptance checks still run'
                };
            },
            async after(_ctx, _params, artifact, state, { cached }) {
                assert(state, 'Missing semantic transaction');
                const outputs = binding.outputs(artifact);
                state.prepared = await state.transaction.verify(outputs, binding.correspondence?.(state.transaction.inputs, outputs) ?? [], { cached });
            },
            committed(ctx, _params, _artifact, state) {
                assert(state?.prepared, 'Semantic checks did not prepare acceptance');
                const accepted = state.prepared.commit();
                system.accepted.set(ctx.invocationId, accepted);
                system.active.delete(ctx.invocationId);
            },
            async failed(ctx, _params, state, error) {
                try {
                    if (state) {
                        await state.transaction.settle();
                        if (state.transaction.execution.status === 'prepared')
                            state.transaction.fail(error);
                    }
                }
                finally {
                    system.active.delete(ctx.invocationId);
                }
            }
        });
    }
    contextFor(ctx: PassContext): ContractContext {
        const state = this.active.get(ctx.invocationId);
        assert(state, 'Pass has no active semantic contract context');
        return state.transaction.context;
    }
    snapshotForRun(runId: string): ContractSnapshot {
        const snapshot = this.manager.snapshot(), executions = snapshot.executions.filter(e => e.runId === runId), analysisIds = new Set(executions.flatMap(e => e.analyses)), factIds = new Set(executions.flatMap(e => e.facts));
        const analyses = new Map(snapshot.analyses.map(a => [a.id, a])), facts = new Map(snapshot.facts.map(f => [f.id, f]));
        let changed = true;
        while (changed) {
            changed = false;
            for (const id of [...analysisIds, ...factIds]) {
                const record = analyses.get(id) ?? facts.get(id);
                for (const dep of record?.dependencies ?? []) {
                    const set = dep.type === 'analysis' ? analysisIds : dep.type === 'property' ? factIds : null, key = dep.type === 'analysis' ? dep.recordId : dep.type === 'property' ? dep.factId : null;
                    if (set && key && !set.has(key)) {
                        set.add(key);
                        changed = true;
                    }
                }
                if (record && 'transfer' in record && record.transfer && !analysisIds.has(record.transfer.sourceRecord)) {
                    analysisIds.add(record.transfer.sourceRecord);
                    changed = true;
                }
            }
        }
        const eventSequences = new Set(executions.flatMap(e => e.events.map(e => e.sequence)));
        return immutable({
            ...snapshot, executions, analyses: snapshot.analyses.filter(a => analysisIds.has(a.id)), facts: snapshot.facts.filter(f => factIds.has(f.id)), events: snapshot.events.filter(e => eventSequences.has(e.sequence))
        });
    }
}
