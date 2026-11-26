// Compile and run a CUDA program on the GPU machine over SSH, and bring its outputs back.
//
//   node tools/cuda-remote.mjs <dir> [--source-only] [--timed] [--host user@host] [--arch sm_121] [-- program args...]
//
// <dir> holds main.cu and any input files. Each invocation gets a private remote working directory.
// By default, the compilation cache keys on all files except out/. With --source-only, main.cu must be a
// standalone translation unit, and only its contents are used from the bundle. The key also includes
// the architecture, compiler flags, and remote nvcc identity. The compiler is invoked as
// `nvcc -O3 -arch=<arch> -o <temporary executable> main.cu` on a miss.
// Files the program writes under out/ are copied back to <dir>/out/.
// --timed takes an exclusive flock on ~/irwb-cuda/.gpu.lock while the program runs. Untimed runs do not wait.
// Prints one JSON object: { host, hash, compiled, compileMs, runMs, exit, stdout, stderr, outputs }.
// Environment: CUDA_REMOTE_HOST (default manuel@bling), CUDA_REMOTE_NVCC (default /usr/local/cuda-13.0/bin/nvcc).
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const opts = sep < 0 ? argv : argv.slice(0, sep);
const progArgs = sep < 0 ? [] : argv.slice(sep + 1);
const value = (name, fallback) => (opts.includes(name) ? opts[opts.indexOf(name) + 1] : fallback);
const dir = opts.find((arg, i) => !arg.startsWith('--') && !['--host', '--arch'].includes(opts[i - 1]));
if (!dir)
  throw new Error(
    'usage: node tools/cuda-remote.mjs <dir> [--source-only] [--timed] [--host h] [--arch a] [-- args]',
  );
const host = value('--host', process.env.CUDA_REMOTE_HOST ?? 'manuel@bling');
const arch = value('--arch', 'sm_121');
const nvcc = process.env.CUDA_REMOTE_NVCC ?? '/usr/local/cuda-13.0/bin/nvcc';

function filesIn(root, excludeOutput = false) {
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      const name = relative(root, path);
      if (excludeOutput && name === 'out') continue;
      if (entry.isDirectory()) walk(path);
      else files.push(name);
    }
  }
  walk(root);
  return files;
}

const files = filesIn(dir, true);
if (!files.includes('main.cu')) throw new Error(`${dir}: no main.cu`);
const compileFiles = opts.includes('--source-only') ? ['main.cu'] : files;
const digest = createHash('sha256').update(JSON.stringify([arch, '-O3', nvcc]));
for (const file of compileFiles) {
  const content = readFileSync(join(dir, file));
  digest.update(JSON.stringify([file, content.length])).update(content);
}
const hash = digest.digest('hex').slice(0, 16);
const remote = `irwb-cuda/runs/${randomUUID()}`;
const ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', host];
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const maxBuffer = 1 << 30;

function checked(phase, command, args, options = {}) {
  const child = spawnSync(command, args, { maxBuffer, ...options });
  if (child.error || child.status !== 0) {
    const diagnostic = child.error?.message || child.stderr?.toString().trim() || `exit ${child.status}`;
    throw new Error(`${phase}: ${diagnostic}`);
  }
  return child;
}

const result = {
  host,
  hash,
  compiled: false,
  compileMs: null,
  runMs: null,
  exit: 1,
  stdout: '',
  stderr: '',
  outputs: [],
};
let staged = false;
try {
  const bundle = checked('pack inputs', 'tar', ['-C', dir, '-cf', '-', '--', ...files]).stdout;
  staged = true;
  checked('copy inputs', 'ssh', [...ssh, `mkdir -p ~/${remote} && tar -C ~/${remote} -xf -`], {
    input: bundle,
  });
  const lock = opts.includes('--timed') ? 'flock ~/irwb-cuda/.gpu.lock' : '';
  const script = [
    'set -eu',
    `cd ~/${remote}`,
    'mkdir -p ~/irwb-cuda/builds out',
    'c0=$(date +%s%N)',
    `compiler=$(${q(nvcc)} --version)`,
    'compiler_key=$(printf "%s" "$compiler" | sha256sum | cut -d " " -f 1)',
    `prog=~/irwb-cuda/builds/${hash}-$compiler_key`,
    'compiled=$(',
    '  set -e',
    '  exec 9>"$prog.lock"',
    '  flock 9',
    '  if [ ! -x "$prog" ]; then',
    '    tmp=$(mktemp "$prog.XXXXXXXX")',
    '    trap \'rm -f "$tmp"\' EXIT',
    `    ${q(nvcc)} -O3 ${q('-arch=' + arch)} -o "$tmp" main.cu >&2`,
    '    mv "$tmp" "$prog"',
    '    echo 1',
    '  else',
    '    echo 0',
    '  fi',
    ')',
    'c1=$(date +%s%N); r0=$(date +%s%N)',
    'status=0',
    `${lock} "$prog" ${progArgs.map(q).join(' ')} || status=$?`,
    'r1=$(date +%s%N)',
    'echo "@@meta $compiled $(( (c1 - c0) / 1000000 )) $(( (r1 - r0) / 1000000 )) $status"',
  ].join('\n');
  const run = checked('remote build or execution', 'ssh', [...ssh, 'bash -s'], {
    input: script,
    encoding: 'utf8',
  });
  const meta = /@@meta (\d) (\d+) (\d+) (\d+)\n?$/.exec(run.stdout);
  if (!meta) throw new Error('remote execution: missing status');
  Object.assign(result, {
    compiled: meta[1] === '1',
    compileMs: Number(meta[2]),
    runMs: Number(meta[3]),
    exit: Number(meta[4]),
    stdout: run.stdout.slice(0, meta.index),
    stderr: run.stderr,
  });
  if (result.exit === 0) {
    const out = join(dir, 'out');
    const archive = checked('fetch outputs', 'ssh', [...ssh, `tar -C ~/${remote}/out -cf - .`]).stdout;
    mkdirSync(out, { recursive: true });
    checked('extract outputs', 'tar', ['-C', out, '-xf', '-'], { input: archive });
    result.outputs = filesIn(out);
  }
} catch (error) {
  result.exit = 1;
  result.stderr += error.message;
} finally {
  if (staged) {
    const cleanup = spawnSync('ssh', [...ssh, `rm -rf ~/${remote}`], { encoding: 'utf8' });
    if (cleanup.status !== 0)
      process.stderr.write(`clean remote run: ${cleanup.error?.message ?? cleanup.stderr}\n`);
  }
}
process.stdout.write(JSON.stringify(result) + '\n');
if (result.exit !== 0) process.exitCode = 1;
