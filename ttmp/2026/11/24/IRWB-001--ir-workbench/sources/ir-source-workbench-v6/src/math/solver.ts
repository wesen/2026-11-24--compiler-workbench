import { assert, positive } from '../core/types.js';
import { evaluateTape, validateNumericTape, type NumericTape } from './expressions.js';

export interface SolverOptions {
  tolerance?: number;
  maxIterations?: number;
  initialDamping?: number;
  rankTolerance?: number;
}
export interface SolverCheckpoint { iteration: number; residualNorm: number; damping: number; accepted: boolean; stepNorm: number }
export interface SolverResult {
  status: 'converged' | 'rank-deficient' | 'stalled' | 'iteration-limit';
  values: Record<string, number>;
  residualNorm: number;
  iterations: number;
  rank: number;
  evaluations: number;
  /** Tape arithmetic only; excludes linear algebra and control overhead. */
  operationCount: number;
  checkpoints: SolverCheckpoint[];
}

export function euclideanNorm(values: readonly number[]): number { return Math.hypot(...values); }

/** Column-pivoted modified Gram-Schmidt with reorthogonalization, for a rank diagnostic. */
export function matrixRank(matrix: readonly (readonly number[])[], tolerance = 1e-10): number {
  if (!matrix.length || !matrix[0].length) return 0;
  const m = matrix.length, n = matrix[0].length;
  assert(matrix.every(row => row.length === n && row.every(Number.isFinite)), 'Malformed matrix');
  const columns = Array.from({ length: n }, (_, j) => matrix.map(row => row[j]));
  const reference = Math.max(...columns.map(euclideanNorm));
  if (reference === 0) return 0;
  let rank = 0;
  for (let k = 0; k < Math.min(m, n); k++) {
    let best = k;
    for (let j = k + 1; j < n; j++) if (euclideanNorm(columns[j]) > euclideanNorm(columns[best])) best = j;
    [columns[k], columns[best]] = [columns[best], columns[k]];
    const length = euclideanNorm(columns[k]);
    if (length <= tolerance * reference) break;
    const q = columns[k].map(v => v / length);
    rank++;
    for (let j = k + 1; j < n; j++) {
      for (let repeat = 0; repeat < 2; repeat++) {
        const projection = q.reduce((s, v, i) => s + v * columns[j][i], 0);
        for (let i = 0; i < m; i++) columns[j][i] -= projection * q[i];
      }
    }
  }
  return rank;
}

/** Householder QR solves the augmented LM system without forming J^T J. */
function qrLeastSquares(matrix: number[][], rhs: number[]): number[] {
  const a = matrix.map(row => [...row]), b = [...rhs];
  const m = a.length, n = a[0].length;
  assert(m >= n, 'Least squares system must have enough rows');
  for (let k = 0; k < n; k++) {
    const norm = Math.hypot(...a.slice(k).map(row => row[k]));
    if (norm === 0) throw new Error('Singular damped least squares system');
    const sign = a[k][k] >= 0 ? 1 : -1;
    const v = a.slice(k).map(row => row[k]);
    v[0] += sign * norm;
    const vNorm = euclideanNorm(v);
    for (let i = 0; i < v.length; i++) v[i] /= vNorm;
    for (let j = k; j < n; j++) {
      let dot = 0;
      for (let i = k; i < m; i++) dot += v[i - k] * a[i][j];
      for (let i = k; i < m; i++) a[i][j] -= 2 * v[i - k] * dot;
    }
    let dot = 0;
    for (let i = k; i < m; i++) dot += v[i - k] * b[i];
    for (let i = k; i < m; i++) b[i] -= 2 * v[i - k] * dot;
  }
  const result = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let rhsValue = b[i];
    for (let j = i + 1; j < n; j++) rhsValue -= a[i][j] * result[j];
    result[i] = rhsValue / a[i][i];
  }
  assert(result.every(Number.isFinite), 'Non-finite least squares step');
  return result;
}

/** Deterministic damped least squares. Initial guesses and tolerances are explicit inputs. */
export function solveLeastSquares(tape: NumericTape, initial: Readonly<Record<string, number>>, options: SolverOptions = {}): SolverResult {
  validateNumericTape(tape);
  const tolerance = options.tolerance ?? 1e-10;
  const maxIterations = options.maxIterations ?? 100;
  const rankTolerance = options.rankTolerance ?? 1e-10;
  let damping = options.initialDamping ?? 1e-4;
  positive(tolerance, 'Solver tolerance'); positive(damping, 'Initial damping'); positive(rankTolerance, 'Rank tolerance');
  assert(Number.isInteger(maxIterations) && maxIterations > 0 && maxIterations <= 10000, 'maxIterations must be an integer in [1, 10000]');
  let values = { ...initial };
  let current = evaluateTape(tape, values), norm = euclideanNorm(current.residuals);
  let operationCount = current.scalarOperations, evaluations = 1, iterations = 0;
  const checkpoints: SolverCheckpoint[] = [];
  const finish = (status: SolverResult['status']): SolverResult => {
    const rank = matrixRank(current.jacobian, rankTolerance);
    if (status === 'converged' && rank < tape.variables.length) status = 'rank-deficient';
    return { status, values, residualNorm: norm, iterations, rank, evaluations, operationCount, checkpoints };
  };
  if (norm <= tolerance) return finish('converged');
  for (iterations = 0; iterations < maxIterations; iterations++) {
    const n = tape.variables.length;
    const columnScales = Array.from({ length: n }, (_, j) => Math.max(1e-6, Math.hypot(...current.jacobian.map(row => row[j]))));
    let accepted = false;
    for (let attempt = 0; attempt < 16; attempt++) {
      const augmented = current.jacobian.map(row => [...row]);
      for (let j = 0; j < n; j++) augmented.push(Array.from({ length: n }, (_, k) => j === k ? Math.sqrt(damping) * columnScales[j] : 0));
      const step = qrLeastSquares(augmented, [...current.residuals.map(r => -r), ...new Array<number>(n).fill(0)]);
      const candidate = { ...values };
      tape.variables.forEach((name, j) => { candidate[name] += step[j]; });
      const trial = evaluateTape(tape, candidate);
      evaluations++; operationCount += trial.scalarOperations;
      const trialNorm = euclideanNorm(trial.residuals), stepNorm = euclideanNorm(step);
      accepted = trialNorm < norm;
      checkpoints.push({ iteration: iterations + 1, residualNorm: trialNorm, damping, accepted, stepNorm });
      if (accepted) {
        values = candidate; current = trial; norm = trialNorm;
        damping = Math.max(damping / 3, 1e-14);
        break;
      }
      damping *= 10;
      if (damping > 1e16) break;
    }
    if (norm <= tolerance) { iterations++; return finish('converged'); }
    if (!accepted) { iterations++; return finish(matrixRank(current.jacobian, rankTolerance) < tape.variables.length ? 'rank-deficient' : 'stalled'); }
  }
  return finish('iteration-limit');
}
