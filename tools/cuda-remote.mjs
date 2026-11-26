// Compile and run a CUDA program on the GPU machine over ssh, and bring its outputs back.
//
//   node tools/cuda-remote.mjs <dir> [--timed] [--host user@host] [--arch sm_121]
//                            [--runtime-dir inputs] [-- program args...]
//
// <dir> holds main.cu and input files. Each call uploads its files to a private temporary working directory
// under <host>:~/irwb-cuda/ and fetches that run's out/ into <dir>/out/. Use a separate local <dir> per call.
// `nvcc -O3 -arch=<arch> -o prog main.cu` is cached by input files and compiler configuration/version.
// --runtime-dir names one top-level data-only directory to exclude from that key (still uploaded every run).
// Never put compiler inputs there. By default all files except out/ participate in the key.
// --timed exclusively locks the GPU (flock ~/irwb-cuda/.gpu.lock) for ./prog only; untimed runs do not wait.
// Prints one JSON object: { host, hash, compiled, compileMs, runMs, exit, stdout, stderr, outputs }.
// Environment: CUDA_REMOTE_HOST (default manuel@bling), CUDA_REMOTE_NVCC (default /usr/local/cuda-13.0/bin/nvcc).
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const opts = sep < 0 ? argv : argv.slice(0, sep);
const progArgs = sep < 0 ? [] : argv.slice(sep + 1);
const flags = new Map();
let dir;
for (let i = 0; i < opts.length; i++) {
  const a = opts[i];
  if (a === '--timed') flags.set(a, true);
  else if (['--host', '--arch', '--runtime-dir'].includes(a) && opts[i + 1] && !opts[i + 1].startsWith('--'))
    flags.set(a, opts[++i]);
  else if (!a.startsWith('-') && !dir) dir = a;
  else throw Error(`Unexpected argument ${a}`);
}
if (!dir)
  throw Error(
    'usage: node tools/cuda-remote.mjs <dir> [--timed] [--host h] [--arch a] [--runtime-dir d] [-- args]',
  );
const host = flags.get('--host') ?? process.env.CUDA_REMOTE_HOST ?? 'manuel@bling';
const arch = flags.get('--arch') ?? 'sm_121';
const nvcc = process.env.CUDA_REMOTE_NVCC ?? '/usr/local/cuda-13.0/bin/nvcc';
const runtime = flags.get('--runtime-dir');
if (runtime && (!/^[\w.-]+$/.test(runtime) || ['.', '..', 'out', 'main.cu'].includes(runtime)))
  throw Error('--runtime-dir must name a top-level data directory');
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const sha = data => createHash('sha256').update(data).digest('hex');
const walk = (root, skipOut = false) => {
  const files = [];
  function visit(d) {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      const name = relative(root, p);
      if (skipOut && name === 'out') continue;
      if (e.isDirectory()) visit(p);
      else if (e.isFile()) files.push(name);
      else throw Error(`Expected regular file or directory: ${p}`);
    }
  }
  visit(root);
  return files.sort();
};
const files = walk(dir, true);
if (!files.includes('main.cu')) throw Error(`${dir}: no main.cu`);
if (runtime && files.includes(runtime)) throw Error(`Expected a directory: ${runtime}`);
const profile = ['-O3', `-arch=${arch}`];
const inputsHash = sha(
  JSON.stringify([
    nvcc,
    profile,
    files
      .filter(f => !runtime || !f.startsWith(`${runtime}/`))
      .map(f => [f, sha(readFileSync(join(dir, f)))]),
  ]),
);
const remote = `irwb-cuda/run-${randomUUID()}`;
const cache = 'irwb-cuda/build-v2';
const ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', host];
const lock = flags.has('--timed') ? 'flock ~/irwb-cuda/.gpu.lock' : '';
const maxBytes = 1 << 30;

const tar = execFileSync('tar', ['-C', dir, '-cf', '-', '--', ...files], { maxBuffer: maxBytes });
const out = join(dir, 'out');
rmSync(out, { recursive: true, force: true });
try {
  execFileSync('ssh', [...ssh, `mkdir -p ~/irwb-cuda && mkdir ~/${remote} && tar -C ~/${remote} -xf -`], {
    input: tar,
  });
  // Resolve the compiler version before looking up an executable. A failed build never installs a cache entry.
  const script = [
    'set -e',
    `cd ~/${remote}`,
    'c0=$(date +%s%N); compiled=0',
    `nvcc_version=$(${q(nvcc)} --version)`,
    `read -r hash _ <<< "$(printf '%s\\n%s' ${q(inputsHash)} "$nvcc_version" | sha256sum)"`,
    `build=~/${cache}/$hash`,
    'mkdir -p "$build"',
    'exec 9>"$build/lock"; flock 9',
    'if [ ! -x "$build/prog" ]; then',
    `  ${q(nvcc)} ${profile.map(q).join(' ')} -o prog main.cu || { echo "@@compile-failed"; exit 97; }`,
    '  mv prog "$build/prog"; compiled=1',
    'fi',
    'exec 9>&-',
    'ln "$build/prog" prog',
    'c1=$(date +%s%N); mkdir out',
    `r0=$(date +%s%N); status=0; ${lock} ./prog ${progArgs.map(q).join(' ')} || status=$?; r1=$(date +%s%N)`,
    `echo "@@meta $hash $compiled $(( (c1 - c0) / 1000000 )) $(( (r1 - r0) / 1000000 )) $status"`,
  ].join('\n');
  const run = spawnSync('ssh', [...ssh, 'bash -s'], { input: script, maxBuffer: 1 << 28, encoding: 'utf8' });
  if (run.error) throw run.error;
  const meta = /@@meta ([a-f0-9]{64}) (\d) (\d+) (\d+) (\d+)\s*$/.exec(run.stdout ?? '');
  const result = {
    host,
    hash: (meta?.[1] ?? inputsHash).slice(0, 16),
    compiled: meta?.[2] === '1',
    compileMs: meta ? Number(meta[3]) : null,
    runMs: meta ? Number(meta[4]) : null,
    exit: meta ? Number(meta[5]) : run.status || 1,
    stdout: (run.stdout ?? '').replace(/@@meta [^\n]*\n?$/, '').replace(/@@compile-failed\n?/, ''),
    stderr: run.stderr ?? '',
    outputs: [],
  };
  if (meta) {
    try {
      const archive = execFileSync('ssh', [...ssh, `tar -C ~/${remote}/out -cf - .`], {
        maxBuffer: maxBytes,
      });
      mkdirSync(out);
      execFileSync('tar', ['-C', out, '-xm', '-f', '-'], { input: archive });
      result.outputs = walk(out);
    } catch (error) {
      rmSync(out, { recursive: true, force: true });
      result.exit ||= 1;
      result.stderr += `\nFetching out/: ${error.message}`;
    }
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.exit !== 0) process.exitCode = 1;
} finally {
  const cleanup = spawnSync('ssh', [...ssh, `rm -rf ~/${remote}`], { encoding: 'utf8' });
  if (cleanup.status !== 0)
    process.stderr.write(`Remote cleanup failed: ${cleanup.stderr ?? cleanup.error}\n`);
}
