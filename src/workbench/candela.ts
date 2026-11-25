/**
 * Candela in the workbench: the gallery program as a project, its scenes rendered by any engine the page can run,
 * progressively, with the gallery's accumulation and a bit-for-bit comparison of frames.
 *
 * The host protocol, the scene table and the views are the kernel's (`src/typed/candela-render.ts`). This module
 * adds what a page needs on top:
 *   - engines: the reference compiler's RV32 image on the RV32 interpreter (the emulator), by policy, compiled once
 *     per source; and the evaluator over any revision's store (r0, or the open project's head);
 *   - `renderProgressive`: `renderScene`'s pixels (a full-row span at stride 1, one span per pixel otherwise), pass
 *     p at Candela's frame index 0, then p + 1, colour summed per pixel as f32 as the gallery does, yielding to the
 *     page between spans and stopping when asked;
 *   - the Candela project (`candelaProject`): the five Typed files in app.json's order, ingested from the tape, with
 *     check inputs derived from the program (`candelaInputs`, a port of tools/candela.mjs).
 * The data (sources and scene table) reaches a page as `globalThis.candelaData`, written by tools/build-site.mjs
 * from corpus/candela-gallery after checking every digest against its VENDOR.json.
 */
import {
  CandelaHost,
  parseSceneTable,
  viewImage,
  type CandelaEngine,
  type CandelaImage,
  type CandelaScene,
  type CandelaView,
} from '../typed/candela-render.js';
import { evaluate, hash } from '../typed/evaluate.js';
import { lowerToImage, runImage } from '../typed/backend/index.js';
import { blocksAdapter } from '../typed/ir.js';
import { createIRArtifact } from '../framework/ir/adapters.js';
import type { Artifact } from '../framework/core/types.js';
import type { TypedBlocks } from '../typed/model.js';
import { ingest } from '../typed/lift.js';
import { vendor } from '../typed/vendor.js';
import type { Store } from '../typed/model.js';
import { candelaInputs } from './candela-inputs.js';
import { referenceCompile, referenceRun, type ReferenceProgram } from '../typed/reference.js';
import { projectJson } from './projects.js';
import { yieldToHost } from './sync.js';

export { candelaInputs, parseSceneTable, viewImage, type CandelaScene, type CandelaView };

/** The longest source the front end accepts for Candela (tools/candela.mjs MAX_SOURCE). */
export const CANDELA_MAX_SOURCE = 1 << 22;
/** How the Candela project is ingested: from the front end's tape. */
export const CANDELA_INGEST = { tape: true, maxSourceLength: CANDELA_MAX_SOURCE } as const;

/** What tools/build-site.mjs bundles as `globalThis.candelaData`. */
export interface CandelaData {
  readonly commit: string;
  /** The Typed files in app.json's order. */
  readonly sources: readonly string[];
  readonly files: Readonly<Record<string, string>>;
  /** candela_gallery_scenes.c, data only. */
  readonly scenes: string;
}

/** The program's source: the files in order, each ending in a newline (as tools/candela.mjs candelaSource). */
export function candelaSource(data: CandelaData): string {
  return data.sources
    .map(f => (data.files[f].endsWith('\n') ? data.files[f] : data.files[f] + '\n'))
    .join('');
}

/** The Candela gallery as a built-in project. */
export function candelaProject(data: CandelaData): { id: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  for (const f of data.sources) files[f] = data.files[f];
  files['project.json'] = projectJson({
    title: 'Candela gallery',
    about:
      "Candela's path-tracing kernel and the gallery's 18 scene sections as Typed source (ds-js-os " +
      `${data.commit.slice(0, 7)}), ingested from the front end's tape. The Candela view renders its scenes.`,
    group: 'Candela',
    sources: [...data.sources],
    pipeline: 'O2',
    ingest: { ...CANDELA_INGEST },
    inputsFrom: 'candela',
    slowPasses: '18 to 60 s',
  });
  files['notes.md'] = [
    '# Candela gallery',
    '',
    "The Candela view renders the gallery's scenes with this program: on",
    "the emulator (the reference compiler's RV32 image), or with the",
    'evaluator at r0 or at the revision open here. A pass over all 332',
    'functions takes 18 to 60 seconds in a page, so nothing runs until you',
    'ask.',
    '',
  ].join('\n');
  return { id: 'candela', files };
}

