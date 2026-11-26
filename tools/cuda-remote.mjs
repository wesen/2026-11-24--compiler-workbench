// Compile and run a CUDA program on the GPU machine over ssh, and bring its outputs back.
//
//   node tools/cuda-remote.mjs <dir> [--timed] [--host user@host] [--arch sm_121] [--cache-main] [-- args...]
//
// <dir> holds main.cu and any input files. Each invocation stages files in a fresh remote working directory.
// nvcc -O3 -arch=<arch> compiles main.cu; the binary is cached under ~/irwb-cuda/build/<hash>/.
// The key covers compiler path/version, flags, and all staged files (excluding out/). --cache-main opts in
// to hashing only main.cu: use it only for a self-contained translation unit with separate run-time inputs.
// Each build is locked and published by rename. The binary runs from the staging directory, where out/
// is created for it; out/ is fetched before staging is removed. --timed takes the GPU timing lock for
// execution only (untimed invocations do not wait for that lock).
// Prints one JSON object: { host, hash, compiled, compileMs, runMs, exit, stdout, stderr, outputs }.
// Environment: CUDA_REMOTE_HOST (default manuel@bling, the Tailscale name),
// CUDA_REMOTE_NVCC (default /usr/local/cuda-13.0/bin/nvcc).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const opts = sep < 0 ? argv : argv.slice(0, sep);
const progArgs = sep < 0 ? [] : argv.slice(sep + 1);
const flag = name => opts.includes(name);
const value = (name, d) => (opts.includes(name) ? opts[opts.indexOf(name) + 1] : d);
const dir = opts.find((a, i) => !a.startsWith('--') && !['--host', '--arch'].includes(opts[i - 1]));
if (!dir)
  throw new Error(
    'usage: node tools/cuda-remote.mjs <dir> [--timed] [--host h] [--arch a] [--cache-main] [-- args]',
  );
const host = value('--host', process.env.CUDA_REMOTE_HOST ?? 'manuel@bling');
const arch = value('--arch', 'sm_121');
const nvcc = process.env.CUDA_REMOTE_NVCC ?? '/usr/local/cuda-13.0/bin/nvcc';
const flags = ['-O3', `-arch=${arch}`];
const maxBuffer = 1 << 30;
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const ssh = (cmd, options) =>
  spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', host, cmd], {
    maxBuffer,
    ...options,
  });
function successful(result, step) {
  if (result.status !== 0 || result.error)
    throw new Error(`${step}: ${result.error ?? String(result.stderr)}`);
  return result.stdout;
}
function walk(root, skipOut = false, d = root) {
  return readdirSync(d)
    .sort()
    .flatMap(e => {
      const p = join(d, e),
        name = relative(root, p);
      if (skipOut && name === 'out') return [];
      return statSync(p).isDirectory() ? walk(root, skipOut, p) : [name];
    });
}
const files = walk(dir, true);
if (!files.includes('main.cu')) throw new Error(`${dir}: no main.cu`);
const tar = successful(spawnSync('tar', ['-C', dir, '-cf', '-', '--', ...files], { maxBuffer }), 'tar input');
const setup = successful(
  ssh(
    [
      'set -e',
      'cd "$HOME"',
      `${q(nvcc)} --version`,
      'mkdir -p irwb-cuda/runs irwb-cuda/build',
      'mktemp -d irwb-cuda/runs/run.XXXXXXXXXX',
    ].join('\n'),
    { encoding: 'utf8' },
  ),
  'ssh setup',
)
  .trimEnd()
  .split('\n');
const stage = setup.pop();
if (!/^irwb-cuda\/runs\/run\.[a-zA-Z0-9]+$/.test(stage ?? '')) throw new Error('Invalid remote staging path');
try {
  const key = createHash('sha256').update(
    JSON.stringify(['build-v1', nvcc, setup, flags, flag('--cache-main')]),
  );
  for (const f of flag('--cache-main') ? ['main.cu'] : files) {
    const bytes = readFileSync(join(dir, f));
    key.update(JSON.stringify([f, bytes.length])).update(bytes);
  }
  const hash = key.digest('hex');
  successful(ssh(`tar -C ~/${stage} -xf -`, { input: tar }), 'ssh copy');
  const invoke = `${flag('--timed') ? 'flock "$HOME/irwb-cuda/.gpu.lock" ' : ''}"$build/prog" ${progArgs.map(q).join(' ')}`;
  const script = [
    `cd ~/${stage} || exit 98`,
    `build="$HOME/irwb-cuda/build/${hash}"`,
    'mkdir -p "$build" out || exit 98',
    'compiled=0; c0=$(date +%s%N)',
    'exec 9>"$build/lock" && flock 9 || exit 98',
    'if [ ! -x "$build/prog" ]; then',
    '  tmp=$(mktemp "$build/prog.XXXXXXXXXX") || exit 98',
    `  if ! ${q(nvcc)} ${flags.map(q).join(' ')} -o "$tmp" main.cu; then rm -f "$tmp"; exit 97; fi`,
    '  if ! chmod +x "$tmp" || ! mv -f "$tmp" "$build/prog"; then rm -f "$tmp"; exit 98; fi',
    '  compiled=1',
    'fi',
    'exec 9>&-',
    'c1=$(date +%s%N); r0=$(date +%s%N)',
    `${invoke}; status=$?; r1=$(date +%s%N)`,
    'printf "\\n@@meta %s %s %s %s\\n" "$compiled" "$(( (c1 - c0) / 1000000 ))" "$(( (r1 - r0) / 1000000 ))" "$status"',
  ].join('\n');
  const run = ssh('bash -s', { input: script, encoding: 'utf8' });
  const meta = /\n@@meta (\d) (\d+) (\d+) (\d+)\n$/.exec(run.stdout ?? '');
  const result = {
    host,
    hash,
    compiled: meta?.[1] === '1',
    compileMs: meta ? Number(meta[2]) : null,
    runMs: meta ? Number(meta[3]) : null,
    exit: run.status === 0 && meta ? Number(meta[4]) : run.status || 1,
    stdout: meta ? run.stdout.slice(0, meta.index) : (run.stdout ?? ''),
    stderr: run.error ? String(run.error) : (run.stderr ?? ''),
    outputs: [],
  };
  if (meta) {
    try {
      const data = successful(ssh(`tar -C ~/${stage}/out -cf - .`), 'ssh fetch');
      const out = join(dir, 'out');
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      successful(spawnSync('tar', ['-C', out, '-xf', '-'], { input: data, maxBuffer }), 'tar output');
      result.outputs = walk(out).sort();
    } catch (error) {
      result.exit ||= 1;
      result.stderr += `\n${error}`;
    }
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.exit !== 0) process.exitCode = 1;
} finally {
  ssh(`rm -rf -- ~/${stage}`);
}
