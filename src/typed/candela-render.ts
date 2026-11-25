/**
 * Rendering Candela gallery scenes with the Typed Candela program, on any engine that can call its entries over a
 * memory image: the reference compiler's RV32 image on the RV32 interpreter (the emulator), this compiler's
 * evaluator at any revision, or this compiler's own RV32 image once the f32 backend exists.
 *
 * The scenes come from the gallery's scene table, `candela_gallery_scenes.c` (vendored as data, never compiled):
 * per scene Candela's packed buffers, rows of four floats as bit patterns (U uniforms, O objects, LI lights,
 * BV BVH nodes, SD SDF/volume data), at the scene's resolution with pass-0 frame uniforms.
 *
 * The host protocol is a port of ds-js-os tools/gen/candela/typed/host.mjs (read, not run):
 *   1. `cdlLayout(lay)` describes the arena the host lays out: pointer fields and buffer headers of the kernel
 *      record K and what it points to; the host writes the pointers and capacities at ARENA.
 *   2. `cdlInit(K)` fills the GGX albedo table.
 *   3. bind a scene: its five row buffers into K's first five fields, K.scene, K.spectral; `cdlSky(K)` with
 *      K.skyOn = 0 builds the sky table, then K.skyOn = 1.
 *   4. `cdlRenderSpan(K, out, y, x0, x1, frame)` writes 12 floats per pixel (colour rgba, albedo, normal).
 */
import type { RunResult } from './evaluate.js';

export interface CandelaScene {
  readonly index: number;
  readonly id: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly spectral: boolean;
  /** Rows of four floats per buffer: U, O, LI, BV, SD. */
  readonly rows: readonly [number, number, number, number, number];
  /** The buffers' words, concatenated in that order. */
  readonly data: Uint32Array;
}

