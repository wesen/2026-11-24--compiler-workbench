/**
 * The backend's refusals, with Compiler Workbench's error codes (`WB.fail(code, message, { fix })`): a malformed
 * option, an operation no tile covers, a frame or branch that does not fit its encoding, an internal inconsistency.
 */
export type BackendErrorCode =
  | 'unknownOption'
  | 'badArgument'
  | 'unsupported'
  | 'frameTooLarge'
  | 'branchRange'
  | 'internal'
  | 'noEmulator'
  | 'unknownFunction'
  | 'wrongSource';

export class BackendError extends Error {
  constructor(
    readonly code: BackendErrorCode,
    message: string,
    readonly fix?: string,
  ) {
    super(`[${code}] ${message}` + (fix ? `\n  fix: ${fix}` : ''));
    this.name = 'BackendError';
  }
}

export function fail(code: BackendErrorCode, message: string, fix?: string): never {
  throw new BackendError(code, message, fix);
}

function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** The nearest option name, if it is close enough to be a likely typo (Compiler Workbench's `didYouMean`). */
export function didYouMean(name: string, options: readonly string[]): string | null {
  let best: string | null = null,
    score = Infinity;
  for (const o of options) {
    const s = editDistance(name.toLowerCase(), o.toLowerCase());
    if (s < score) {
      score = s;
      best = o;
    }
  }
  return best && score <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
}
