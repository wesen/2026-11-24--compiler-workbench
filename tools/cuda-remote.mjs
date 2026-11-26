// Compile and run a CUDA program on the GPU machine over ssh, and bring its outputs back.
//
//   node tools/cuda-remote.mjs <dir> [--timed] [--host user@host] [--arch sm_121] [-- program args...]
//
// <dir> holds main.cu and any input files. A private remote working directory is removed after the fetch.
// The executable is shared under a build lock keyed by the compiler path/version, flags and all file bytes.
// Compile: `nvcc -O3 -arch=<arch> -o prog main.cu`. Files written under out/ are copied to <dir>/out/.
// --timed takes an exclusive lock on the GPU (flock ~/irwb-cuda/.gpu.lock) for the run, so that concurrent users do
// not disturb each other's timings; untimed runs do not wait for it.
// Prints one JSON object: { host, arch, nvcc, nvccVersion, flags, hash, compiled, compileMs, runMs, exit, stdout, stderr, outputs }.
// Environment: CUDA_REMOTE_HOST (default manuel@bling, the Tailscale name; bling.local resolves only on the home
// LAN), CUDA_REMOTE_NVCC (default /usr/local/cuda-13.0/bin/nvcc).
// Inside the Codex sandbox, ssh needs network access (-c sandbox_workspace_write.network_access=true).
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const opts = sep < 0 ? argv : argv.slice(0, sep),
  progArgs = sep < 0 ? [] : argv.slice(sep + 1);
const flag = name => opts.includes(name);
const value = (name, d) => (opts.includes(name) ? opts[opts.indexOf(name) + 1] : d);
const dir = opts.find((a, i) => !a.startsWith('--') && !['--host', '--arch'].includes(opts[i - 1]));
if (!dir)
  throw new Error('usage: node tools/cuda-remote.mjs <dir> [--timed] [--host h] [--arch a] [-- args]');
const host = value('--host', process.env.CUDA_REMOTE_HOST ?? 'manuel@bling');
const arch = value('--arch', 'sm_121');
const nvcc = process.env.CUDA_REMOTE_NVCC ?? '/usr/local/cuda-13.0/bin/nvcc';

const files = [];
const walk = d => {
  for (const e of readdirSync(d).sort()) {
    const p = join(d, e);
    if (relative(dir, p) === 'out') continue;
    statSync(p).isDirectory() ? walk(p) : files.push(relative(dir, p));
  }
};
walk(dir);
if (!files.includes('main.cu')) throw new Error(`${dir}: no main.cu`);
const remote = `irwb-cuda/run-${randomUUID()}`;
if (host.startsWith('-')) throw new Error('Invalid host');
const flags = ['-O3', `-arch=${arch}`];
const ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host];
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

// copy the files (tar over ssh: one round trip, no rsync needed on either side)
const tar = spawnSync('tar', ['-C', dir, '-cf', '-', ...files], { maxBuffer: 1 << 30 });
if (tar.status !== 0) throw new Error(`tar: ${tar.stderr}`);
try {
  const put = spawnSync(
    'ssh',
    [
      ...ssh,
      `umask 077; mkdir -p ~/irwb-cuda && mkdir ~/${remote} && tar -C ~/${remote} -xf - && ${q(nvcc)} --version`,
    ],
    {
      input: tar.stdout,
      encoding: 'utf8',
    },
  );
  if (put.status !== 0) throw new Error(`ssh copy: ${put.stderr}`);
  const nvccVersion = put.stdout.trim();
  const h = createHash('sha256');
  const frame = bytes => {
    h.update(`${bytes.length}:`).update(bytes);
  };
  frame(Buffer.from(JSON.stringify([nvcc, nvccVersion, flags])));
  for (const f of files) {
    frame(Buffer.from(f));
    frame(readFileSync(join(dir, f)));
  }
  const hash = h.digest('hex');
  const build = `irwb-cuda/build-${hash}`;

  // compile if needed, then run; timings measured on the remote side
  const lock = flag('--timed') ? 'flock ~/irwb-cuda/.gpu.lock' : '';
  const script = [
    `set -e; cd ~/${remote}`,
    `mkdir -p ~/${build}; exec 9>~/${build}/.lock; flock 9`,
    `compiled=0; c0=$(date +%s%N)`,
    `if [ ! -x ~/${build}/prog ]; then ${q(nvcc)} ${flags.map(q).join(' ')} -o prog main.cu 2> compile.err || { echo "@@compile-failed"; cat compile.err >&2; exit 97; }; mv prog ~/${build}/prog; compiled=1; fi`,
    `flock -u 9; ln -s ~/${build}/prog prog`,
    `c1=$(date +%s%N); rm -rf out; mkdir -p out`,
    `set +e; r0=$(date +%s%N); ${lock} ./prog ${progArgs.map(q).join(' ')}; status=$?; r1=$(date +%s%N)`,
    `echo "@@meta $compiled $(( (c1 - c0) / 1000000 )) $(( (r1 - r0) / 1000000 )) $status"`,
    `exit 0`,
  ].join('\n');
  const run = spawnSync('ssh', [...ssh, 'bash -s'], { input: script, maxBuffer: 1 << 28, encoding: 'utf8' });
  const meta = /@@meta (\d) (\d+) (\d+) (\d+)/.exec(run.stdout ?? '');
  const stdout = (run.stdout ?? '').replace(/@@meta.*\n?/, '').replace(/@@compile-failed\n?/, '');
  const result = {
    host,
    arch,
    nvcc,
    nvccVersion,
    flags,
    hash,
    compiled: meta ? meta[1] === '1' : false,
    compileMs: meta ? Number(meta[2]) : null,
    runMs: meta ? Number(meta[3]) : null,
    exit: meta ? Number(meta[4]) : run.status,
    stdout,
    stderr: run.stderr ?? '',
    outputs: [],
  };

  // fetch out/
  if (meta) {
    const get = spawnSync('ssh', [...ssh, `tar -C ~/${remote}/out -cf - .`], { maxBuffer: 1 << 30 });
    if (get.status !== 0 || !get.stdout.length) throw new Error(`ssh fetch: ${get.stderr}`);
    {
      mkdirSync(join(dir, 'out'), { recursive: true });
      execFileSync('tar', ['-C', join(dir, 'out'), '-xf', '-'], { input: get.stdout });
      const outs = [];
      const w2 = d => {
        for (const e of readdirSync(d)) {
          const p = join(d, e);
          statSync(p).isDirectory() ? w2(p) : outs.push(relative(join(dir, 'out'), p));
        }
      };
      w2(join(dir, 'out'));
      result.outputs = outs.sort();
    }
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.exit !== 0) process.exitCode = 1;
} finally {
  spawnSync('ssh', [...ssh, `rm -rf ~/${remote}`]);
}
