/** Stateless domain checks reused by semantic contracts. No compiler or scheduler dependency. */
import { assert, type Artifact } from '../core/types.js';
import { canonical, fingerprint } from '../core/data.js';
import { meshMetrics, validateMesh, cylinderMesh, type Mesh } from '../geometry/mesh.js';
import { validateMotion, type MotionIR } from '../math/four-bar.js';
import type { ScenePackage, SceneLayout, MeshSet } from '../scene/schema.js';
import type { Correspondence, CheckResult } from '../contracts/types.js';
export function meshOf(value: unknown): Mesh {
    const v = value as Mesh | {
        mesh: Mesh;
    };
    const m = 'mesh' in v ? v.mesh : v;
    validateMesh(m);
    return m;
}
export function surfaceSignature(mesh: Mesh): string {
    validateMesh(mesh);
    return fingerprint(mesh.triangles.map((t, i) => ({
        face: mesh.faceIds[i], points: t.map(v => mesh.positions[v])
    })));
}
export function faceFamilies(mesh: Mesh): string[] {
    return [...new Set(mesh.faceIds.map(id => id.replace(/\/side:\d+$/, '/side')))].sort();
}
export function orientedSurface(mesh: Mesh) {
    return {
        signature: surfaceSignature(mesh), triangles: mesh.triangles.length, faceFamilies: faceFamilies(mesh), volume: meshMetrics(mesh).volume
    };
}
export function meshTopology(mesh: Mesh) {
    return meshMetrics(mesh);
}
export function namedSurfaces(mesh: Mesh): CheckResult {
    return {
        ok: mesh.faceIds.length === mesh.triangles.length && mesh.faceIds.every(id => id.length > 0), reason: 'Every triangle carries a nonempty semantic surface label', evidence: { families: faceFamilies(mesh) }
    };
}
export function meshCorrespondence(from: Artifact<Mesh>, to: Artifact<Mesh>, id = 'mesh-correspondence'): Correspondence {
    const before = from.value, after = to.value;
    const entities: NonNullable<Correspondence['entities']>[number][] = [];
    const oldByPoint = new Map<string, string[]>();
    before.positions.forEach((p, i) => {
        const key = canonical(p), list = oldByPoint.get(key) ?? [];
        list.push(`vertex:${i}`);
        oldByPoint.set(key, list);
    });
    const covered = new Set<string>();
    after.positions.forEach((p, i) => {
        const sources = oldByPoint.get(canonical(p)) ?? [];
        sources.forEach(s => covered.add(s));
        entities.push({
            from: sources, to: [`vertex:${i}`]
        });
    });
    before.positions.forEach((_, i) => {
        const source = `vertex:${i}`;
        if (!covered.has(source))
            entities.push({
                from: [source], to: []
            });
    });
    const oldFaces = [...new Set(before.faceIds)], newFaces = [...new Set(after.faceIds)];
    for (const target of newFaces) {
        let sources = oldFaces.filter(source => source === target);
        const match = /^(.*)\/side:(\d+)$/.exec(target), oldSegments = before.metadata?.segments, newSegments = after.metadata?.segments;
        if (match && before.metadata?.primitive === 'cylinder' && after.metadata?.primitive === 'cylinder' && Number.isInteger(oldSegments) && Number.isInteger(newSegments) && oldSegments! % newSegments! === 0) {
            const ratio = oldSegments! / newSegments!, start = Number(match[2]) * ratio;
            sources = Array.from({ length: ratio }, (_, i) => `${match[1]}/side:${start + i}`).filter(id => oldFaces.includes(id));
        }
        entities.push({
            from: sources.map(s => `face:${s}`), to: [`face:${target}`]
        });
    }
    return {
        id, from: {
            artifact: from.id, revision: from.revision
        }, to: {
            artifact: to.id, revision: to.revision
        }, relation: 'mesh-entities', entities, evidence: {
            sourceVertices: before.positions.length, targetVertices: after.positions.length, orientedSurfaceEqual: surfaceSignature(before) === surfaceSignature(after), sourceFamilies: faceFamilies(before), targetFamilies: faceFamilies(after)
        }
    };
}
export function checkMeshCorrespondence(from: Artifact<Mesh>, to: Artifact<Mesh>, correspondence: Correspondence): CheckResult {
    const before = from.value, after = to.value;
    const endpoint = (mesh: Mesh, id: string) => id.startsWith('vertex:') ? Number.isInteger(Number(id.slice(7))) && Number(id.slice(7)) >= 0 && Number(id.slice(7)) < mesh.positions.length : id.startsWith('face:') && mesh.faceIds.includes(id.slice(5));
    let valid = correspondence.from.artifact === from.id && correspondence.from.revision === from.revision && correspondence.to.artifact === to.id && correspondence.to.revision === to.revision;
    const targets = new Set<string>();
    for (const pair of correspondence.entities ?? []) {
        valid = valid && pair.from.every(s => endpoint(before, s)) && pair.to.every(t => endpoint(after, t));
        for (const target of pair.to) {
            targets.add(target);
            if (target.startsWith('vertex:'))
                valid = valid && pair.from.length > 0 && pair.from.every(source => source.startsWith('vertex:') && canonical(before.positions[Number(source.slice(7))]) === canonical(after.positions[Number(target.slice(7))]));
            if (target.startsWith('face:')) {
                const family = target.slice(5).replace(/\/side:\d+$/, '/side');
                valid = valid && pair.from.length > 0 && pair.from.every(source => source.startsWith('face:') && source.slice(5).replace(/\/side:\d+$/, '/side') === family);
            }
        }
    }
    valid = valid && after.positions.every((_, i) => targets.has(`vertex:${i}`)) && after.faceIds.every(id => targets.has(`face:${id}`));
    return {
        ok: valid, reason: valid ? 'Correspondence endpoints, target coverage and vertex coordinates checked' : 'Invalid correspondence endpoint, missing coverage, or changed vertex position', evidence: {
            pairs: correspondence.entities?.length ?? 0, coveredTargets: targets.size
        }
    };
}
export function reductionBound(before: Mesh, output: {
    mesh: Mesh;
    errorBound: number;
    sourceErrorBound: number;
}, divisor: number): CheckResult {
    const after = output.mesh, info = before.metadata;
    if (canonical(before) === canonical(after)) {
        const supplied = typeof info?.approximationBound === 'number' ? info.approximationBound : null;
        const cylinderBound = info?.primitive === 'cylinder' && typeof info.radius === 'number' && typeof info.segments === 'number' ? info.radius * (1 - Math.cos(Math.PI / info.segments)) : 0;
        let canonicalCylinder = true;
        if (info?.primitive === 'cylinder') {
            if (typeof info.radius !== 'number' || typeof info.height !== 'number' || !Number.isInteger(info.segments) || typeof info.name !== 'string')
                canonicalCylinder = false;
            else {
                const expected = cylinderMesh(info.radius, info.height, info.segments, info.name), epsilon = Math.max(info.radius, info.height) * Number.EPSILON * 64;
                canonicalCylinder = before.positions.length === expected.positions.length && before.positions.every((p, i) => p.every((x, j) => Math.abs(x - expected.positions[i][j]) <= epsilon)) && canonical(before.triangles) === canonical(expected.triangles) && canonical(before.faceIds) === canonical(expected.faceIds);
            }
        }
        const requiredSource = supplied ?? cylinderBound;
        const ok = canonicalCylinder && requiredSource >= 0 && output.errorBound === 0 && output.sourceErrorBound + Number.EPSILON >= requiredSource;
        return {
            ok, reason: ok ? 'Exact retained geometry has zero reduction error and retains the conservative source bound' : 'Retained geometry discarded or falsified its source approximation bound', evidence: {
                declared: output.errorBound, required: 0, requiredSource, declaredSource: output.sourceErrorBound, canonicalCylinder
            }
        };
    }
    if (info?.primitive !== 'cylinder' || !Number.isInteger(info.segments) || typeof info.radius !== 'number' || typeof info.height !== 'number' || typeof info.name !== 'string')
        return {
            ok: false, reason: 'Changed geometry has no supported analytic ring-bound witness'
        };
    const n = info.segments!, m = n / divisor, r = info.radius, h = info.height;
    if (!Number.isInteger(divisor) || divisor < 1 || !Number.isInteger(m) || m < 6)
        return {
            ok: false, reason: 'Invalid ring ratio'
        };
    const expectedSource = cylinderMesh(r, h, n, info.name), expectedTarget = cylinderMesh(r, h, m, info.name), tolerance = Math.max(r, h) * Number.EPSILON * 64;
    const coordinates = (a: Mesh, b: Mesh) => a.positions.length === b.positions.length && a.positions.every((p, i) => p.every((x, j) => Math.abs(x - b.positions[i][j]) <= tolerance));
    const topology = (a: Mesh, b: Mesh) => canonical(a.triangles) === canonical(b.triangles) && canonical(a.faceIds) === canonical(b.faceIds);
    const required = divisor === 1 ? 0 : r * (1 - Math.cos(Math.PI / m)) + 2 * Math.sqrt(3) * tolerance;
    const sourceRequired = r * (1 - Math.cos(Math.PI / n));
    const ok = coordinates(before, expectedSource) && topology(before, expectedSource) && coordinates(after, expectedTarget) && topology(after, expectedTarget) && output.errorBound + Number.EPSILON >= required && output.sourceErrorBound + Number.EPSILON >= sourceRequired;
    return {
        ok, reason: ok ? 'Canonical ring geometry and conservative analytic deviation bound verified' : 'Reduction geometry or its claimed deviation bound is invalid', evidence: {
            sourceSegments: n, targetSegments: m, required, declared: output.errorBound, sourceRequired, sourceDeclared: output.sourceErrorBound
        }
    };
}
export function motionMeasurements(motion: MotionIR) {
    validateMotion(motion);
    let maxLinkError = 0, maxResidual = 0, maxAnchorError = 0, maxPoseError = 0, maxReportedError = 0;
    let correctBranch = true, completeBodyPoses = true;
    const angleError = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    for (const sample of motion.samples) {
        const a = sample.points.crank, b = sample.points.coupler, d = sample.points.groundRight, o = sample.points.groundLeft, L = motion.lengths;
        const coupler = Math.hypot(b[0] - a[0], b[1] - a[1]), rocker = Math.hypot(b[0] - d[0], b[1] - d[1]);
        const linkError = Math.max(Math.abs(coupler - L.coupler), Math.abs(rocker - L.rocker));
        maxLinkError = Math.max(maxLinkError, linkError);
        const r1 = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 - L.coupler ** 2) / (2 * L.coupler), r2 = ((b[0] - d[0]) ** 2 + (b[1] - d[1]) ** 2 - L.rocker ** 2) / (2 * L.rocker), residual = Math.hypot(r1, r2);
        maxResidual = Math.max(maxResidual, residual);
        maxReportedError = Math.max(maxReportedError, Math.abs(linkError - sample.linkError), Math.abs(residual - sample.residualNorm));
        maxAnchorError = Math.max(maxAnchorError, Math.hypot(...o), Math.hypot(d[0] - L.ground, d[1]), Math.hypot(a[0] - L.crank * Math.cos(sample.angle), a[1] - L.crank * Math.sin(sample.angle)));
        correctBranch = correctBranch && Math.sign((d[0] - a[0]) * (b[1] - a[1]) - (d[1] - a[1]) * (b[0] - a[0])) === motion.branch;
        const expected = [{
                id: 'ground', translation: [0, 0, 0], angle: 0
            }, {
                id: 'crank', translation: [0, 0, 0], angle: sample.angle
            }, {
                id: 'coupler', translation: [a[0], a[1], 0], angle: Math.atan2(b[1] - a[1], b[0] - a[0])
            }, {
                id: 'rocker', translation: [d[0], d[1], 0], angle: Math.atan2(b[1] - d[1], b[0] - d[0])
            }];
        completeBodyPoses = completeBodyPoses && new Set(sample.bodyPoses.map(p => p.id)).size === 4;
        for (const pose of expected) {
            const actual = sample.bodyPoses.find(p => p.id === pose.id);
            if (!actual) {
                completeBodyPoses = false;
                continue;
            }
            maxPoseError = Math.max(maxPoseError, Math.hypot(...actual.translation.map((x, i) => x - pose.translation[i])), angleError(actual.angle, pose.angle));
        }
    }
    return {
        maxLinkError, maxResidual, maxAnchorError, maxPoseError, maxReportedError, correctBranch, completeBodyPoses, sampleCount: motion.samples.length, reportedLinkError: motion.metrics.maxLinkError, reportedResidual: motion.metrics.maxResidual
    };
}
export function sceneMeasurements(scene: ScenePackage) {
    const definitions = new Map(scene.definitions.map(d => [d.id, d]));
    const missingReferences = scene.occurrences.filter(o => !definitions.has(o.definition)).map(o => o.id);
    const missingMaterials = scene.definitions.filter(d => !Object.hasOwn(scene.materials, d.materialSlot)).map(d => d.id);
    const renderedTriangles = scene.occurrences.reduce((n, o) => n + (definitions.get(o.definition)?.mesh.triangles.length ?? 0), 0);
    return {
        definitions: scene.definitions.length, instances: scene.occurrences.length, renderedTriangles, reportedTriangles: scene.metrics.renderedTriangles, uniqueDefinitions: definitions.size, uniqueInstances: new Set(scene.occurrences.map(o => o.id)).size, missingReferences, missingMaterials, watertight: scene.definitions.every(d => meshMetrics(d.mesh).watertight)
    };
}
export function sceneConsistency(scene: ScenePackage): CheckResult {
    const m = sceneMeasurements(scene);
    return {
        ok: m.missingReferences.length === 0 && m.missingMaterials.length === 0 && m.uniqueDefinitions === m.definitions && m.uniqueInstances === m.instances && m.renderedTriangles === m.reportedTriangles && m.watertight, reason: 'Unique definitions and instances, resolved material/geometry references, watertight meshes and independent triangle count', evidence: m
    };
}