// ---------- engines ----------
export interface CandelaEngineInfo {
  readonly engine: CandelaEngine;
  readonly label: string;
  /** What `steps` counts. */
  readonly unit: 'instructions' | 'statements';
  /** Time to make the engine (compiling the image), 0 when it was cached. */
  readonly setupMs: number;
  readonly imageBytes?: number;
}
const images = new Map<string, ReferenceProgram>();
/** The reference compiler's RV32 image of `source` under `policy`, on the RV32 interpreter. */
export function referenceEngine(source: string, policy: 'kernel' | 'stock' = 'kernel'): CandelaEngineInfo {
  const key = `${policy}:${hash(source)}`;
  let program = images.get(key),
    setupMs = 0;
  if (!program) {
    const t0 = performance.now();
    program = referenceCompile(source, { maxSourceLength: CANDELA_MAX_SOURCE, policy });
    setupMs = performance.now() - t0;
    images.set(key, program);
  }
  const p = program;
  return {
    engine: (name, args, mem) => referenceRun(p, name, args, mem, { limit: 4e9 }),
    label: `emulator · reference image (${policy})`,
    unit: 'instructions',
    setupMs,
    imageBytes: p.image.length,
  };
}
/**
 * Candela's r0 lifted from the tape, without making a Program: a Program also hashes its r0 artifact, which takes
 * about 13 s for Candela's 12,358 statements; lifting alone takes under a second.
 */
export function liftCandela(source: string): Store {
  return ingest('candela', source, CANDELA_INGEST);
}
/** Whether the reference compiler (typed-rv32.js and its pass groups) is loaded. */
export const hasReferenceCompiler = () => !!vendor().typedRv32;
/** The evaluator over a revision's store. */
export function evaluatorEngine(st: Store, label: string): CandelaEngineInfo {
  return {
    engine: (name, args, mem) => evaluate(st, name, args, mem, { limit: 2e9 }),
    label,
    unit: 'statements',
    setupMs: 0,
  };
}

/** A revision of Candela as an artifact (hashing r0's 12,358 statements takes seconds; done once per store). */
const artifacts = new WeakMap<Store, Artifact<TypedBlocks>>();
export function candelaArtifact(st: Store): Artifact<TypedBlocks> {
  let a = artifacts.get(st);
  if (!a) artifacts.set(st, (a = createIRArtifact(blocksAdapter, 'candela', st.toNative())));
  return a;
}
const ownImages = new WeakMap<object, ReturnType<typeof lowerToImage>['image']>();
/** This compiler's own RV32 image of a revision (the f32 backend), run on the RV32 interpreter. */
export function imageEngine(art: Artifact<TypedBlocks>, label: string): CandelaEngineInfo {
  let image = ownImages.get(art),
    setupMs = 0;
  if (!image) {
    const t0 = performance.now();
    image = lowerToImage(art).image;
    setupMs = performance.now() - t0;
    ownImages.set(art, image);
  }
  const img = image;
  return {
    engine: (name, args, mem) => ({
      ...runImage(img, name, args, mem, { limit: 4e9, counts: false }),
      counts: null,
    }),
    label,
    unit: 'instructions',
    setupMs,
    imageBytes: img.value.bytes,
  };
}

// ---------- rendering ----------
export interface CandelaProgress {
  readonly phase: 'sky' | 'rows' | 'done' | 'stopped';
  /** The pass being rendered (0-based) and the passes asked for. */
  readonly pass: number;
  readonly passes: number;
  /** Rows of this pass done, of `rows`. */
  readonly row: number;
  readonly rows: number;
  readonly frame: CandelaFrame;
}
/** A render in progress or done: pass 0's outputs and the gallery's colour sums. */
export interface CandelaFrame {
  readonly scene: string;
  readonly width: number;
  readonly height: number;
  readonly stride: number;
  /** 12 floats per pixel from pass 0 (frame index 0): colour rgba, albedo rgba, normal xyz, depth. */
  readonly frame0: Float32Array;
  /** 4 floats per pixel: the f32 sums of colour over the passes done. */
  readonly acc: Float32Array;
  /** Passes summed into `acc`, per row. */
  readonly count: Uint16Array;
  passesDone: number;
  pixelsDone: number;
  /** Engine steps for the sky table, and for the pixels. */
  skySteps: number;
  steps: number;
  skyMs: number;
  ms: number;
  stopped: boolean;
}
export interface CandelaRenderOptions {
  readonly stride?: number;
  readonly passes?: number;
  readonly signal?: { readonly aborted: boolean };
  readonly onProgress?: (p: CandelaProgress) => void;
  /** Yield to the page at least this often, in ms (default 30). */
  readonly slice?: number;
  readonly yieldTo?: () => Promise<void>;
}

/** The frame index of pass p, as the gallery numbers them. */
export const frameOf = (p: number) => (p === 0 ? 0 : p + 1);

