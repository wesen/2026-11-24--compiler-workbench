/**
 * The RV32 backend for typed.blocks: instruction selection by tiling value trees, linear-scan register
 * allocation, frames, encoding, `rv32.image` as a v6 representation, and runs on the reused emulator.
 * A port of Compiler Workbench's backend.js.
 */
export { BackendError, didYouMean, type BackendErrorCode } from './errors.js';
export { REGS, decode, divisionMagic, encodeOne, instruction, type Decoded, type MInsn } from './encode.js';
export {
  backendDefaults,
  backendOptionsAbout,
  checkBackendOptions,
  diffOptions,
  type BackendOptions,
  type BackendOptionsInput,
} from './options.js';
export { select, type SelectContext, type Selection } from './select.js';
export { allocate, intervals, machineBlocks, type Allocation, type Interval } from './regalloc.js';
export {
  compileImage,
  finish,
  lowerToImage,
  machineCode,
  type BackendFacts,
  type Finished,
  type Lowered,
  type MachineStages,
} from './compile.js';
export {
  ImageIR,
  codeBytes,
  fromBase64,
  imageAdapter,
  imageCorrespondence,
  imageEntities,
  imageRelations,
  insnId,
  toBase64,
  validateImage,
  type ImageFn,
  type ImageInsn,
  type Rv32Image,
} from './image.js';
export {
  diffImages,
  heat,
  imageAgrees,
  imageFromCode,
  imageStatus,
  runImage,
  type Heat,
  type ImageCheckParams,
  type ImageDiff,
  type ImageRun,
} from './run.js';
