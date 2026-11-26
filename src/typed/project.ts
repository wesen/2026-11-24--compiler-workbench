/**
 * Projects: a directory of Typed sources plus `project.json` (title, pipeline, per-function input specs). A port
 * of Compiler Workbench's projects.js source assembly: the sources named in `project.json` come first, then the
 * remaining `.typed` files in name order; they are concatenated (each ending in a newline) into one program whose
 * name is the project id with `-` replaced by `_`, and a file map records where each file starts.
 */
import { applyPass, type PassResult } from '../framework/passes/define-pass.js';
import type { AnalysisManager } from '../framework/contracts/analysis-manager.js';
import type { Artifact } from '../framework/core/types.js';
import { createIRArtifact } from '../framework/ir/adapters.js';
import type { ProgramInputs } from './evaluate.js';
import { blocksAdapter } from './ir.js';
import { ingest, type IngestOptions } from './lift.js';
import type { TypedBlocks } from './model.js';
import { joinText } from './format.js';
import { optimizationContract, PASSES, PIPELINES, type RevisionReport } from './passes.js';

export interface ProjectMeta {
  readonly title: string;
  readonly about: string;
  readonly group: string;
  readonly pipeline: string;
  readonly inputs: ProgramInputs;
  readonly sources: readonly string[];
  /** How to ingest the sources (`{ "tape": true }` for programs with frame arrays, f32 min/max or conversions). */
  readonly ingest?: IngestOptions;
  /** Entry points: when present, the meaning check generates cases for these functions only (`MeaningParams.roots`). */
  readonly entries?: readonly string[];
  readonly [field: string]: unknown;
}

export interface ProjectSource {
  readonly id: string;
  readonly name: string;
  readonly meta: ProjectMeta;
  readonly source: string;
  readonly fileMap: readonly { readonly file: string; readonly start: number; readonly lines: number }[];
}

export function projectSource(id: string, files: Readonly<Record<string, string>>): ProjectSource {
  let m: Record<string, unknown> = {};
  if (files['project.json']) m = JSON.parse(files['project.json']);
  const typed = Object.keys(files)
    .filter(f => f.endsWith('.typed'))
    .sort();
  const named = Array.isArray(m.sources) ? (m.sources as string[]) : [];
  const sources = named.filter(f => files[f] !== undefined).concat(typed.filter(f => !named.includes(f)));
  // prose fields may be written as arrays of lines, so project.json stays narrow; they mean the joined text
  if (m.about !== undefined) m.about = joinText(m.about);
  if (Array.isArray(m.try)) m.try = m.try.map(x => joinText(x));
  if (m.scripts && typeof m.scripts === 'object')
    for (const sc of Object.values(m.scripts as Record<string, Record<string, unknown>>))
      if (sc && sc.about !== undefined) sc.about = joinText(sc.about);
  const meta = {
    title: id,
    about: '',
    group: 'Mine',
    pipeline: 'O2',
    inputs: {},
    ...m,
    sources,
  } as ProjectMeta;
  let source = '',
    line = 1;
  const fileMap: { file: string; start: number; lines: number }[] = [];
  for (const f of sources) {
    let t = files[f];
    if (!t.endsWith('\n')) t += '\n';
    const n = t.split('\n').length - 1;
    fileMap.push({ file: f, start: line, lines: n });
    source += t;
    line += n;
  }
  return { id, name: id.replace(/-/g, '_'), meta, source, fileMap };
}

/** r0 of a project as a v6 artifact. */
export function ingestProject(p: ProjectSource): Artifact<TypedBlocks> {
  return createIRArtifact(blocksAdapter, p.name, ingest(p.name, p.source, p.meta.ingest ?? {}).toNative());
}

export interface PipelineStep {
  readonly pass: string;
  readonly changed: boolean;
  readonly rev: number;
  readonly edits: number;
  readonly report?: RevisionReport;
  readonly result?: PassResult<TypedBlocks>;
  readonly rejected?: string;
}

/**
 * Run a named pipeline (or a list of pass names), checking each changed revision against `origin` with the
 * optimization contract, as Compiler Workbench's `p.pipeline(x)` does with checkEach. A rejected pass leaves the
 * program as it was and is reported; the pipeline continues.
 */
export async function runPipeline(
  origin: Artifact<TypedBlocks>,
  pipeline: string | readonly string[],
  options: {
    manager: AnalysisManager;
    inputs?: ProgramInputs;
    count?: number;
    seed?: number;
    /** The step limit of each case of the meaning check (default the check's 2e4 statements). */
    limit?: number;
    /** Check only from these entry functions (a project's `entries`); default every function. */
    roots?: readonly string[];
    start?: Artifact<TypedBlocks>;
  },
): Promise<{ artifact: Artifact<TypedBlocks>; steps: PipelineStep[] }> {
  const names = typeof pipeline === 'string' ? PIPELINES[pipeline] : pipeline;
  if (!names)
    throw new Error(
      `unknownPipeline: no pipeline "${pipeline}"; pipelines: ${Object.keys(PIPELINES).join(', ')}`,
    );
  const contract = optimizationContract({
    inputs: options.inputs ?? {},
    count: options.count ?? 40,
    seed: options.seed ?? 7,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.roots ? { roots: options.roots } : {}),
  });
  let cur = options.start ?? origin;
  const steps: PipelineStep[] = [];
  for (const name of names) {
    const pass = PASSES[name];
    if (!pass) throw new Error(`unknownPass: no pass named "${name}"`);
    try {
      const r = await applyPass(pass, cur, {
        manager: options.manager,
        contract,
        contractInputs: { origin },
      });
      steps.push({
        pass: name,
        changed: r.changed,
        rev: r.artifact.value.rev,
        edits: r.edits,
        report: r.report as RevisionReport,
        result: r,
      });
      cur = r.artifact;
    } catch (e) {
      if ((e as { code?: string }).code !== 'contractRejected') throw e;
      steps.push({
        pass: name,
        changed: false,
        rev: cur.value.rev,
        edits: 0,
        rejected: (e as Error).message,
      });
    }
  }
  return { artifact: cur, steps };
}
