import { assert, finite, task, type Registry, type Task, type Artifact } from '../core/types.js';
import type { Program } from '../languages/program.js';
import type { SceneProgram, Definition, Instance, ScenePolicy, Shape } from '../languages/scene.js';
import { boxMesh, cylinderMesh, meshMetrics, validateMesh, type Mesh, type Vec3 } from '../geometry/mesh.js';
import { frameMesh, roofMesh, decimateCylinder } from '../geometry/primitives.js';
import { validateLayout, validateMeshSet, validateScenePackage, type MeshSet, type SceneLayout, type ScenePackage, type LODMetrics, type MeshDefinition, type Occurrence } from '../scene/schema.js';
import { validateCollision, validateAnimatedScene, type CollisionIR, type AnimatedScenePackage } from '../scene/animation.js';
import type { MotionIR } from '../math/four-bar.js';
import { selectByMetrics } from '../core/strategies.js';
interface GeometrySpec {
    id: string;
    shape: Shape;
}
interface Appearance {
    name: string;
    materials: SceneProgram['materials'];
}
interface Bindings {
    slots: Record<string, string>;
}
interface SelectionPolicy {
    objective: ScenePolicy['objective'];
    maxError: number;
}
interface ReducedMesh {
    mesh: Mesh;
    errorBound: number;
    sourceErrorBound: number;
}
export interface SceneLOD extends MeshSet {
    name: string;
    divisor: number;
    metrics: LODMetrics;
    errorMeaning: string;
}
export interface SceneSelection {
    selected: SceneLOD;
    objective: ScenePolicy['objective'];
    maxError: number;
    alternatives: {
        name: string;
        metrics: LODMetrics;
        feasible: boolean;
    }[];
}
interface AttachmentMap {
    instances: Instance[];
}
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function sceneOf(v: Program): SceneProgram {
    assert(v.kind === 'scene', 'Expected scene program');
    return v;
}
function validateGeometrySpec(v: unknown): asserts v is GeometrySpec { assert(obj(v) && typeof v.id === 'string' && obj(v.shape), 'Geometry definition required'); }
function validateAppearance(v: unknown): asserts v is Appearance {
    assert(obj(v) && typeof v.name === 'string' && obj(v.materials), 'Appearance required');
    for (const m of Object.values(v.materials)) {
        assert(obj(m) && typeof m.color === 'string' && /^#[0-9a-f]{6}$/i.test(m.color), 'Invalid material color');
        finite(m.opacity, 'opacity');
        assert(m.opacity >= 0 && m.opacity <= 1, 'Invalid opacity');
    }
}
function validateBindings(v: unknown): asserts v is Bindings { assert(obj(v) && obj(v.slots) && Object.values(v.slots).every(x => typeof x === 'string'), 'Material slot assignments required'); }
function validatePolicy(v: unknown): asserts v is SelectionPolicy {
    assert(obj(v) && ['triangles', 'quality'].includes(String(v.objective)), 'Unknown scene objective');
    finite(v.maxError, 'error budget');
    assert(v.maxError >= 0, 'Error budget must be nonnegative');
}
function validateReduced(v: unknown): asserts v is ReducedMesh {
    assert(obj(v), 'Reduced mesh required');
    validateMesh(v.mesh);
    finite(v.errorBound, 'reduction error');
    finite(v.sourceErrorBound, 'source error');
    assert(v.errorBound >= 0 && v.sourceErrorBound >= 0, 'Bounds must be nonnegative');
}
function validateLOD(v: unknown): asserts v is SceneLOD {
    validateMeshSet(v);
    const d = v as SceneLOD;
    assert(typeof d.name === 'string' && Number.isInteger(d.divisor) && d.divisor >= 1 && obj(d.metrics), 'Invalid LOD');
    for (const n of Object.values(d.metrics)) {
        finite(n, 'metric');
        assert(n >= 0, 'Negative metric');
    }
    assert(d.metrics.uniqueTriangles === d.definitions.reduce((s, d) => s + d.mesh.triangles.length, 0), 'LOD unique triangle count mismatch');
}
function validateSelection(v: unknown): asserts v is SceneSelection {
    assert(obj(v) && Array.isArray(v.alternatives), 'Invalid selection');
    validateLOD(v.selected);
    validatePolicy(v);
}
function validateAttachments(v: unknown): asserts v is AttachmentMap { assert(obj(v) && Array.isArray(v.instances), 'Attachments required'); }
export function registerScenePipeline(reg: Registry) {
    reg.registerKind<GeometrySpec>({ id: 'scene.geometry-spec', version: '1', description: 'One authored shape definition, independent of its occurrences and appearance', validate: validateGeometrySpec });
    reg.registerKind<Appearance>({ id: 'scene.appearance', version: '1', description: 'Name and material colors, independent of meshes', validate: validateAppearance });
    reg.registerKind<Bindings>({ id: 'scene.material-bindings', version: '1', description: 'Definition to material-slot mapping', validate: validateBindings });
    reg.registerKind<SelectionPolicy>({ id: 'scene.policy', version: '1', description: 'Cost objective and approximation budget', validate: validatePolicy });
    reg.registerKind<ReducedMesh>({ id: 'scene.reduced-mesh', version: '1', description: 'One mesh and its reduction/source approximation bounds', validate: validateReduced });
    reg.registerKind<SceneLOD>({ id: 'scene.lod', version: '1', description: 'Candidate mesh set with instance-weighted cost and conservative reduction bounds', validate: validateLOD });
    reg.registerKind<SceneSelection>({ id: 'scene.selection', version: '1', description: 'Selected LOD, authored policy, executed strategy objective and evaluated alternatives', validate: validateSelection });
    reg.registerKind<AttachmentMap>({ id: 'scene.attachments', version: '1', description: 'Authored local occurrence transforms and optional body attachments', validate: validateAttachments, structure: v => v.instances.filter(o => o.attach).map(o => ({ from: o.attach!, to: o.id, relation: 'drives' })) });
    reg.registerKind<CollisionIR>({ id: 'scene.collision', version: '1', description: 'Conservative local-space bounds, not a contact simulation', validate: validateCollision });
    reg.registerKind<AnimatedScenePackage>({ id: 'scene.animated-package', version: '1', description: 'Mesh scene and discrete rigid-body animation samples', validate: validateAnimatedScene, structure: s => s.occurrences.map(o => ({ from: o.id, to: o.definition, relation: 'instance-of' })) });
    reg.register<{
        source: Task;
        id: string;
    }, GeometrySpec>({
        id: 'scene.project-shape', version: '1', kind: 'scene.geometry-spec', description: 'Project a shape by authored definition identity', async run(ctx, { source, id }) {
            const s = await ctx.require<Program>(source), d = sceneOf(s.value).definitions.find(d => d.id === id);
            assert(d, `Missing definition ${id}`);
            ctx.derive(s, { from: [id], to: [id], relation: 'project-shape' });
            return { id, shape: d.shape };
        }
    });
    reg.register<{
        source: Task;
    }, Appearance>({
        id: 'scene.project-appearance', version: '1', kind: 'scene.appearance', description: 'Separate material values from geometry', async run(ctx, { source }) {
            const s = await ctx.require<Program>(source), p = sceneOf(s.value);
            ctx.derive(s, { from: ['materials'], relation: 'project-appearance' });
            return { name: p.name, materials: p.materials };
        }
    });
    reg.register<{
        source: Task;
    }, Bindings>({
        id: 'scene.project-bindings', version: '1', kind: 'scene.material-bindings', description: 'Separate definition-to-material assignment from tessellation', async run(ctx, { source }) {
            const s = await ctx.require<Program>(source), p = sceneOf(s.value);
            ctx.derive(s, { relation: 'project-bindings' });
            return { slots: Object.fromEntries(p.definitions.map(d => [d.id, d.material])) };
        }
    });
    reg.register<{
        source: Task;
    }, SceneLayout>({
        id: 'scene.project-layout', version: '1', kind: 'scene.layout', description: 'Lower authored occurrences to the shared scene layout without creating geometry', async run(ctx, { source }) {
            const s = await ctx.require<Program>(source), p = sceneOf(s.value);
            const occurrences = p.instances.map(o => ({ id: o.id, definition: o.definition, translation: o.at, rotationZ: o.rotate }));
            for (const o of occurrences)
                ctx.derive(s, { from: [o.id], to: [o.id], relation: 'instance' });
            ctx.metric('occurrences', occurrences.length);
            return { units: 'm', up: 'z', occurrences };
        }
    });
    reg.register<{
        source: Task;
    }, SelectionPolicy>({
        id: 'scene.project-policy', version: '1', kind: 'scene.policy', description: 'Project only selection criteria; candidate construction is independent', async run(ctx, { source }) {
            const s = await ctx.require<Program>(source), p = sceneOf(s.value);
            ctx.derive(s, { from: ['policy'], relation: 'project-policy' });
            return { objective: p.policy.objective, maxError: p.policy.maxError };
        }
    });
    reg.register<{
        spec: Task;
    }, Mesh>({
        id: 'scene.tessellate-primitive', version: '1', kind: 'geometry.mesh', description: 'Tessellate any supported primitive; no building-specific logic', async run(ctx, { spec }) {
            const a = await ctx.require<GeometrySpec>(spec), { id, shape: s } = a.value;
            let mesh: Mesh;
            switch (s.kind) {
                case 'box':
                    mesh = boxMesh(...s.size, id);
                    break;
                case 'gable':
                    mesh = roofMesh(...s.size, id);
                    break;
                case 'cylinder':
                    mesh = cylinderMesh(s.radius, s.height, s.segments, id);
                    break;
                case 'frame':
                    mesh = frameMesh({ id, dimensions: s.size, opening: s.opening });
                    ctx.decision({ code: 'compound-frame', message: 'Opening built from closed pieces, not a Boolean union.' });
                    break;
                case 'cad': throw new Error('CAD shapes require the CAD compiler adapter');
            }
            const metrics = meshMetrics(mesh);
            assert(metrics.watertight, `Open or inconsistent mesh: ${id}`);
            ctx.metric('triangles', mesh.triangles.length);
            ctx.derive(a, { from: [id], to: [...new Set(mesh.faceIds)], relation: 'tessellate' });
            return mesh;
        }
    });
    reg.register<{
        mesh: Task;
        divisor: number;
    }, ReducedMesh>({
        id: 'scene.reduce-rings', version: '1', kind: 'scene.reduced-mesh', description: 'Reduce canonical cylinder rings, retaining other meshes exactly', async run(ctx, { mesh, divisor }) {
            const a = await ctx.require<Mesh>(mesh), m = a.value;
            let result: ReducedMesh;
            const info = m.metadata;
            if (info?.primitive === 'cylinder' && info.segments! % divisor === 0 && info.segments! / divisor >= 6) {
                const r = decimateCylinder(m, divisor);
                result = { mesh: r.mesh, errorBound: r.errorBound, sourceErrorBound: r.sourceErrorBound };
                for (const c of r.correspondence)
                    ctx.derive(a, { from: c.from, to: [c.to], relation: c.from.length > 1 ? 'coarsened' : 'retained' });
                ctx.decision({ code: 'ring-decimation', message: `Cylinder ${info.segments} → ${info.segments! / divisor} sides`, evidence: { divisor, errorBound: r.errorBound } });
            }
            else {
                result = { mesh: m, errorBound: 0, sourceErrorBound: typeof info?.approximationBound === 'number' ? info.approximationBound : info?.primitive === 'cylinder' ? info.radius! * (1 - Math.cos(Math.PI / info.segments!)) : 0 };
                ctx.derive(a, { relation: 'retained-mesh' });
                ctx.decision({ code: 'retain-mesh', message: info?.primitive === 'cylinder' ? 'Requested divisor incompatible with ring topology; retained the source.' : 'No applicable reduction for this mesh kind.' });
            }
            ctx.metric('triangles', result.mesh.triangles.length);
            ctx.metric('reduction-bound', result.errorBound, 'm');
            return result;
        }
    });
    reg.register<{
        reduced: Record<string, Task>;
        layout: Task;
        bindings: Task;
        divisor: number;
    }, SceneLOD>({
        id: 'scene.build-candidate', version: '1', kind: 'scene.lod', description: 'Aggregate per-definition reductions and calculate instance-weighted cost', async run(ctx, { reduced, layout, bindings, divisor }) {
            const l = await ctx.require<SceneLayout>(layout), b = await ctx.require<Bindings>(bindings);
            let surfaceErrorBound = 0, sourceApproximationBound = 0;
            const definitions: MeshDefinition[] = [];
            for (const [id, t] of Object.entries(reduced)) {
                const a = await ctx.require<ReducedMesh>(t);
                assert(Object.hasOwn(b.value.slots, id), `Missing material slot ${id}`);
                definitions.push({ id, mesh: a.value.mesh, materialSlot: b.value.slots[id] });
                surfaceErrorBound = Math.max(surfaceErrorBound, a.value.errorBound);
                sourceApproximationBound = Math.max(sourceApproximationBound, a.value.sourceErrorBound);
                ctx.derive(a, { to: [id], relation: 'candidate-definition' });
            }
            const byId = new Map(definitions.map(d => [d.id, d]));
            const metrics: LODMetrics = { uniqueTriangles: definitions.reduce((n, d) => n + d.mesh.triangles.length, 0), vertices: definitions.reduce((n, d) => n + d.mesh.positions.length, 0), renderedTriangles: l.value.occurrences.reduce((n, o) => {
                    const d = byId.get(o.definition);
                    assert(d, `Unknown mesh ${o.definition}`);
                    return n + d.mesh.triangles.length;
                }, 0), surfaceErrorBound, sourceApproximationBound };
            ctx.derive(l, { relation: 'instance-cost' });
            ctx.derive(b, { relation: 'bind-materials' });
            for (const [k, v] of Object.entries(metrics))
                ctx.metric(k, v);
            return { units: 'm', definitions, name: `divisor-${divisor}`, divisor, metrics, errorMeaning: 'Reduction bound relative to the input mesh, in meters; sourceApproximationBound describes original primitive/CAD discretization.' };
        }
    });
    reg.register<{
        policy: Task;
        candidates: Task[];
        selected?: Task;
        strategySelection?: unknown;
    }, SceneSelection>({
        id: 'scene.choose-candidate', version: '2', kind: 'scene.selection', role: 'strategy', description: 'Apply the shared constrained metric selector to evaluated LODs', async run(ctx, { policy, candidates, selected, strategySelection }) {
            const p = await ctx.require<SelectionPolicy>(policy), a = await Promise.all(candidates.map(t => ctx.require<SceneLOD>(t)));
            if (selected) {
                assert(candidates.some(t => t.id === selected.id), 'Strategy selection must reference an evaluated candidate');
                const winner = await ctx.require<SceneLOD>(selected);
                assert(winner.value.metrics.surfaceErrorBound <= p.value.maxError, 'Strategy selected a candidate outside the error budget');
                ctx.derive(winner, { relation: 'selected-by-strategy-ir' });
                ctx.decision({ code: 'strategy.choice-materialized', message: `Materialized Strategy IR choice ${winner.value.name}`, evidence: { selectedTask: selected.id, authoredObjective: p.value.objective, maxError: p.value.maxError, ...(strategySelection ? { strategySelection } : {}) }, alternatives: a.map(x => ({ name: x.value.name, accepted: x.id === winner.id, metrics: { ...x.value.metrics }, reason: x.id === winner.id ? 'Selected by the recorded Strategy IR chooseBest node' : x.value.metrics.surfaceErrorBound > p.value.maxError ? 'Outside the error budget' : 'Feasible alternative retained in Strategy IR evidence' })) });
                return { selected: winner.value, objective: p.value.objective, maxError: p.value.maxError, ...(strategySelection ? { strategySelection } : {}), alternatives: a.map(x => ({ name: x.value.name, metrics: x.value.metrics, feasible: x.value.metrics.surfaceErrorBound <= p.value.maxError })) };
            }
            const winner = selectByMetrics(ctx, a.map(x => ({ name: x.value.name, artifact: x, metrics: { ...x.value.metrics } })), { metric: p.value.objective === 'triangles' ? 'renderedTriangles' : 'surfaceErrorBound', direction: 'min' }, [{ metric: 'surfaceErrorBound', op: '<=', value: p.value.maxError }]);
            return { selected: winner.artifact.value, objective: p.value.objective, maxError: p.value.maxError, alternatives: a.map(x => ({ name: x.value.name, metrics: x.value.metrics, feasible: x.value.metrics.surfaceErrorBound <= p.value.maxError })) };
        }
    });
    reg.register<{
        selected: Task;
        layout: Task;
        appearance: Task;
    }, ScenePackage>({
        id: 'scene.package', version: '1', kind: 'scene.package', description: 'Package selected definitions, authored occurrences and material values', async run(ctx, { selected, layout, appearance }) {
            const s = await ctx.require<SceneSelection>(selected), l = await ctx.require<SceneLayout>(layout), a = await ctx.require<Appearance>(appearance);
            for (const x of [s, l, a])
                ctx.derive(x, { relation: 'package' });
            return { format: 'ir-workbench.scene/1', name: a.value.name, units: 'm', up: 'z', definitions: s.value.selected.definitions, occurrences: l.value.occurrences, selectedLOD: s.value.selected.name, metrics: s.value.selected.metrics, materials: a.value.materials, semantics: { definitionInstancing: true, triangleMeshes: true, collision: 'none' } };
        }
    });
    reg.register<{
        source: Task;
    }, AttachmentMap>({
        id: 'scene.project-attachments', version: '1', kind: 'scene.attachments', description: 'Read local transforms and symbolic body attachments from the scene program', async run(ctx, { source }) {
            const s = await ctx.require<Program>(source);
            const instances = sceneOf(s.value).instances;
            for (const o of instances)
                ctx.derive(s, { from: [o.id], to: [o.id], relation: 'attachment' });
            return { instances };
        }
    });
    reg.register<{
        scene: Task;
    }, CollisionIR>({
        id: 'scene.collision-boxes', version: '1', kind: 'scene.collision', description: 'Construct conservative local AABBs from the selected geometry', async run(ctx, { scene }) {
            const s = await ctx.require<ScenePackage>(scene);
            const colliders = s.value.definitions.map(d => {
                const m = meshMetrics(d.mesh);
                ctx.derive(s, { from: [d.id], to: [d.id], relation: 'bounds' });
                return { definition: d.id, min: m.bounds.min, max: m.bounds.max };
            });
            return { type: 'box-colliders', units: 'm', policy: 'conservative-local-aabb', colliders };
        }
    });
    reg.register<{
        scene: Task;
        motion: Task;
        attachments: Task;
        collision: Task;
    }, AnimatedScenePackage>({
        id: 'scene.attach-motion', version: '1', kind: 'scene.animated-package', description: 'Compose authored local transforms with verified mechanism poses by body ID', async run(ctx, { scene, motion, attachments, collision }) {
            const s = await ctx.require<ScenePackage>(scene), m = await ctx.require<MotionIR>(motion), a = await ctx.require<AttachmentMap>(attachments), c = await ctx.require<CollisionIR>(collision);
            const samples = m.value.samples.map(sample => ({ time: sample.time, poses: a.value.instances.map(o => {
                    const base: Occurrence = { id: o.id, definition: o.definition, translation: o.at, rotationZ: o.rotate };
                    if (o.attach === null)
                        return base;
                    const p = sample.bodyPoses.find(b => b.id === o.attach);
                    assert(p, `Missing solved pose ${o.attach}`);
                    const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
                    return { ...base, translation: [p.translation[0] + cos * o.at[0] - sin * o.at[1], p.translation[1] + sin * o.at[0] + cos * o.at[1], p.translation[2] + o.at[2]] as Vec3, rotationZ: p.angle + o.rotate };
                }) }));
            for (const x of [s, m, a, c])
                ctx.derive(x, { relation: 'compose-animation' });
            for (const o of a.value.instances)
                if (o.attach)
                    ctx.derive(m, { from: [o.attach], to: [o.id], relation: 'rigid-attachment' });
            ctx.metric('frames', samples.length);
            return { ...s.value, occurrences: samples[0].poses, semantics: { ...s.value.semantics, collision: 'conservative-local-aabb' }, animation: { samples, interpolation: 'none', solver: m.value.solver, maxLinkError: m.value.metrics.maxLinkError }, collision: c.value };
        }
    });
}
/** Task construction is deliberately generic: iterate the authored definition list, never a building schema. */
export interface SceneImports {
    geometry(prefix: string, source: Task, definition: Definition): Task;
    motion(prefix: string, source: Task): Task;
}
export function scenePipeline(prefix: string, source: Task, program: SceneProgram, imports: SceneImports) {
    const layout = task(`${prefix}/layout`, 'scene.project-layout', { source }), bindings = task(`${prefix}/material-bindings`, 'scene.project-bindings', { source }), appearance = task(`${prefix}/appearance`, 'scene.project-appearance', { source }), policy = task(`${prefix}/policy`, 'scene.project-policy', { source });
    const meshes = Object.fromEntries(program.definitions.map(d => {
        const path = `${prefix}/definitions/${encodeURIComponent(d.id)}`;
        if (d.shape.kind === 'cad') {
            return [d.id, imports.geometry(path, source, d)];
        }
        const spec = task(`${path}/spec`, 'scene.project-shape', { source, id: d.id });
        return [d.id, task(`${path}/mesh`, 'scene.tessellate-primitive', { spec })];
    }));
    const candidates = program.policy.divisors.map(divisor => {
        const reduced = Object.fromEntries(Object.entries(meshes).map(([id, mesh]) => [id, task(`${prefix}/lod/${divisor}/${encodeURIComponent(id)}`, 'scene.reduce-rings', { mesh, divisor })]));
        return task(`${prefix}/candidate/${divisor}`, 'scene.build-candidate', { reduced, layout, bindings, divisor });
    });
    const selected = task(`${prefix}/selected`, 'scene.choose-candidate', { policy, candidates }), pack = task(`${prefix}/package`, 'scene.package', { selected, layout, appearance });
    if (!program.motion)
        return { root: pack, pack, meshes, candidates, selected };
    const motion = imports.motion(`${prefix}/motion`, source), attachments = task(`${prefix}/attachments`, 'scene.project-attachments', { source }), collision = task(`${prefix}/colliders`, 'scene.collision-boxes', { scene: pack });
    const root = task(`${prefix}/animation`, 'scene.attach-motion', { scene: pack, motion, attachments, collision });
    return { root, pack, meshes, candidates, selected, motion };
}
