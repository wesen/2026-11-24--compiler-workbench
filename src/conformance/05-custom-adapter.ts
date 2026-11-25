/** A fifth tutorial: introduce a native representation without changing the engine. */
import { assert } from '../framework/core/types.js';
import { defineAdapter, createIRArtifact, openIR } from '../framework/ir/index.js';
import type { IREntity } from '../framework/ir/index.js';

interface SphereSet {
  spheres: Record<string, { radius: number }>;
}
function validateSpheres(value: unknown): asserts value is SphereSet {
  assert(!!value && typeof value === 'object', 'Expected a sphere catalog');
  const source = value as SphereSet;
  assert(Object.keys(source).length === 1 && 'spheres' in source, 'Only the spheres field is supported');
  assert(
    !!source.spheres && typeof source.spheres === 'object' && !Array.isArray(source.spheres),
    'Expected a keyed sphere table',
  );
  for (const [id, sphere] of Object.entries(source.spheres)) {
    assert(id.trim().length > 0, 'Sphere IDs must be nonempty');
    assert(
      !!sphere && typeof sphere === 'object' && Object.keys(sphere).length === 1 && 'radius' in sphere,
      'Each sphere contains only a radius',
    );
    assert(
      Number.isFinite(sphere.radius) && sphere.radius > 0,
      'A sphere radius must be finite and positive',
    );
  }
}
const entities = (value: SphereSet): IREntity[] =>
  Object.entries(value.spheres).map(([id, sphere]) => ({
    id,
    kind: 'guide.sphere',
    attributes: { radius: sphere.radius },
  }));

const sphereAdapter = defineAdapter<SphereSet>({
  id: 'guide.sphere-adapter',
  version: '1',
  kind: 'guide.sphere-set',
  schemaVersion: '1',
  description: 'A native keyed table of sphere radii',
  relationKinds: {},
  entities,
  resolve(value, id) {
    return entities(value).find(e => e.id === id);
  },
  relations() {
    return [];
  },
  describe(value, id) {
    return { label: id, detail: `Radius ${value.spheres[id].radius}` };
  },
  validate: validateSpheres,
  rebuild(_base, graph) {
    assert(graph.relations.length === 0, 'The catalog has no relationships');
    for (const entity of graph.entities) assert(entity.kind === 'guide.sphere', 'Expected a sphere entity');
    const candidate = {
      spheres: Object.fromEntries(
        graph.entities.map(entity => [entity.id, { radius: entity.attributes.radius as number }]),
      ),
    };
    validateSpheres(candidate);
    return candidate;
  },
});

const before = createIRArtifact(sphereAdapter, 'guide/spheres', {
  spheres: { wheel: { radius: 1 }, handle: { radius: 0.25 } },
});
const view = openIR(before, sphereAdapter);
const large = view.find(entity => (entity.attributes.radius as number) >= 1);
assert(large.length === 1 && large[0].entity === 'wheel', 'Radius query');
const edit = view.beginEdit();
edit.update('wheel', { radius: 2 });
const result = await edit.commit();
assert(before.value.spheres.wheel.radius === 1, 'Original remains immutable');
assert(result.artifact.value.spheres.wheel.radius === 2, 'Native reconstruction');
const next = view.at(result.artifact);
const invalid = next.beginEdit();
invalid.update('wheel', { radius: -1 });
let rejected = false;
try {
  await invalid.commit();
} catch (error) {
  rejected = /positive/.test(String(error));
}
assert(rejected, 'Invalid native radius must be rejected');
console.log(
  JSON.stringify(
    {
      nativeBefore: before.value,
      nativeAfter: result.artifact.value,
      matchingEntities: large.map(ref => ref.entity),
      changes: result.changes,
      capabilities: next.capabilities,
      invalidEditRejected: rejected,
    },
    null,
    2,
  ),
);
