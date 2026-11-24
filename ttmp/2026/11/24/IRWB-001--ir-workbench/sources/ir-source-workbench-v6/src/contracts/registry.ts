import type { AnyDefinition, DefinitionDescriptor, VersionRef, Ports } from './types.js';
import { describeDefinition } from './definitions.js';
export class ContractRegistry {
    private readonly definitions = new Map<string, AnyDefinition>();
    register<T extends AnyDefinition>(definition: T): T {
        const key = this.key(definition), existing = this.definitions.get(key);
        if (existing) {
            if (existing !== definition)
                throw new Error(`Definition ${definition.id}@${definition.version} cannot be redefined`);
            return definition;
        }
        this.definitions.set(key, definition);
        try {
            for (const dependency of this.dependencies(definition))
                this.register(dependency);
        }
        catch (error) {
            this.definitions.delete(key);
            throw error;
        }
        return definition;
    }
    get<T extends AnyDefinition = AnyDefinition>(ref: VersionRef, category?: T['category']): T {
        const d = this.definitions.get(this.key(ref));
        if (!d)
            throw new Error(`Definition ${ref.id}@${ref.version} is not registered`);
        if (category && d.category !== category)
            throw new Error(`Expected ${category}, got ${d.category} for ${ref.id}`);
        return d as T;
    }
    has(ref: VersionRef, category?: AnyDefinition['category']): boolean {
        try {
            this.get(ref, category);
            return true;
        }
        catch {
            return false;
        }
    }
    list(): DefinitionDescriptor[] {
        return [...this.definitions.values()].map(describeDefinition).sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));
    }
    private key(ref: VersionRef) {
        return JSON.stringify([ref.id, ref.version]);
    }
    private dependencies(d: AnyDefinition): AnyDefinition[] {
        switch (d.category) {
            case 'type':
            case 'ir': return [];
            case 'effect': return [d.type];
            case 'analysis': return [d.input, d.output, ...d.effects];
            case 'property': return [d.subject, d.check, ...(d.proofVerifier ? [d.proofVerifier] : [])];
            case 'objective': return [d.analysis];
            case 'invariant': return [...Object.values(d.inputs as Ports), ...d.effects];
            case 'transformation': return [...Object.values(d.inputs as Ports), ...Object.values(d.outputs as Ports), ...d.effects, ...[...d.requires, ...d.ensures, ...d.establishes].map(c => 'property' in c ? c.property : c.invariant), ...d.preserves.map(p => p.property)];
        }
    }
}
