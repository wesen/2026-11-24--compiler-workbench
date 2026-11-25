import { fingerprint, immutable } from '../core/data.js';
import type { ResourcePort, ResourceStamp, ResourceValue, ResourceWrite } from './types.js';
/** A versioned JSON resource adapter; all writes use atomic revision comparison. */
export class MemoryResources implements ResourcePort {
  private readonly values = new Map<string, ResourceValue>();
  constructor(initial: Readonly<Record<string, unknown>> = {}) {
    for (const [resource, value] of Object.entries(initial)) this.set(resource, value);
  }
  read(resource: string): ResourceValue | undefined {
    return this.values.get(resource);
  }
  set(resource: string, value: unknown): ResourceValue {
    if (!resource.trim()) throw new Error('Resource name required');
    const captured = immutable(value),
      entry = immutable({
        resource,
        value: captured,
        revision: fingerprint(captured),
      });
    this.values.set(resource, entry);
    return entry;
  }
  commit(writes: readonly ResourceWrite[], expected: readonly ResourceStamp[]): void {
    const pending = writes.map(w => {
      if (typeof w.resource !== 'string' || !w.resource.trim()) throw new Error('Resource name required');
      const value = immutable(w.value);
      return immutable({
        resource: w.resource,
        value,
        revision: fingerprint(value),
      });
    });
    for (const stamp of expected)
      if ((this.values.get(stamp.resource)?.revision ?? 'missing') !== stamp.revision)
        throw new Error(`Resource conflict: ${stamp.resource} changed before commit`);
    if (new Set(pending.map(w => w.resource)).size !== pending.length)
      throw new Error('Duplicate staged resource writes');
    for (const entry of pending) this.values.set(entry.resource, entry);
  }
  snapshot(): ResourceValue[] {
    return [...this.values.values()];
  }
}
