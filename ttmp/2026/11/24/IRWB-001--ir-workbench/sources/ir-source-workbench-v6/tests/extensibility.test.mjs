import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { task, artifactKey } from '../dist/core/index.js';
import { validateMesh, boxMesh } from '../dist/geometry/mesh.js';
import { createProject, defaultInputs, projectTasks } from '../dist/examples/project.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(projectRoot, 'src');

/** An extension known only to this consumer; neither runtime nor domains name its kind. */
function registerSurfaceInventory(registry) {
  registry.registerKind({
    id: 'extension.surface-inventory', version: '1', description: 'Semantic-face surface area inventory',
    validate(value) {
      assert.equal(value.units, 'm^2'); assert.ok(Array.isArray(value.surfaces));
      assert.ok(Number.isFinite(value.totalArea) && value.totalArea > 0);
      assert.ok(Number.isInteger(value.triangleCount) && value.triangleCount > 0);
      assert.equal(new Set(value.surfaces.map(s => s.id)).size, value.surfaces.length);
      for (const surface of value.surfaces) {
        assert.equal(typeof surface.id, 'string');
        assert.ok(Number.isFinite(surface.area) && surface.area >= 0);
        assert.ok(Number.isInteger(surface.triangles) && surface.triangles > 0);
      }
    },
    structure: value => value.surfaces.map(s => ({ from: s.id, to: 'total-area', relation: 'contributes-area' })),
  });
  registry.register({
    id: 'extension.surface-inventory', version: '1', kind: 'extension.surface-inventory', role: 'analysis',
    description: 'Aggregate actual triangle area by public semantic surface identity',
    async run(ctx, { mesh }) {
      const source = await ctx.require(mesh);
      assert.equal(source.kind, 'geometry.mesh'); validateMesh(source.value);
      const byFace = new Map(); let totalArea = 0;
      for (let i = 0; i < source.value.triangles.length; i++) {
        const [a, b, c] = source.value.triangles[i].map(index => source.value.positions[index]);
        const u = b.map((x, axis) => x - a[axis]), v = c.map((x, axis) => x - a[axis]);
        const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
        const id = source.value.faceIds[i], entry = byFace.get(id) ?? { id, area: 0, triangles: 0 };
        entry.area += area; entry.triangles++; totalArea += area; byFace.set(id, entry);
      }
      const surfaces = [...byFace.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      ctx.derive(source, { from: surfaces.map(s => s.id), to: surfaces.map(s => s.id), relation: 'surface-area-analysis' });
      ctx.metric('totalArea', totalArea, 'm^2');
      return { units: 'm^2', surfaces, totalArea, triangleCount: source.value.triangles.length };
    },
  });
}

function inventoryTasks() {
  const project = projectTasks();
  return {
    cad: task('extension/cad-area', 'extension.surface-inventory', { mesh: project.cad.mesh }),
    game: task('extension/game-area', 'extension.surface-inventory', { mesh: project.game.meshes.column }),
  };
}
async function inventories(compiler, label) {
  const tasks = inventoryTasks();
  return compiler.run(label, async run => {
    const [cad, game] = await Promise.all([run.require(tasks.cad), run.require(tasks.game)]);
    return { cad, game };
  });
}

test('a newly registered IR and one analysis pass consume CAD and game geometry through the same boundary', async () => {
  const compiler = createProject(), before = compiler.snapshot();
  registerSurfaceInventory(compiler);
  assert.equal(compiler.snapshot().kinds.length, before.kinds.length + 1);
  assert.equal(compiler.snapshot().passes.length, before.passes.length + 1);
  const { value, run } = await inventories(compiler, 'new analysis on two frontends');
  for (const artifact of Object.values(value)) {
    assert.equal(artifact.kind, 'extension.surface-inventory');
    assert.equal(run.query.invocations(artifact)[0].passId, 'extension.surface-inventory');
    assert.equal(run.query.invocations(artifact)[0].role, 'analysis');
    assert.ok(Object.isFrozen(artifact.value) && Object.isFrozen(artifact.value.surfaces));
    assert.equal(compiler.snapshot().structures[artifactKey(artifact)].length, artifact.value.surfaces.length);
    assert.ok(run.query.lineage({ artifact: artifact.id, revision: artifact.revision, entity: artifact.value.surfaces[0].id }).some(e => e.relation === 'surface-area-analysis'));
  }
  assert.ok(value.cad.value.surfaces.some(s => s.id === 'hole:left/wall'));
  assert.ok(value.game.value.surfaces.some(s => s.id === 'column/cap:top'));
  const inputs = defaultInputs(), radius = inputs['game.columnRadius'], height = inputs['game.floorHeight'] * inputs['game.floors'], n = 48;
  const polygonCylinderArea = n * (2 * radius * Math.sin(Math.PI / n)) * height + n * radius * radius * Math.sin(2 * Math.PI / n);
  assert.ok(Math.abs(value.game.value.totalArea - polygonCylinderArea) < 1e-12, 'new analysis agrees with an independent regular-prism area formula');
});

test('the extension inherits precise cache invalidation without implementing its own cache', async () => {
  const compiler = createProject(); registerSurfaceInventory(compiler);
  const first = await inventories(compiler, 'cold extension');
  const warm = await inventories(compiler, 'warm extension');
  assert.equal(warm.run.query.invocations('extension/cad-area')[0].status, 'cached');
  assert.equal(warm.run.query.invocations('extension/game-area')[0].status, 'cached');
  compiler.setInput('cad.holeDiameter', 0.016);
  const changed = await inventories(compiler, 'CAD edit');
  assert.equal(changed.run.query.invocations('extension/cad-area')[0].status, 'executed');
  assert.equal(changed.run.query.invocations('extension/game-area')[0].status, 'cached');
  assert.notEqual(changed.value.cad.revision, first.value.cad.revision);
  assert.equal(changed.value.game.revision, first.value.game.revision);
});

test('the same extension also accepts a new mesh producer registered after the existing frontends', async () => {
  const compiler = createProject(); registerSurfaceInventory(compiler);
  compiler.register({ id: 'extension.geometry-source', version: '1', kind: 'geometry.mesh', description: 'Independent source', run: () => boxMesh(2, 3, 4, 'independent') });
  const source = task('extension/source', 'extension.geometry-source', {});
  const request = task('extension/box-area', 'extension.surface-inventory', { mesh: source });
  const { value } = await compiler.run('independent producer', run => run.require(request));
  assert.equal(value.value.totalArea, 2 * (2 * 3 + 2 * 4 + 3 * 4));
  assert.equal(value.value.surfaces.length, 6);
});

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesUnder(resolve(directory, entry.name)) : entry.name.endsWith('.ts') ? [resolve(directory, entry.name)] : []);
}
function importSpecifiers(filename) {
  const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const result = [];
  function add(node) { if (node && ts.isStringLiteral(node)) result.push(node.text); }
  function walk(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      assert.ok(node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]), `Reusable module has a nonliteral import in ${filename}`);
      add(node.arguments[0]);
    }
    ts.forEachChild(node, walk);
  }
  walk(source); return result;
}

