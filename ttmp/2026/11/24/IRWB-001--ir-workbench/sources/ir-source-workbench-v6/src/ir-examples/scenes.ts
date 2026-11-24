/** Native scene storage has separate definition and instance tables. */
import { assert } from '../core/types.js';
import { canonical } from '../core/data.js';
import { defineIR } from '../contracts/index.js';
import { defineAdapter } from '../ir/index.js';
import type { IRGraph } from '../ir/types.js';
import { array, closedGraph, edge, entity, fields, jsonDeserialize, number, object, root, text, unique } from './common.js';
export type Vec3 = [
    number,
    number,
    number
];
export interface SceneDefinition {
    key: string;
    shape: 'box';
    size: Vec3;
}
export interface SceneObject {
    name: string;
    asset: string;
    position: Vec3;
}
export interface NativeScene {
    assets: SceneDefinition[];
    objects: SceneObject[];
}
export const SCENE_ROOT = '$scene';
function vector(v: unknown, label: string): asserts v is Vec3 {
    array(v, label);
    assert(v.length === 3, `${label} needs three coordinates`);
    v.forEach(x => number(x, label));
}
export function validateScene(v: unknown): asserts v is NativeScene {
    object(v, 'Scene');
    fields(v, ['assets', 'objects'], 'Scene');
    array(v.assets, 'Definitions');
    array(v.objects, 'Instances');
    assert(v.assets.length > 0 && v.assets.length <= 10000 && v.objects.length <= 10000, 'Scene table budget exceeded');
    const ids: string[] = [];
    for (const a of v.assets) {
        object(a, 'Definition');
        fields(a, ['key', 'shape', 'size'], 'Definition');
        text(a.key, 'Definition key');
        assert(a.shape === 'box', 'Only box definitions supported');
        vector(a.size, 'Box dimensions');
        assert(a.size.every(x => x > 0), 'Box dimensions must be positive');
        ids.push(a.key);
    }
    for (const o of v.objects) {
        object(o, 'Instance');
        fields(o, ['name', 'asset', 'position'], 'Instance');
        text(o.name, 'Instance name');
        text(o.asset, 'Definition binding');
        vector(o.position, 'Instance translation');
        assert(v.assets.some(a => (a as SceneDefinition).key === o.asset), 'Instance refers to missing definition');
        ids.push(o.name);
    }
    unique(ids, 'Scene entity identifiers');
    assert(!ids.includes(SCENE_ROOT), 'Reserved scene root id');
}
export const SceneIR = defineIR<NativeScene>({
    id: 'ir-lab.scene', version: '1', description: 'Separate native definition and instance tables', validate: validateScene
});
export const sceneEntities = (v: NativeScene) => [entity(SCENE_ROOT, 'scene.root'), ...v.assets.map(a => entity(a.key, 'scene.definition', {
        shape: a.shape, size: a.size
    })), ...v.objects.map(o => entity(o.name, 'scene.instance', { position: o.position }))];
export const sceneRelations = (v: NativeScene) => [...v.assets.map(a => edge('contains', 'containment', SCENE_ROOT, a.key)), ...v.objects.map(o => edge('contains', 'containment', SCENE_ROOT, o.name)), ...v.objects.map(o => edge('uses', 'binding', o.name, o.asset))];
export function rebuildScene(base: NativeScene, g: IRGraph): NativeScene {
    root(g, SCENE_ROOT, 'scene.root');
    closedGraph(g, ['scene.root', 'scene.definition', 'scene.instance'], ['contains', 'uses']);
    const rank = (id: string, ids: string[]) => {
        const n = ids.indexOf(id);
        return n < 0 ? Number.MAX_SAFE_INTEGER : n;
    };
    const assets = g.entities.filter(e => e.kind === 'scene.definition').sort((a, b) => rank(a.id, base.assets.map(x => x.key)) - rank(b.id, base.assets.map(x => x.key))).map(e => ({
        key: e.id, shape: e.attributes.shape as 'box', size: e.attributes.size as Vec3
    }));
    const objects = g.entities.filter(e => e.kind === 'scene.instance').sort((a, b) => rank(a.id, base.objects.map(x => x.name)) - rank(b.id, base.objects.map(x => x.name))).map(e => {
        const uses = g.relations.filter(r => r.kind === 'uses' && r.from === e.id);
        assert(uses.length === 1, `Instance ${e.id} needs exactly one definition`);
        return {
            name: e.id, asset: uses[0].to, position: e.attributes.position as Vec3
        };
    });
    const result = {
        assets, objects
    };
    validateScene(result);
    return result;
}
export const sceneAdapter = defineAdapter<NativeScene>({
    id: 'adapter.scene-tables', version: '1', kind: SceneIR.id, schemaVersion: SceneIR.version, description: 'Separate scene tables projected as containment and definition-binding relationships', relationKinds: {
        contains: 'containment', uses: 'binding'
    }, entities: sceneEntities, resolve(v, id) {
        return sceneEntities(v).find(e => e.id === id);
    }, relations: sceneRelations, roots() {
        return [SCENE_ROOT];
    }, describe(v, id) {
        const a = v.assets.find(a => a.key === id), o = v.objects.find(o => o.name === id);
        return {
            label: id === SCENE_ROOT ? 'Instance scene' : id, detail: a ? `box ${a.size.join(' × ')}` : o ? `instance of ${o.asset}` : 'Scene definitions and placements'
        };
    }, validate: validateScene, rebuild: rebuildScene, serialize: v => JSON.stringify(v, null, 2), deserialize: s => jsonDeserialize<NativeScene>(s, validateScene), visualize(v, selection) {
        return {
            kind: 'instanced-boxes', data: {
                assets: v.assets, objects: v.objects, selection
            }
        };
    }
});
export function exampleScene(): NativeScene {
    return {
        assets: [{
                key: 'column-a', shape: 'box', size: [1, 3, 1]
            }, {
                key: 'column-b', shape: 'box', size: [1, 3, 1]
            }, {
                key: 'beam', shape: 'box', size: [5, 1, 1]
            }], objects: [{
                name: 'left-column', asset: 'column-a', position: [-2, 1.5, 0]
            }, {
                name: 'right-column', asset: 'column-b', position: [2, 1.5, 0]
            }, {
                name: 'lintel', asset: 'beam', position: [0, 3.5, 0]
            }]
    };
}
/** Expand only semantic placements, so definition identity and sharing do not affect the check. */
export function scenePlacements(v: NativeScene) {
    return v.objects.map(o => ({
        name: o.name, position: o.position, shape: v.assets.find(a => a.key === o.asset)!.shape, size: v.assets.find(a => a.key === o.asset)!.size
    })).sort((a, b) => a.name.localeCompare(b.name));
}
export const sceneEquivalent = (a: NativeScene, b: NativeScene) => canonical(scenePlacements(a)) === canonical(scenePlacements(b));