export async function renderProgressive(
  host: CandelaHost,
  scene: CandelaScene,
  opts: CandelaRenderOptions = {},
): Promise<CandelaFrame> {
  const stride = Math.max(1, opts.stride ?? 1),
    passes = Math.max(1, opts.passes ?? 1),
    slice = opts.slice ?? 30,
    yieldTo = opts.yieldTo ?? yieldToHost;
  const w = Math.ceil(scene.width / stride),
    h = Math.ceil(scene.height / stride);
  const f: CandelaFrame = {
    scene: scene.id,
    width: w,
    height: h,
    stride,
    frame0: new Float32Array(w * h * 12),
    acc: new Float32Array(w * h * 4),
    count: new Uint16Array(h),
    passesDone: 0,
    pixelsDone: 0,
    skySteps: 0,
    steps: 0,
    skyMs: 0,
    ms: 0,
    stopped: false,
  };
  const t0 = performance.now();
  const report = (phase: CandelaProgress['phase'], pass: number, row: number) => {
    f.ms = performance.now() - t0;
    opts.onProgress?.({ phase, pass, passes, row, rows: h, frame: f });
  };
  report('sky', 0, 0);
  await yieldTo();
  const s0 = host.steps;
  host.bind(scene); // the sky table: one blocking call (about 1.3–1.8 s)
  f.skySteps = host.steps - s0;
  f.skyMs = performance.now() - t0;
  let last = performance.now();
  const go = async () => {
    if (performance.now() - last >= slice) {
      await yieldTo();
      last = performance.now();
    }
    return !opts.signal?.aborted;
  };
  const put = (p: number, j: number, x: number, o: Float32Array, k: number) => {
    const i = j * w + x;
    if (p === 0) f.frame0.set(o.subarray(12 * k, 12 * k + 12), 12 * i);
    for (let c = 0; c < 4; c++) f.acc[4 * i + c] = Math.fround(f.acc[4 * i + c] + o[12 * k + c]);
    f.pixelsDone++;
  };
  const before = host.steps;
  outer: for (let p = 0; p < passes; p++) {
    const frame = frameOf(p);
    for (let j = 0; j < h; j++) {
      const y = j * stride;
      if (stride === 1) {
        const o = host.span(y, 0, scene.width, frame);
        for (let x = 0; x < w; x++) put(p, j, x, o, x);
      } else
        for (let i = 0; i < w; i++) {
          put(p, j, i, host.span(y, i * stride, i * stride + 1, frame), 0);
          f.steps = host.steps - before;
          if (!(await go())) {
            f.stopped = true;
            break outer;
          }
        }
      f.count[j]++;
      f.steps = host.steps - before;
      report('rows', p, j + 1);
      if (!(await go())) {
        f.stopped = true;
        break outer;
      }
    }
    f.passesDone = p + 1;
  }
  f.steps = host.steps - before;
  report(f.stopped ? 'stopped' : 'done', f.passesDone, h);
  return f;
}

/** 8-bit RGBA of a frame: colour is the mean over the passes summed (per row), the other views come from pass 0. */
export function frameImage(
  f: CandelaFrame,
  view: CandelaView = 'colour',
  exposure?: number,
): Uint8ClampedArray {
  const pixels = f.frame0.slice();
  if (view === 'colour')
    for (let j = 0; j < f.height; j++) {
      const n = f.count[j];
      if (n > 1)
        for (let x = 0; x < f.width; x++) {
          const i = j * f.width + x;
          for (let c = 0; c < 4; c++) pixels[12 * i + c] = f.acc[4 * i + c] / n;
        }
    }
  const img: CandelaImage = { scene: f.scene, width: f.width, height: f.height, pixels, steps: f.steps };
  return viewImage(img, view, exposure);
}

/** How many of two frames' output floats differ in their bits: pass 0's, and the colour sums when both summed the same passes. */
export function compareFrames(a: CandelaFrame, b: CandelaFrame) {
  if (a.width !== b.width || a.height !== b.height || a.scene !== b.scene) return null;
  const bits = (x: Float32Array, y: Float32Array) => {
    const u = new Uint32Array(x.buffer, x.byteOffset, x.length),
      v = new Uint32Array(y.buffer, y.byteOffset, y.length);
    let d = 0;
    for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) d++;
    return d;
  };
  return {
    floats: a.frame0.length,
    different: bits(a.frame0, b.frame0),
    accFloats: a.acc.length,
    // the colour sums are comparable only over the same passes
    accDifferent: a.passesDone === b.passesDone ? bits(a.acc, b.acc) : null,
  };
}

/** A host on an engine (layout and cdlInit run here). */
export const candelaHost = (e: CandelaEngineInfo) => new CandelaHost(e.engine);