test('reusable modules have no domain imports and respect their directed dependency boundaries', () => {
  const allowed = {
    core: new Set(['core']), math: new Set(['core', 'math']), geometry: new Set(['core', 'geometry']),
    scene: new Set(['core', 'geometry', 'scene']), assembly: new Set(['core', 'geometry', 'assembly']),
  };
  const checkedFiles = new Set(); let checkedImports = 0;
  for (const [module, dependencies] of Object.entries(allowed)) {
    for (const filename of filesUnder(resolve(sourceRoot, module))) {
      checkedFiles.add(relative(sourceRoot, filename).split(sep).join('/'));
      for (const specifier of importSpecifiers(filename)) {
        checkedImports++;
        assert.ok(specifier.startsWith('.'), `${relative(sourceRoot, filename)} has an external/platform dependency ${specifier}`);
        const target = resolve(dirname(filename), specifier), targetModule = relative(sourceRoot, target).split(sep)[0];
        assert.ok(dependencies.has(targetModule), `${relative(sourceRoot, filename)} imports forbidden module ${targetModule}`);
      }
    }
  }
  for (const entry of ['core/runtime.ts', 'math/register.ts', 'geometry/mesh.ts', 'scene/schema.ts', 'assembly/planar.ts']) assert.ok(checkedFiles.has(entry), `Boundary check omitted ${entry}`);
  assert.ok(checkedImports > 0, 'boundary verification must actually inspect imports');
  const adapterImports = importSpecifiers(resolve(sourceRoot, 'adapters/assembly-physics.ts'));
  assert.ok(adapterImports.includes('../assembly/planar.js'));
  assert.ok(adapterImports.includes('../math/four-bar.js')); // Solver representation moved below the frontend.
});

test('fresh Node processes reproduce every intermediate and final artifact hash from equal inputs', { timeout: 30000 }, () => {
  const script = `
    import { readFileSync } from 'node:fs';
    import { createProject, compileProject } from './dist/examples/project.js';
    const config = JSON.parse(readFileSync(0, 'utf8'));
    const compiler = createProject(config.inputs);
    const result = await compileProject(compiler, config.label, { trace: config.trace });
    const describe = a => ({ id:a.id,kind:a.kind,schemaVersion:a.schemaVersion,revision:a.revision,contentHash:a.contentHash });
    const artifacts = compiler.snapshot().artifacts.map(describe).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    const roots = Object.fromEntries(Object.entries(result.artifacts).map(([name,a])=>[name,describe(a)]));
    process.stdout.write(JSON.stringify({ roots, artifacts, pid:process.pid }));
  `;
  const inputs = defaultInputs();
  const configurations = [
    { inputs, label: 'first fresh process', trace: 'full' },
    { inputs: Object.fromEntries(Object.entries(inputs).reverse()), label: 'second fresh process', trace: 'summary' },
  ];
  const results = configurations.map(configuration => {
    const processResult = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: projectRoot, input: JSON.stringify(configuration), encoding: 'utf8', timeout: 12000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(processResult.status, 0, processResult.stderr || String(processResult.error));
    return JSON.parse(processResult.stdout);
  });
  assert.notEqual(results[0].pid, results[1].pid);
  assert.deepEqual(results[0].roots, results[1].roots);
  assert.deepEqual(results[0].artifacts, results[1].artifacts);
  assert.equal(Object.keys(results[0].roots).length, 4);
  assert.ok(results[0].artifacts.length > 50, 'reproduction covers intermediate artifacts, not only four selected outputs');
});
