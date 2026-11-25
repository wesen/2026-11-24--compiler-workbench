import type { Artifact } from '../framework/core/types.js';
import type { DatabaseSnapshot } from '../framework/core/records.js';
import type { ContractSnapshot } from '../framework/contracts/index.js';
import type {
  AdapterDescriptor,
  ChangeSet,
  EntityCorrespondence,
  IRGraph,
  TransformationResult,
} from '../framework/ir/types.js';
import type { MatchExplanation, PatternDescriptor, PatternMatch } from '../framework/ir/patterns.js';
import type { RewriteStep } from '../framework/ir/rewrites.js';
import type { StrategyExecution, StrategyPlan } from '../framework/strategy/index.js';
export type IRLabDomain = 'expressions' | 'scenes' | 'meshes' | 'constraints';
export interface IRLabDescriptor {
  id: IRLabDomain;
  label: string;
  description: string;
  sourcePaths: readonly string[];
}
export interface IRLabOptions {
  meshTolerance?: number;
  source?: unknown;
  warm?: boolean;
}
export interface IRLabQuery {
  id: string;
  label: string;
  request: unknown;
  result: unknown;
}
export interface IRLabPattern {
  id: string;
  label: string;
  pattern: PatternDescriptor;
  matches: readonly PatternMatch[];
  explanation: MatchExplanation;
}
export interface IRLabRewrite {
  id: string;
  label: string;
  invocationId: string;
  rule?: unknown;
  trace?: {
    status: string;
    applications: number;
    attempts: number;
    steps: readonly RewriteStep[];
  };
  result?: TransformationResult;
}
export interface IRLabResult {
  domain: IRLabDomain;
  label: string;
  sourcePaths: readonly string[];
  before: Artifact;
  after: Artifact;
  artifacts: readonly Artifact[];
  beforeGraph: IRGraph;
  afterGraph: IRGraph;
  adapter: AdapterDescriptor;
  queries: readonly IRLabQuery[];
  patterns: readonly IRLabPattern[];
  rewrites: readonly IRLabRewrite[];
  changes: readonly ChangeSet[];
  correspondence: readonly EntityCorrespondence[];
  contracts: ContractSnapshot;
  strategy: {
    plan: StrategyPlan;
    trace: StrategyExecution;
  };
  snapshot: DatabaseSnapshot;
  runId: string;
  finalTask: string;
  summary: Readonly<Record<string, unknown>>;
}
