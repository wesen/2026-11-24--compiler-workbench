// wb.js: the one place the UI imports the workbench layer (src/workbench, TypeScript; esbuild compiles it in).
export { createWb, toYaml, kindOf, compileBody, didYouMean, fail, guard, isPromise, runSync, yieldToHost, formatJson, wrapProse, TILE_WIDTH, PIPELINES, backendDefaults, backendOptionsAbout, setVendor, UI_SCOPE } from '../src/workbench/index.ts';
