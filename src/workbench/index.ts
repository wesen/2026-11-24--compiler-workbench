/**
 * The workbench layer: the `wb` root the UI, project scripts, the console and the agent talk to, on the kernel
 * (src/typed). See workbench.ts for the root, sync.ts for how synchronous scripts drive the async kernel, and
 * DIVERGENCES.md for where this API differs from Compiler Workbench's.
 */
export { createWb, type Chapter, type WbConfig } from './workbench.js';
export { runSync, runAsync, yieldToHost, SyncContext, Suspend, isPromise, type SyncOptions } from './sync.js';
export { toYaml, yaml, guard, fail, didYouMean, ERRORS, WorkbenchError } from './base.js';
export {
  kindOf,
  compileBody,
  firstComment,
  SCRIPT_SCOPE,
  UI_SCOPE,
  type BuiltinProject,
  type Storage,
} from './projects.js';
export { WbProgram, FACTS, benchOf, argSpec } from './programs.js';
export { handle, selection, fragments, usesOf, type EntityHost } from './entities.js';
export { PIPELINES, PASSES } from '../typed/passes.js';
export { backendDefaults, backendExtras, backendOptionsAbout, runImage } from '../typed/backend/index.js';
export { setVendor } from '../typed/vendor.js';
export { formatJson, wrapProse, TILE_WIDTH } from '../typed/format.js';
export {
  CANDELA_INGEST,
  CANDELA_MAX_SOURCE,
  candelaHost,
  candelaInputs,
  candelaProject,
  candelaSource,
  compareFrames,
  evaluatorEngine,
  imageEngine,
  candelaArtifact,
  frameImage,
  frameOf,
  hasReferenceCompiler,
  liftCandela,
  parseSceneTable,
  referenceEngine,
  renderProgressive,
  type CandelaData,
  type CandelaFrame,
  type CandelaProgress,
} from './candela.js';
