import { canonical, immutable } from '../core/data.js';
import type { CorrespondenceEntry, EntityCorrespondence, EntityTrace, IRRef, RevisionRef, TraceStep } from './types.js';
import { compareText, IRError, IRBudgetError, limit, refKey, requireText, sameRevision } from './common.js';
function revision(value: RevisionRef): void {
    requireText(value.artifact, 'Correspondence artifact');
    requireText(value.revision, 'Correspondence revision');
}
function unique(values: readonly string[], label: string): readonly string[] {
    if (!Array.isArray(values))
        throw new IRError('ir.correspondence', `${label} must be an array`);
    values.forEach(v => requireText(v, label));
    if (new Set(values).size !== values.length)
        throw new IRError('ir.correspondence', `Duplicate ${label}`);
    return [...values].sort(compareText);
}
export function validateCorrespondence(input: EntityCorrespondence): EntityCorrespondence {
    const c = immutable(input);
    if (c.formatVersion !== 1)
        throw new IRError('ir.correspondence', 'Unsupported correspondence format');
    revision(c.from);
    revision(c.to);
    const sourceEntities = unique(c.sourceEntities, 'source entity'), targetEntities = unique(c.targetEntities, 'target entity');
    const source = new Set(sourceEntities), target = new Set(targetEntities), seenSource = new Set<string>(), seenTarget = new Set<string>();
    if (!Array.isArray(c.entries))
        throw new IRError('ir.correspondence', 'Correspondence entries must be an array');
    const entries = new Map<string, CorrespondenceEntry>();
    for (const entry of c.entries) {
        requireText(entry.relation, 'Correspondence relation');
        const from = unique(entry.from, 'entry source'), to = unique(entry.to, 'entry target');
        if (!from.length && !to.length)
            throw new IRError('ir.correspondence', 'Empty-to-empty correspondence has no meaning');
        for (const id of from) {
            if (!source.has(id))
                throw new IRError('ir.correspondence', `Unknown source entity ${id}`);
            seenSource.add(id);
        }
        for (const id of to) {
            if (!target.has(id))
                throw new IRError('ir.correspondence', `Unknown target entity ${id}`);
            seenTarget.add(id);
        }
        const normalized = {
            from, to, relation: entry.relation
        };
        entries.set(canonical(normalized), normalized);
    }
    if (seenSource.size !== source.size || seenTarget.size !== target.size)
        throw new IRError('ir.correspondence', 'Correspondence must account for every source and target entity, including additions/removals');
    return immutable({
        formatVersion: 1, from: c.from, to: c.to, sourceEntities, targetEntities, entries: [...entries.values()].sort((a, b) => compareText(canonical(a), canonical(b)))
    });
}
export function makeCorrespondence(from: RevisionRef, to: RevisionRef, sourceEntities: readonly string[], targetEntities: readonly string[], explicit: readonly CorrespondenceEntry[] = []): EntityCorrespondence {
    const source = unique(sourceEntities, 'source entity'), target = unique(targetEntities, 'target entity');
    const targetSet = new Set(target), sourceSet = new Set(source);
    const entries: CorrespondenceEntry[] = immutable(explicit).map(e => ({ ...e }));
    const mappedSource = new Set(entries.flatMap(e => [...e.from])), mappedTarget = new Set(entries.flatMap(e => [...e.to]));
    for (const id of source) {
        if (mappedSource.has(id))
            continue;
        if (targetSet.has(id)) {
            entries.push({
                from: [id], to: [id], relation: 'retained'
            });
            mappedTarget.add(id);
        }
        else
            entries.push({
                from: [id], to: [], relation: 'removed'
            });
    }
    for (const id of target)
        if (!mappedTarget.has(id))
            entries.push({
                from: [], to: [id], relation: sourceSet.has(id) ? 'unmapped-origin' : 'inserted'
            });
    return validateCorrespondence({
        formatVersion: 1, from, to, sourceEntities: source, targetEntities: target, entries
    });
}
/** Relational composition. A grouped entry denotes its full Cartesian relation. */
export function composeCorrespondence(first: EntityCorrespondence, second: EntityCorrespondence, options: {
    maxPairs?: number;
} = {}): EntityCorrespondence {
    const a = validateCorrespondence(first), b = validateCorrespondence(second);
    if (!sameRevision(a.to, b.from) || canonical(a.targetEntities) !== canonical(b.sourceEntities))
        throw new IRError('ir.correspondence-chain', 'Correspondences do not share the exact intermediate revision and entity universe');
    const maxPairs = limit(options.maxPairs, 100000, 'maxPairs');
    let count = 0;
    const entries: CorrespondenceEntry[] = [];
    const append = (from: readonly string[], to: readonly string[], relation: string) => {
        if (++count > maxPairs)
            throw new IRBudgetError('correspondence pairs', maxPairs);
        if (from.length || to.length)
            entries.push({
                from, to, relation
            });
    };
    const byMiddle = new Map<string, CorrespondenceEntry[]>();
    for (const e of b.entries)
        for (const middle of e.from)
            byMiddle.set(middle, [...(byMiddle.get(middle) ?? []), e]);
    for (const e of a.entries) {
        if (!e.to.length) {
            append(e.from, [], e.relation);
            continue;
        }
        for (const middle of e.to)
            for (const next of byMiddle.get(middle) ?? []) {
                if (!e.from.length && !next.to.length)
                    continue; // Creation followed by deletion has no surviving endpoint.
                for (const from of e.from.length ? e.from : [undefined])
                    for (const to of next.to.length ? next.to : [undefined]) {
                        append(from === undefined ? [] : [from], to === undefined ? [] : [to], `${e.relation} > ${next.relation}`);
                    }
            }
    }
    // Target entities introduced by the second step have no antecedent in the first.
    for (const e of b.entries)
        if (!e.from.length)
            append([], e.to, e.relation);
    return validateCorrespondence({
        formatVersion: 1, from: a.from, to: b.to, sourceEntities: a.sourceEntities, targetEntities: b.targetEntities, entries
    });
}
/** Historical inverse relation, not an executable undo transformation. */
export function invertCorrespondence(input: EntityCorrespondence): EntityCorrespondence {
    const c = validateCorrespondence(input);
    return validateCorrespondence({
        formatVersion: 1, from: c.to, to: c.from, sourceEntities: c.targetEntities, targetEntities: c.sourceEntities, entries: c.entries.map(e => ({
            from: e.to, to: e.from, relation: `inverse(${e.relation})`
        }))
    });
}
export function traceEntity(start: IRRef, throughRevisions: readonly EntityCorrespondence[], options: {
    maxRefs?: number;
} = {}): EntityTrace {
    const origin = immutable(start);
    revision(origin);
    requireText(origin.entity, 'Trace entity');
    const chain = throughRevisions.map(validateCorrespondence), maxRefs = limit(options.maxRefs, 100000, 'maxRefs');
    let expected: RevisionRef = origin, current: readonly IRRef[] = [origin], count = 1;
    const steps: TraceStep[] = [];
    for (const relation of chain) {
        if (!sameRevision(expected, relation.from))
            throw new IRError('ir.correspondence-chain', 'Trace must follow an ordered, contiguous revision chain');
        for (const ref of current)
            if (!relation.sourceEntities.includes(ref.entity))
                throw new IRError('ir.correspondence', `Unknown traced entity ${ref.entity}`);
        const ids = new Set(current.map(r => r.entity)), entries = relation.entries.filter(e => e.from.some(id => ids.has(id)));
        const after = new Map<string, IRRef>(), removed = new Map<string, IRRef>();
        for (const entry of entries) {
            for (const target of entry.to) {
                const ref = {
                    ...relation.to, entity: target
                };
                after.set(refKey(ref), ref);
            }
            if (!entry.to.length)
                for (const source of entry.from)
                    if (ids.has(source)) {
                        const ref = {
                            ...relation.from, entity: source
                        };
                        removed.set(refKey(ref), ref);
                    }
        }
        count += after.size;
        if (count > maxRefs)
            throw new IRBudgetError('trace refs', maxRefs);
        const next = [...after.values()].sort((a, b) => compareText(a.entity, b.entity));
        steps.push({
            from: relation.from, to: relation.to, before: current, after: next, removed: [...removed.values()], entries
        });
        current = next;
        expected = relation.to;
    }
    return immutable({
        start: origin, steps, current
    });
}
