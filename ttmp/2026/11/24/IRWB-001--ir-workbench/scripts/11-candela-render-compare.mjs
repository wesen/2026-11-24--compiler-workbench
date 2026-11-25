// Render one scene with two engines and compare every pixel output bit for bit.
//   node …/11-candela-render-compare.mjs [scene] [stride] [engineA] [engineB] [--head-b head.json]
const root = new URL('../../../../../../', import.meta.url).pathname;
const T = await import(root + 'tools/candela-render.mjs');
const R = await import(root + 'dist/typed/candela-render.js');
const [sceneArg = 'B-01', strideArg = '4', a = 'reference', b = 'evaluator'] = process.argv.slice(2).filter(x => !x.startsWith('--') && !x.endsWith('.json'));
const headB = process.argv.includes('--head-b') ? process.argv[process.argv.indexOf('--head-b') + 1] : null;
const scene = T.candelaScenes().find(s => s.id === sceneArg || String(s.index) === sceneArg);
const run = async (kind, head) => {
  const t = performance.now();
  const img = R.renderScene(new R.CandelaHost(await T.engineFor(kind, { policy: 'kernel', head })), scene, { stride: +strideArg });
  return { img, ms: Math.round(performance.now() - t) };
};
const A = await run(a, null), B = await run(b, headB);
const ua = new Uint32Array(A.img.pixels.buffer), ub = new Uint32Array(B.img.pixels.buffer);
let diff = 0, first = -1;
for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) { diff++; if (first < 0) first = i; }
console.log(JSON.stringify({ scene: scene.id, stride: +strideArg, pixels: A.img.width * A.img.height, floats: ua.length, differentBits: diff,
  first: first < 0 ? null : { pixel: Math.floor(first / 12), output: first % 12, a: A.img.pixels[first], b: B.img.pixels[first] },
  [a]: { steps: A.img.steps, ms: A.ms }, [b + (headB ? '@head' : '')]: { steps: B.img.steps, ms: B.ms } }));
