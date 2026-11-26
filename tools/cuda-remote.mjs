// Compile and run a CUDA program over SSH and fetch its out/ directory.
//
//   node tools/cuda-remote.mjs <dir> [--timed] [--host user@host] [--arch sm_121]
//       [--input relative/path ...] [-- program args...]
//
// main.cu and any auxiliary files are uploaded to a private working directory on the host.
// --input marks a runtime file to upload without hashing it into the executable's cache key.
// The shared cache keys on the compile files, nvcc path and version, and -O3 -arch=<arch>.
// --timed locks the GPU during execution against other timed jobs. Untimed runs do not wait.
// Prints JSON with host, hash, compiled, compileMs, runMs, exit, stdout, stderr, and outputs.
// CUDA_REMOTE_HOST defaults to manuel@bling. CUDA_REMOTE_NVCC defaults to /usr/local/cuda-13.0/bin/nvcc.
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const argv = process.argv.slice(2);
let host = process.env.CUDA_REMOTE_HOST ?? 'manuel@bling';
let arch = 'sm_121';
const nvcc = process.env.CUDA_REMOTE_NVCC ?? '/usr/local/cuda-13.0/bin/nvcc';
const inputs = new Set();
let dir,
  timed = false,
  progArgs = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--') {
    progArgs = argv.slice(i + 1);
    break;
  }
  if (arg === '--timed') {
    timed = true;
  } else if (['--host', '--arch', '--input'].includes(arg)) {
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw Error('Expected a value for ' + arg);
    if (arg === '--host') host = value;
    else if (arg === '--arch') arch = value;
    else inputs.add(value);
  } else if (!arg.startsWith('-') && !dir) {
    dir = arg;
  } else {
    throw Error('Unexpected argument: ' + arg);
  }
}
if (!dir)
  throw Error(
    'usage: node tools/cuda-remote.mjs <dir> [--timed] [--host h] [--arch a] [--input file] [-- args]',
  );

function listFiles(root, d = root) {
  const files = [];
  for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(d, entry.name);
    const rel = relative(root, path);
    if (rel === 'out' && d === dir) continue;
    if (entry.isDirectory()) files.push(...listFiles(root, path));
    else if (entry.isFile()) files.push(rel);
    else throw Error('Expected a regular file or directory: ' + path);
  }
  return files;
}
const files = listFiles(dir);
if (!files.includes('main.cu') || inputs.has('main.cu'))
  throw Error('main.cu is required as a compile input');
for (const file of inputs) if (!files.includes(file)) throw Error('Missing runtime input: ' + file);

const flags = ['-O3', '-arch=' + arch];
const key = createHash('sha256').update(JSON.stringify([nvcc, ...flags]));
for (const f of files) {
  if (inputs.has(f)) continue;
  const contents = readFileSync(join(dir, f));
  key.update(JSON.stringify([f, contents.length]) + '\n').update(contents);
}
const hash = key.digest('hex');
const job = 'irwb-cuda/jobs/' + randomUUID();
const ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', host];
const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
const transfer = 1 << 30;

function requireSuccess(proc, stage) {
  if (proc.error) throw proc.error;
  if (proc.status !== 0) throw Error(stage + ': ' + proc.stderr);
  return proc.stdout;
}

const tar = requireSuccess(
  spawnSync('tar', ['-C', dir, '-cf', '-', '--', ...files], { maxBuffer: transfer }),
  'tar',
);
try {
  requireSuccess(
    spawnSync('ssh', [...ssh, 'mkdir -p ~/' + job + ' && tar -C ~/' + job + ' -xf -'], { input: tar }),
    'SSH upload',
  );
  const lock = timed ? 'flock ~/irwb-cuda/.gpu.lock ' : '';
  const script = [
    'set -e -o pipefail',
    'cd ~/' + job,
    'compiler=$(' + q(nvcc) + ' --version | sha256sum)',
    'cache=~/irwb-cuda/compile/' + hash + '/${compiler%% *}',
    'mkdir -p "$cache" out',
    'c0=$(date +%s%N)',
    'compiled=0',
    'exec 9>"$cache/.lock"',
    'flock -x 9',
    'if [ ! -x "$cache/prog" ]; then',
    '  ' + [nvcc, ...flags].map(q).join(' ') + ' -o candidate main.cu || exit 97',
    '  mv candidate "$cache/prog"',
    '  compiled=1',
    'fi',
    'exec 9>&-',
    'c1=$(date +%s%N)',
    'r0=$c1',
    lock + '"$cache/prog" ' + progArgs.map(q).join(' ') + ' && status=0 || status=$?',
    'r1=$(date +%s%N)',
    'echo "@@meta $compiled $(( (c1 - c0) / 1000000 )) $(( (r1 - r0) / 1000000 )) $status"',
  ].join('\n');
  const run = spawnSync('ssh', [...ssh, 'bash -s'], { input: script, maxBuffer: 1 << 28, encoding: 'utf8' });
  if (run.error) throw run.error;
  const meta = /^@@meta (\d) (\d+) (\d+) (\d+)$/m.exec(run.stdout ?? '');
  const result = {
    host,
    hash: hash.slice(0, 16),
    compiled: meta ? meta[1] === '1' : false,
    compileMs: meta ? Number(meta[2]) : null,
    runMs: meta ? Number(meta[3]) : null,
    exit: meta ? Number(meta[4]) : run.status || 1,
    stdout: (run.stdout ?? '').replace(/^@@meta[^\n]*\n?/m, ''),
    stderr: run.stderr ?? '',
    outputs: [],
  };
  if (result.exit === 0) {
    const archive = requireSuccess(
      spawnSync('ssh', [...ssh, 'tar -C ~/' + job + '/out -cf - .'], { maxBuffer: transfer }),
      'SSH result fetch',
    );
    const output = join(dir, 'out');
    mkdirSync(output, { recursive: true });
    requireSuccess(spawnSync('tar', ['-C', output, '-xf', '-'], { input: archive }), 'Extract results');
    result.outputs = listFiles(output).sort();
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.exit !== 0) process.exitCode = 1;
} finally {
  spawnSync('ssh', [...ssh, 'rm -rf -- ~/' + job], { stdio: 'ignore' });
}
