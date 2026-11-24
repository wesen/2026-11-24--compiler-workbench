import { canonical, immutable } from '../core/data.js';
import type { ChangeSet, EditOperation, EntityChange, IRGraph, IRRef, IRView, RelationChange, RevisionRef } from './types.js';
import { compareText, refKey, revisionRef } from './common.js';
export function diffGraphs(before: IRGraph, after: IRGraph, from: RevisionRef, to: RevisionRef, operations: readonly EditOperation[] = []): ChangeSet {
    const entities: EntityChange[] = [], relations: RelationChange[] = [];
    const oldEntities = new Map(before.entities.map(e => [e.id, e])), newEntities = new Map(after.entities.map(e => [e.id, e]));
    const oldRelations = new Map(before.relations.map(r => [r.id, r])), newRelations = new Map(after.relations.map(r => [r.id, r]));
    for (const id of [...new Set([...oldEntities.keys(), ...newEntities.keys()])].sort(compareText)) {
        const old = oldEntities.get(id), current = newEntities.get(id);
        if (!old)
            entities.push({
                entity: id, kind: 'inserted', after: current!
            });
        else if (!current)
            entities.push({
                entity: id, kind: 'removed', before: old
            });
        else if (canonical(old) !== canonical(current))
            entities.push({
                entity: id, kind: 'updated', before: old, after: current
            });
    }
    for (const id of [...new Set([...oldRelations.keys(), ...newRelations.keys()])].sort(compareText)) {
        const old = oldRelations.get(id), current = newRelations.get(id);
        if (!old)
            relations.push({
                relation: id, kind: 'inserted', after: current!
            });
        else if (!current)
            relations.push({
                relation: id, kind: 'removed', before: old
            });
        else if (canonical(old) !== canonical(current))
            relations.push({
                relation: id, kind: 'updated', before: old, after: current
            });
    }
    const rootsChanged = canonical(before.roots) !== canonical(after.roots);
    return immutable({
        from, to, entities, relations, ...(rootsChanged ? { roots: {
                before: before.roots, after: after.roots
            } } : {}), operations, changed: entities.length > 0 || relations.length > 0 || rootsChanged
    });
}
/** Diff logical projections, even across different adapters/representations. */
export function diff(before: IRView<any>, after: IRView<any>): ChangeSet {
    return diffGraphs(before.graph(), after.graph(), revisionRef(before.artifact), revisionRef(after.artifact));
}
export function affectedEntities(changes: ChangeSet): readonly IRRef[] {
    const refs = new Map<string, IRRef>();
    function add(revision: RevisionRef, entity: string): void {
        const ref = {
            ...revision, entity
        };
        refs.set(refKey(ref), ref);
    }
    for (const change of changes.entities) {
        if (change.before)
            add(changes.from, change.entity);
        if (change.after)
            add(changes.to, change.entity);
    }
    for (const change of changes.relations) {
        if (change.before) {
            add(changes.from, change.before.from);
            add(changes.from, change.before.to);
        }
        if (change.after) {
            add(changes.to, change.after.from);
            add(changes.to, change.after.to);
        }
    }
    for (const id of changes.roots?.before ?? [])
        add(changes.from, id);
    for (const id of changes.roots?.after ?? [])
        add(changes.to, id);
    return immutable([...refs.values()].sort((a, b) => compareText(refKey(a), refKey(b))));
}
