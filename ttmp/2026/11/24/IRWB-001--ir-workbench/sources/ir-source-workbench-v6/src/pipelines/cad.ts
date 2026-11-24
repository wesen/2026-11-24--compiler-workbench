import { assert, positive, task, type Registry, type Task } from '../core/types.js';
import type { PartProgram, Feature, Rectangle } from '../languages/cad.js';
import { rectangleProgram, solveRectangle, sketchStructure, type ConstrainedSketch } from '../math/rectangle.js';
import type { ResidualProgram, NumericTape } from '../math/expressions.js';
import { analyticBracket, bracketMesh, bracketTessellationBound, validateBracketSolid, type BracketSolid } from '../geometry/bracket.js';
import { meshMetrics, type Mesh } from '../geometry/mesh.js';
import type { Program } from '../languages/program.js';
interface SketchSpec {
    id: string;
    profile: Rectangle;
}
interface SketchOptions {
    tolerance: number;
}
interface Tessellation {
    segments: number;
}
interface AuthoredFeatures {
    features: Feature[];
}
interface LoweredHistory {
    features: Feature[];
    profile: Rectangle;
    sketchId: string;
}
function obj(v: unknown): asserts v is Record<string, unknown> { assert(!!v && typeof v === 'object' && !Array.isArray(v), 'Expected a record'); }
function partOf(v: Program): PartProgram {
    assert(v.kind === 'part', 'Expected a CAD part');
    return v;
}
function validateSketchSpec(v: unknown): asserts v is SketchSpec {
    obj(v);
    assert(typeof v.id === 'string', 'Sketch ID missing');
    obj(v.profile);
    assert(v.profile.kind === 'rectangle', 'Unsupported profile');
    positive(v.profile.width, 'width');
    positive(v.profile.depth, 'depth');
}
function validateSketchOptions(v: unknown): asserts v is SketchOptions {
    obj(v);
    positive(v.tolerance, 'tolerance');
}
function validateTessellation(v: unknown): asserts v is Tessellation {
    obj(v);
    assert(typeof v.segments === 'number' && Number.isInteger(v.segments) && v.segments >= 8 && v.segments <= 256 && v.segments % 4 === 0, 'Invalid bracket tessellation');
}
function validateFeatures(v: unknown): asserts v is AuthoredFeatures {
    obj(v);
    assert(Array.isArray(v.features) && v.features.length > 0, 'Features missing');
}
function validateHistory(v: unknown): asserts v is LoweredHistory {
    validateFeatures(v);
    const h = v as LoweredHistory;
    validateSketchSpec({ id: h.sketchId, profile: h.profile });
}
function validateSketch(v: unknown): asserts v is ConstrainedSketch {
    obj(v);
    const s = v as unknown as ConstrainedSketch;
    assert(s.type === 'rectangle' && s.units === 'm' && s.points.length === 4 && s.solver.status === 'converged' && s.solver.rank === 8, 'Expected fully solved rectangle');
}
export function registerCADPipeline(reg: Registry) {
    reg.registerKind<SketchSpec>({ id: 'cad.sketch-spec', version: '1', description: 'Authored rectangular profile and stable sketch identity', validate: validateSketchSpec });
    reg.registerKind<SketchOptions>({ id: 'cad.solve-options', version: '1', description: 'Independent numerical solve options', validate: validateSketchOptions });
    reg.registerKind<Tessellation>({ id: 'cad.tessellation', version: '1', description: 'Mesh approximation settings', validate: validateTessellation });
    reg.registerKind<AuthoredFeatures>({ id: 'cad.feature-list', version: '1', description: 'Ordered authored feature operations and symbolic references', validate: validateFeatures, structure: h => h.features.slice(1).map((f, i) => ({ from: h.features[i].id, to: f.id, relation: 'then' })) });
    reg.registerKind<LoweredHistory>({ id: 'cad.elaborated-history', version: '1', description: 'Feature history paired with verified profile dimensions', validate: validateHistory, structure: h => h.features.map(f => ({ from: f.kind === 'extrude' ? f.sketch : f.kind === 'join-upright' ? f.base : f.target, to: f.id, relation: 'uses' })) });
    reg.registerKind<ConstrainedSketch>({ id: 'cad.sketch', version: '1', description: 'Numerical sketch solution with residual equations and DOF evidence', validate: validateSketch, structure: sketchStructure });
    reg.registerKind<BracketSolid>({ id: 'cad.solid', version: '1', description: 'Named analytic boundary for the supported L-bracket construction', validate: validateBracketSolid, structure: s => s.surfaces.map(f => ({ from: f.feature, to: f.id, relation: 'creates' })) });
    reg.register<{
        source: Task;
        id: string;
    }, SketchSpec>({
        id: 'cad.project-sketch', version: '1', kind: 'cad.sketch-spec', description: 'Project one named sketch from the user program', async run(ctx, { source, id }) {
            const p = await ctx.require<Program>(source);
            const s = partOf(p.value).sketches.find(s => s.id === id);
            assert(s, `Missing sketch ${id}`);
            ctx.derive(p, { from: [id], to: [id], relation: 'project-sketch' });
            return s;
        }
    });
    reg.register<{
        source: Task;
    }, SketchOptions>({
        id: 'cad.project-solver', version: '1', kind: 'cad.solve-options', description: 'Project solve options separately from geometric features', async run(ctx, { source }) {
            const p = await ctx.require<Program>(source);
            ctx.derive(p, { from: ['tolerance'], relation: 'project-options' });
            return { tolerance: partOf(p.value).tolerance };
        }
    });
    reg.register<{
        source: Task;
    }, Tessellation>({
        id: 'cad.project-tessellation', version: '1', kind: 'cad.tessellation', description: 'Project only tessellation settings', async run(ctx, { source }) {
            const p = await ctx.require<Program>(source);
            ctx.derive(p, { from: ['segments'], relation: 'project-options' });
            return { segments: partOf(p.value).segments };
        }
    });
    reg.register<{
        source: Task;
    }, AuthoredFeatures>({
        id: 'cad.project-features', version: '1', kind: 'cad.feature-list', description: 'Read the actual authored feature list; do not synthesize a bracket recipe', async run(ctx, { source }) {
            const p = await ctx.require<Program>(source);
            const features = partOf(p.value).features;
            for (const f of features)
                ctx.derive(p, { from: [f.id], to: [f.id], relation: 'project-feature' });
            return { features };
        }
    });
    reg.register<{
        sketch: Task;
    }, ResidualProgram>({
        id: 'cad.lower-sketch', version: '1', kind: 'math.residual-program', description: 'Lower a rectangular profile to eight scalar residual equations', async run(ctx, { sketch }) {
            const s = await ctx.require<SketchSpec>(sketch);
            const r = rectangleProgram(s.value.profile.width, s.value.profile.depth);
            ctx.derive(s, { from: [s.value.id], to: r.residuals.map(r => r.id), relation: 'elaborate-constraint' });
            return r;
        }
    });
    reg.register<{
        sketch: Task;
        options: Task;
        residual: Task;
        tape: Task;
    }, ConstrainedSketch>({
        id: 'cad.solve-profile', version: '1', kind: 'cad.sketch', description: 'Use the shared numeric tape and least-squares solver', async run(ctx, p) {
            const s = await ctx.require<SketchSpec>(p.sketch), o = await ctx.require<SketchOptions>(p.options), r = await ctx.require<ResidualProgram>(p.residual), t = await ctx.require<NumericTape>(p.tape);
            const solved = solveRectangle(s.value.profile.width, s.value.profile.depth, o.value.tolerance, r.value, t.value);
            ctx.derive(s, { from: [s.value.id], to: solved.points.map(x => x.id), relation: 'solve' });
            ctx.derive(t, { relation: 'evaluated-tape' });
            ctx.metric('residual', solved.solver.residualNorm);
            ctx.metric('rank', solved.solver.rank);
            for (const cp of solved.solver.checkpoints)
                ctx.checkpoint('nonlinear iteration', cp);
            return solved;
        }
    });
    reg.register<{
        features: Task;
        sketches: Record<string, Task>;
    }, LoweredHistory>({
        id: 'cad.elaborate-history', version: '1', kind: 'cad.elaborated-history', description: 'Resolve authored sketch references against numerical solutions', async run(ctx, { features, sketches }) {
            const f = await ctx.require<AuthoredFeatures>(features);
            const first = f.value.features[0];
            assert(first.kind === 'extrude', 'Supported history begins with extrusion');
            const st = sketches[first.sketch];
            assert(st, `Unresolved sketch ${first.sketch}`);
            const s = await ctx.require<ConstrainedSketch>(st);
            ctx.derive(f, { relation: 'elaborate-features' });
            ctx.derive(s, { from: s.value.points.map(p => p.id), to: [first.id], relation: 'extrusion-profile' });
            return { features: f.value.features, profile: { kind: 'rectangle', ...s.value.target }, sketchId: first.sketch };
        }
    });
    reg.register<{
        history: Task;
    }, BracketSolid>({
        id: 'cad.recognize-solid', version: '1', kind: 'cad.solid', description: 'Recognize the supported drilled L-bracket history and evaluate its analytic boundary', async run(ctx, { history }) {
            const a = await ctx.require<LoweredHistory>(history);
            const { features, profile } = a.value;
            const [base, back, holes] = features;
            assert(features.length === 3 && base.kind === 'extrude' && back.kind === 'join-upright' && holes.kind === 'drill-through', 'Backend supports exactly extrude → join-upright → drill-through');
            assert(back.base === base.id && holes.target === back.id && back.thickness === base.thickness, 'Unsupported feature references or unequal wall thickness');
            const solid = analyticBracket({ width: profile.width, depth: profile.depth, thickness: base.thickness, height: back.height, holeDiameter: holes.diameter });
            assert(holes.centers.length === 2 && holes.centers.every((p, i) => p.every((x, j) => Math.abs(x - solid.holeCenters[i][j]) <= 1e-12)), 'Backend supports two equal symmetric through-holes at the specified quarter positions');
            const ids = new Map([['base-extrusion', base.id], ['upright-union', back.id], ['mounting-holes', holes.id]]);
            for (const face of solid.surfaces) {
                face.feature = ids.get(face.feature)!;
                ctx.derive(a, { from: [face.feature], to: [face.id], relation: 'boundary-surface' });
            }
            solid.featureOrder = features.map(f => f.id);
            ctx.decision({ code: 'cad.recognition', message: 'Authored history matches the analytic drilled-bracket backend.', evidence: { featureOrder: solid.featureOrder, volume: solid.volume } });
            ctx.metric('analytic-volume', solid.volume, 'm³');
            return solid;
        }
    });
    reg.register<{
        solid: Task;
        options: Task;
    }, Mesh>({
        id: 'cad.mesh-boundary', version: '1', kind: 'geometry.mesh', description: 'Tessellate named solid with a conservative bore error bound', async run(ctx, { solid, options }) {
            const a = await ctx.require<BracketSolid>(solid), o = await ctx.require<Tessellation>(options);
            const m = bracketMesh(a.value, o.value.segments);
            const metrics = meshMetrics(m), bound = bracketTessellationBound(a.value, o.value.segments);
            assert(metrics.watertight, 'Mesh must be watertight');
            m.metadata = { ...m.metadata, approximationBound: bound };
            for (const face of a.value.surfaces)
                ctx.derive(a, { from: [face.id], to: [face.id], relation: 'tessellated-surface' });
            ctx.metric('triangles', m.triangles.length);
            ctx.metric('bore-error', bound, 'm');
            return m;
        }
    });
}
export function cadPipeline(prefix: string, source: Task, program: PartProgram) {
    const options = task(`${prefix}/solver-options`, 'cad.project-solver', { source }), tess = task(`${prefix}/tessellation`, 'cad.project-tessellation', { source });
    const sketches = Object.fromEntries(program.sketches.map(s => {
        const sketch = task(`${prefix}/sketch/${encodeURIComponent(s.id)}`, 'cad.project-sketch', { source, id: s.id });
        const residual = task(`${sketch.id}/equations`, 'cad.lower-sketch', { sketch });
        const tape = task(`${sketch.id}/tape`, 'math.compile-tape', { program: residual });
        return [s.id, task(`${sketch.id}/solved`, 'cad.solve-profile', { sketch, options, residual, tape })];
    }));
    const features = task(`${prefix}/features`, 'cad.project-features', { source }), history = task(`${prefix}/history`, 'cad.elaborate-history', { features, sketches }), solid = task(`${prefix}/solid`, 'cad.recognize-solid', { history }), mesh = task(`${prefix}/mesh`, 'cad.mesh-boundary', { solid, options: tess });
    return { source, history, solid, mesh, metrics: task(`${prefix}/metrics`, 'geometry.mesh-metrics', { mesh }) };
}