/** The scenes of `candela_gallery_scenes.c`, in gallery order (the order K.scene indexes). */
export function parseSceneTable(text: string): CandelaScene[] {
  const arrays = new Map<string, Uint32Array>();
  for (const m of text.matchAll(/static const uint32_t (\w+)_data\[(\d+)\] = \{([^}]*)\};/g)) {
    const words = m[3].match(/0x[0-9a-fA-F]+/g) ?? [];
    if (words.length !== +m[2]) throw new Error(`scene table: ${m[1]}_data has ${words.length} words, declared ${m[2]}`);
    arrays.set(m[1], Uint32Array.from(words, w => parseInt(w, 16)));
  }
  const table = /const cg_scene_desc cg_scenes\[\] = \{([\s\S]*?)\n\};/.exec(text);
  if (!table) throw new Error('scene table: cg_scenes[] not found');
  const scenes: CandelaScene[] = [];
  for (const m of table[1].matchAll(
    /\{ "([^"]+)", "([^"]+)", (\d+), (\d+), (\d+),[^{]*\{ (\d+), (\d+), (\d+), (\d+), (\d+) \}, (\w+)_data,/g,
  )) {
    const rows = [+m[6], +m[7], +m[8], +m[9], +m[10]] as const;
    const data = arrays.get(m[11]);
    if (!data) throw new Error(`scene table: no data for ${m[1]}`);
    const words = 4 * rows.reduce((a, b) => a + b, 0);
    if (data.length !== words) throw new Error(`scene table: ${m[1]} has ${data.length} words, rows say ${words}`);
    scenes.push({
      index: scenes.length,
      id: m[1],
      title: m[2],
      width: +m[3],
      height: +m[4],
      spectral: m[5] === '1',
      rows: [...rows] as unknown as CandelaScene['rows'],
      data,
    });
  }
  if (!scenes.length) throw new Error('scene table: no scenes');
  return scenes;
}

/** Calls an entry of the Candela program on a memory image; returns the run with the memory after it. */
export type CandelaEngine = (name: string, args: readonly number[], memory: Uint8Array) => RunResult;

export const MEMORY_BYTES = 1 << 20;
const ARENA = 4096,
  MAX_SIDE = 160;

export class CandelaHost {
  mem = new Uint8Array(MEMORY_BYTES);
  view = new DataView(this.mem.buffer);
  /** Statements or instructions the engine reported, summed over calls. */
  steps = 0;
  calls = 0;
  private out = 0;
  private rows = 0;
  constructor(readonly engine: CandelaEngine) {
    this.layout();
  }
  call(name: string, args: readonly number[]): number {
    const r = this.engine(name, args, this.mem);
    if (r.trap) throw new Error(`${name} trapped: ${r.trap}${r.limit ? ' (step limit)' : ''}`);
    this.mem.set(r.bytes.subarray(0, this.mem.length));
    this.steps += r.steps;
    this.calls++;
    return typeof r.result === 'number' ? r.result : -1;
  }
  /** A buffer: capacity in UTF-16 units at byte 0, data from byte 4. */
  private buffer(at: number, units: number) {
    this.view.setInt32(at, units, true);
    return at;
  }
  private layout() {
    const v = this.view;
    this.mem.fill(0);
    const lay = this.buffer(256, 1024);
    this.call('cdlLayout', [lay]);
    const cell = (i: number) => v.getUint16(lay + 4 + 2 * i, true);
    const words = cell(0) | (cell(1) << 16),
      np = cell(2),
      nb = cell(3);
    for (let i = 0; i < np; i++) v.setInt32(ARENA + 4 * cell(4 + 2 * i), ARENA + 4 * cell(5 + 2 * i), true);
    for (let i = 0; i < nb; i++) v.setInt32(ARENA + 4 * cell(4 + 2 * np + 2 * i), cell(5 + 2 * np + 2 * i), true);
    let top = ARENA + 4 * words;
    this.out = top;
    this.buffer(this.out, 2 * 12 * MAX_SIDE);
    top += 4 + 48 * MAX_SIDE;
    this.rows = top;
    if (this.call('cdlInit', [ARENA]) !== 1) throw new Error('cdlInit did not return 1');
  }
  /** Bind a scene: its row buffers, K.scene, K.spectral, and the sky table. */
  bind(scene: CandelaScene) {
    const v = this.view;
    let at = this.rows,
      src = 0;
    for (let b = 0; b < 5; b++) {
      const rows = scene.rows[b];
      this.buffer(at, 8 * rows);
      for (let w = 0; w < 4 * rows; w++) v.setUint32(at + 4 + 4 * w, scene.data[src + w], true);
      v.setInt32(ARENA + 4 * b, at, true);
      at += 4 + 16 * rows;
      src += 4 * rows;
    }
    if (at > MEMORY_BYTES - 65536) throw new Error(`scene ${scene.id} does not fit`);
    v.setInt32(ARENA + 4 * 7, scene.index, true);
    v.setInt32(ARENA + 4 * 8, scene.spectral ? 1 : 0, true);
    v.setInt32(ARENA + 4 * 9, 0, true);
    this.call('cdlSky', [ARENA]);
    v.setInt32(ARENA + 4 * 9, 1, true);
  }
  /** One camera sample per pixel x0..x1-1 of row y: 12 floats per pixel. */
  span(y: number, x0: number, x1: number, frame = 0): Float32Array {
    this.call('cdlRenderSpan', [ARENA, this.out, y, x0, x1, frame]);
    const n = 12 * (x1 - x0),
      o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = this.view.getFloat32(this.out + 4 + 4 * i, true);
    return o;
  }
}

export interface RenderOptions {
  /** Every `stride`-th pixel in x and y (a preview); 1 renders every pixel. */
  readonly stride?: number;
  readonly frame?: number;
  /** Called after each row with the row index, the rows done and the rows in all. */
  readonly onRow?: (y: number, done: number, rows: number) => void;
}

/** The pixel outputs of a frame: 12 floats per pixel (colour rgba, albedo rgba, normal xyz and depth). */
export interface CandelaImage {
  readonly scene: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: Float32Array;
  /** Engine steps (statements or instructions) for the frame. */
  readonly steps: number;
}
export type CandelaView = 'colour' | 'albedo' | 'normal' | 'depth';

/** A frame at the scene's resolution divided by `stride` (every pixel's 12 outputs). */
export function renderScene(
  host: CandelaHost,
  scene: CandelaScene,
  { stride = 1, frame = 0, onRow }: RenderOptions = {},
): CandelaImage {
  host.bind(scene);
  const w = Math.ceil(scene.width / stride),
    h = Math.ceil(scene.height / stride);
  const pixels = new Float32Array(w * h * 12);
  const before = host.steps;
  for (let j = 0; j < h; j++) {
    const y = j * stride;
    if (stride === 1) pixels.set(host.span(y, 0, scene.width, frame), j * w * 12);
    else for (let i = 0; i < w; i++) pixels.set(host.span(y, i * stride, i * stride + 1, frame), (j * w + i) * 12);
    onRow?.(y, j + 1, h);
  }
  return { scene: scene.id, width: w, height: h, pixels, steps: host.steps - before };
}

/**
 * 8-bit RGBA for a view of the frame. Colour: exposure (by default automatic: the log-average luminance maps to
 * 0.18), x / (1 + x) per channel, the sRGB curve. Candela's viewport applies the scene's own tone map, exposure
 * mode and post passes; this preview does not. Albedo: as stored. Normal: (n + 1) / 2. Depth: near is bright.
 */
export function viewImage(img: CandelaImage, view: CandelaView = 'colour', exposure?: number): Uint8ClampedArray {
  const n = img.width * img.height,
    out = new Uint8ClampedArray(4 * n),
    px = img.pixels;
  const fin = (x: number) => (Number.isFinite(x) ? x : 0);
  const srgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  let k = exposure;
  if (view === 'colour' && k === undefined) {
    let sum = 0,
      m = 0;
    for (let i = 0; i < n; i++) {
      const l = 0.2126 * fin(px[12 * i]) + 0.7152 * fin(px[12 * i + 1]) + 0.0722 * fin(px[12 * i + 2]);
      if (l > 0) {
        sum += Math.log(l);
        m++;
      }
    }
    k = m ? 0.18 / Math.exp(sum / m) : 1;
  }
  let dmax = 0;
  if (view === 'depth') for (let i = 0; i < n; i++) dmax = Math.max(dmax, fin(px[12 * i + 11]));
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      let v: number;
      if (view === 'colour') {
        const x = Math.max(0, fin(px[12 * i + c]) * k!);
        v = srgb(x / (1 + x));
      } else if (view === 'albedo') v = srgb(Math.min(1, Math.max(0, fin(px[12 * i + 4 + c]))));
      else if (view === 'normal') v = (fin(px[12 * i + 8 + c]) + 1) / 2;
      else v = dmax > 0 ? 1 - fin(px[12 * i + 11]) / dmax : 0;
      out[4 * i + c] = Math.round(255 * v);
    }
    out[4 * i + 3] = 255;
  }
  return out;
}
