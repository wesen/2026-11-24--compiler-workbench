import { assert, finite, positive, task, type Registry, type Task } from '../core/types.js';
import type { Program } from '../languages/program.js';
import type { MechanismProgram, MotionPolicy } from '../languages/mechanism.js';
import type { PlanarAssembly } from '../assembly/planar.js';
import { validateFourBarGraph, validateMotion, lowerFourBar, sampleFourBar, MechanismError, type FourBarGraph, type MotionIR, type MotionSettings } from '../math/four-bar.js';
import type { NumericTape, ResidualProgram } from '../math/expressions.js';
import { selectByMetrics } from '../core/strategies.js';
import { registerAssemblyPhysicsAdapter } from '../adapters/assembly-physics.js';
function mech(v: Program): MechanismProgram {
    assert(v.kind === 'mechanism', 'Expected mechanism');
    return v;
}
function validateSettings(v: unknown): asserts v is MotionSettings {
    const s = v as MotionSettings;
    assert(s && Number.isInteger(s.sampleCount) && s.sampleCount >= 2 && s.sampleCount <= 360, 'Invalid samples');
    positive(s.duration, 'duration');
    finite(s.thetaStart, 'start');
    finite(s.thetaEnd, 'end');
    positive(s.tolerance, 'tolerance');
    finite(s.initial.bx, 'bx');
    finite(s.initial.by, 'by');
    assert(Number.isInteger(s.maxIterations) && s.maxIterations > 0 && s.maxIterations <= 300, 'Invalid iteration count');
}
function validatePolicy(v: unknown): asserts v is MotionPolicy {
    const p = v as MotionPolicy;
    assert(p && ['work', 'accuracy'].includes(p.objective), 'Invalid motion objective');
    positive(p.maxError, 'max error');
}
export function registerMechanismPipeline(reg: Registry) {
    reg.registerKind<FourBarGraph>({ id: 'physics.constraint-graph', version: '1', description: 'Recognized planar four-body constraint graph', validate: validateFourBarGraph, structure: g => g.joints.map(j => ({ from: j.bodies[0], to: j.bodies[1], relation: j.id })) });
    reg.registerKind<MotionIR>({ id: 'physics.motion', version: '1', description: 'Verified discrete planar motion with numerical evidence', validate: validateMotion });
    reg.registerKind<MotionSettings>({ id: 'physics.settings', version: '1', description: 'Sampling and solver settings', validate: validateSettings });
    reg.registerKind<MotionPolicy>({ id: 'physics.policy', version: '1', description: 'Solver selection objective and error budget', validate: validatePolicy });
    registerAssemblyPhysicsAdapter(reg);
    reg.register<{
        source: Task;
    }, PlanarAssembly>({
        id: 'physics.project-assembly', version: '1', kind: 'assembly.planar', description: 'Extract authored bodies, ports, joints and driver', async run(ctx, { source }) {
            const p = await ctx.require<Program>(source);
            const a = mech(p.value).assembly;
            for (const b of a.bodies)
                ctx.derive(p, { from: [b.id], to: [b.id], relation: 'body' });
            for (const j of a.joints)
                ctx.derive(p, { from: [j.id], to: [j.id], relation: 'joint' });
            return a;
        }
    });
    reg.register<{
        source: Task;
        solver: 'numeric' | 'closed-form';
    }, MotionSettings>({
        id: 'physics.project-settings', version: '1', kind: 'physics.settings', description: 'Read solver settings, omitting numerical seed and iterations for the closed-form backend', async run(ctx, { source, solver }) {
            const p = await ctx.require<Program>(source);
            ctx.derive(p, { from: ['settings'], relation: 'project-settings' });
            const s = mech(p.value).settings;
            return solver === 'numeric' ? s : { ...s, initial: { bx: 0, by: 0 }, maxIterations: 1 };
        }
    });
    reg.register<{
        source: Task;
    }, MotionPolicy>({
        id: 'physics.project-policy', version: '1', kind: 'physics.policy', description: 'Separate optimization policy from candidate evaluation', async run(ctx, { source }) {
            const p = await ctx.require<Program>(source);
            ctx.derive(p, { from: ['policy'], relation: 'project-policy' });
            return mech(p.value).policy;
        }
    });
    reg.register<{
        graph: Task;
    }, ResidualProgram>({
        id: 'physics.lower-constraints', version: '1', kind: 'math.residual-program', description: 'Lower loop closure to a two-variable residual program', async run(ctx, { graph }) {
            const g = await ctx.require<FourBarGraph>(graph);
            const r = lowerFourBar(g.value);
            ctx.derive(g, { from: ['crank-coupler', 'coupler-rocker'], to: r.residuals.map(r => r.id), relation: 'constraint-lowering' });
            return r;
        }
    });
    reg.register<{
        graph: Task;
        tape: Task;
        settings: Task;
        solver: 'numeric' | 'closed-form';
    }, MotionIR>({
        id: 'physics.sample-motion', version: '1', kind: 'physics.motion', description: 'Run numerical or closed-form solver and verify every sampled pose against the same tape', async run(ctx, p) {
            const g = await ctx.require<FourBarGraph>(p.graph), t = await ctx.require<NumericTape>(p.tape), s = await ctx.require<MotionSettings>(p.settings);
            try {
                const m = sampleFourBar(g.value, t.value, s.value, p.solver, (label, data) => ctx.checkpoint(label, data));
                ctx.derive(g, { relation: 'sample-motion' });
                ctx.derive(t, { relation: 'verify-residuals' });
                for (const [k, v] of Object.entries(m.metrics))
                    ctx.metric(k, v);
                return m;
            }
            catch (e) {
                if (e instanceof MechanismError)
                    ctx.diagnostic({ severity: 'error', code: e.code, message: e.message, data: e.data });
                throw e;
            }
        }
    });
    reg.register<{
        candidates: Task[];
        policy: Task;
        selected?: Task;
        strategySelection?: unknown;
    }, MotionIR>({
        id: 'physics.choose-motion', version: '2', kind: 'physics.motion', role: 'strategy', description: 'Choose a verified motion by explicit objective and error bound', async run(ctx, { candidates, policy, selected, strategySelection }) {
            const p = await ctx.require<MotionPolicy>(policy), a = await Promise.all(candidates.map(t => ctx.require<MotionIR>(t)));
            if (selected) {
                assert(candidates.some(t => t.id === selected.id), 'Strategy selection must reference an evaluated motion');
                const winner = await ctx.require<MotionIR>(selected);
                assert(winner.value.metrics.maxLinkError <= p.value.maxError, 'Strategy selected a motion outside the error budget');
                ctx.derive(winner, { relation: 'selected-by-strategy-ir' });
                ctx.decision({ code: 'strategy.choice-materialized', message: `Materialized Strategy IR choice ${winner.value.solver}`, evidence: { selectedTask: selected.id, authoredObjective: p.value.objective, maxError: p.value.maxError, ...(strategySelection ? { strategySelection } : {}) }, alternatives: a.map(x => ({ name: x.value.solver, accepted: x.id === winner.id, metrics: { ...x.value.metrics }, reason: x.id === winner.id ? 'Selected by the recorded Strategy IR chooseBest node' : x.value.metrics.maxLinkError > p.value.maxError ? 'Outside the error budget' : 'Feasible alternative retained in Strategy IR evidence' })) });
                return winner.value;
            }
            return selectByMetrics(ctx, a.map(a => ({ name: a.value.solver, artifact: a, metrics: { ...a.value.metrics } })), { metric: p.value.objective === 'work' ? 'residualEvaluations' : 'maxLinkError', direction: 'min' }, [{ metric: 'maxLinkError', op: '<=', value: p.value.maxError }]).artifact.value;
        }
    });
}
export function mechanismPipeline(prefix: string, source: Task) {
    const assembly = task(`${prefix}/assembly`, 'physics.project-assembly', { source }), graph = task(`${prefix}/constraint-graph`, 'assembly.four-bar', { assembly }), residual = task(`${prefix}/residuals`, 'physics.lower-constraints', { graph }), tape = task(`${prefix}/tape`, 'math.compile-tape', { program: residual });
    const candidates = (['numeric', 'closed-form'] as const).map(solver => {
        const settings = task(`${prefix}/settings/${solver}`, 'physics.project-settings', { source, solver });
        return task(`${prefix}/motion/${solver}`, 'physics.sample-motion', { graph, tape, settings, solver });
    });
    const policy = task(`${prefix}/policy`, 'physics.project-policy', { source });
    return { assembly, graph, residual, tape, motion: task(`${prefix}/selected-motion`, 'physics.choose-motion', { candidates, policy }) };
}
