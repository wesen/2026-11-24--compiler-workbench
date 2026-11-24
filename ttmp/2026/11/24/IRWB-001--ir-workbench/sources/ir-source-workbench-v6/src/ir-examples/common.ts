import { assert } from '../core/types.js';
import { canonical } from '../core/data.js';
import type { IREntity, IRGraph, IRRelation, RelationCategory } from '../ir/types.js';
export function object(value: unknown, label: string): asserts value is Record<string, unknown> {
    assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
}
export function text(value: unknown, label: string): asserts value is string {
    assert(typeof value === 'string' && value.trim().length > 0, `${label} must be nonempty text`);
}
export function number(value: unknown, label: string): asserts value is number {
    assert(typeof value === 'number' && Number.isFinite(value), `${label} must be finite`);
}
export function array(value: unknown, label: string): asserts value is unknown[] {
    assert(Array.isArray(value), `${label} must be an array`);
}
export function unique(ids: readonly string[], label: string): void {
    assert(new Set(ids).size === ids.length, `${label} must be unique`);
}
export function fields(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
    assert(Object.keys(value).every(k => allowed.includes(k)), `${label} has unknown fields`);
}
export const entity = (id: string, kind: string, attributes: Record<string, unknown> = {}): IREntity => ({
    id, kind, attributes
});
export function edge(kind: string, category: RelationCategory, from: string, to: string, order?: number, attributes?: Record<string, unknown>): IRRelation {
    return {
        id: relationId(kind, from, to, order), kind, category, from, to, ...(order === undefined ? {} : { order }), ...(attributes === undefined ? {} : { attributes })
    };
}
export const relationId = (kind: string, from: string, to: string, order?: number): string => `${kind}:${JSON.stringify(kind === 'contains' || kind === 'term' ? [from, to] : order === undefined ? [from] : [from, order])}`;
export function ordered(graph: IRGraph, from: string, kind: string): IRRelation[] {
    const rows = graph.relations.filter(r => r.from === from && r.kind === kind).sort((a, b) => (a.order ?? -1) - (b.order ?? -1));
    assert(rows.every((r, i) => r.order === i), `${kind} order on ${from} must be contiguous from zero`);
    return rows;
}
export function root(graph: IRGraph, id: string, kind: string): IREntity {
    const e = graph.entities.find(e => e.id === id);
    assert(e?.kind === kind, `Missing stable ${kind} root ${id}`);
    assert(graph.roots.length === 1 && graph.roots[0] === id, 'The domain root cannot be removed or replaced');
    return e;
}
export function closedGraph(graph: IRGraph, kinds: readonly string[], relations: readonly string[]): void {
    assert(graph.entities.every(e => kinds.includes(e.kind)), 'Unknown domain entity kind');
    assert(graph.relations.every(r => relations.includes(r.kind)), 'Unknown domain relationship');
}
export function same(a: unknown, b: unknown): boolean {
    return canonical(a) === canonical(b);
}
export function jsonDeserialize<T>(text: string, validate: (value: unknown) => void): T {
    const value = JSON.parse(text);
    validate(value);
    return value as T;
}
