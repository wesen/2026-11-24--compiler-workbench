// Compile and run a CUDA program on the GPU machine over ssh, and bring its outputs back.
//
//   node tools/cuda-remote.mjs <dir> [--standalone] [--timed] [--host user@host] [--arch sm_121] [-- args...]
//
// <dir> holds main.cu and any input files. The directory is copied to <host>:~/irwb-cuda/<hash>/, where <hash> is
// the SHA-256 of its files, so identical inputs reuse an earlier compile. There it is compiled with
// `nvcc -O3 -arch=<arch> -o prog main.cu` (skipped when prog already exists) and run as `./prog args...` with the
// directory as its working directory. Files the program writes under out/ are copied back to <dir>/out/.
// --standalone is for a self-contained main.cu (no uploaded compiler dependencies). It uses an isolated
// run directory and a locked executable cache keyed by source, architecture, nvcc path/version and flags.
// --timed takes an exclusive lock on the GPU (flock ~/irwb-cuda/.gpu.lock) for the run, so that concurrent users do
// not disturb each other's timings; untimed runs do not wait for it.
// Prints one JSON object: { host, hash, compiled, compileMs, runMs, exit, stdout, stderr, outputs }.
// Environment: CUDA_REMOTE_HOST (default manuel@bling, the Tailscale name; bling.local resolves only on the home
// LAN), CUDA_REMOTE_NVCC (default /usr/local/cuda-13.0/bin/nvcc).
// Inside the Codex sandbox, ssh needs network access (-c sandbox_workspace_write.network_access=true).
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const opts = sep < 0 ? argv : argv.slice(0, sep),
  progArgs = sep < 0 ? [] : argv.slice(sep + 1);
const flag = name => opts.includes(name);
const value = (name, d) => (opts.includes(name) ? opts[opts.indexOf(name) + 1] : d);
const dir = opts.find((a, i) => !a.startsWith('--') && !['--host', '--arch'].includes(opts[i - 1]));
if (!dir)
  throw new Error(
    'usage: node tools/cuda-remote.mjs <dir> [--standalone] [--timed] [--host h] [--arch a] [-- args]',
  );
const host = value('--host', process.env.CUDA_REMOTE_HOST ?? 'manuel@bling');
const arch = value('--arch', 'sm_121');
const nvcc = process.env.CUDA_REMOTE_NVCC ?? '/usr/local/cuda-13.0/bin/nvcc';
const standalone = flag('--standalone');
if (host.startsWith('-') || !/^[A-Za-z0-9_.-]+$/.test(arch)) throw new Error('Invalid host or architecture');

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
const h = createHash('sha256').update(arch);
for (const f of files)
  h.update(f)
    .update('\0')
    .update(readFileSync(join(dir, f)));
const hash = h.digest('hex').slice(0, 16);
const remote = standalone ? `irwb-cuda/runs/${randomUUID()}` : `irwb-cuda/${hash}`;
const ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host];
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

// copy the files (tar over ssh: one round trip, no rsync needed on either side)
const tar = spawnSync('tar', ['-C', dir, '-cf', '-', ...files], { maxBuffer: 1 << 30 });
if (tar.status !== 0) throw new Error(`tar: ${tar.stderr}`);
const put = spawnSync('ssh', [...ssh, `mkdir -p ~/${remote} && tar -C ~/${remote} -xf -`], {
  input: tar.stdout,
});
const cleanup = () => {
  if (standalone) spawnSync('ssh', [...ssh, `rm -rf ~/${remote}`]);
};
if (put.status !== 0) {
  cleanup();
  throw new Error(`ssh copy: ${put.error ?? put.stderr}`);
}

// compile if needed, then run; timings measured on the remote side
const lock = flag('--timed') ? 'flock ~/irwb-cuda/.gpu.lock' : '';
const compile = standalone
  ? [
      `set -e -o pipefail`,
      `version=$(${q(nvcc)} --version)`,
      `key=$( { printf '%s\\0' ${q(nvcc)} "$version" -O3 -arch=${arch}; cat main.cu; } | sha256sum )`,
      `cache=~/irwb-cuda/executables/\${key%% *}`,
      `mkdir -p ~/irwb-cuda/executables`,
      `exec 9>"$cache.lock"; flock 9`,
      `if [ ! -x "$cache" ]; then ${q(nvcc)} -O3 -arch=${arch} -o prog.tmp main.cu || exit 97; mv prog.tmp "$cache"; compiled=1; fi`,
      `flock -u 9; exec 9>&-; ln -s "$cache" prog`,
      `set +e`,
    ]
  : [
      `if [ ! -x prog ]; then ${q(nvcc)} -O3 -arch=${arch} -o prog main.cu 2> compile.err || { echo "@@compile-failed"; cat compile.err >&2; exit 97; }; compiled=1; fi`,
    ];
const script = [
  `cd ~/${remote} || exit 1`,
  `compiled=0; c0=$(date +%s%N)`,
  ...compile,
  `c1=$(date +%s%N); rm -rf out; mkdir -p out`,
  `r0=$(date +%s%N); ${lock} ./prog ${progArgs.map(q).join(' ')}; status=$?; r1=$(date +%s%N)`,
  `echo "@@meta $compiled $(( (c1 - c0) / 1000000 )) $(( (r1 - r0) / 1000000 )) $status"`,
  `exit 0`,
].join('\n');
const run = spawnSync('ssh', [...ssh, 'bash -s'], { input: script, maxBuffer: 1 << 28, encoding: 'utf8' });
const meta = /@@meta (\d) (\d+) (\d+) (\d+)/.exec(run.stdout ?? '');
const stdout = (run.stdout ?? '').replace(/@@meta.*\n?/, '').replace(/@@compile-failed\n?/, '');
const result = {
  host,
  hash,
  compiled: meta ? meta[1] === '1' : false,
  compileMs: meta ? Number(meta[2]) : null,
  runMs: meta ? Number(meta[3]) : null,
  exit: meta ? Number(meta[4]) : run.status,
  stdout,
  stderr: run.stderr ?? '',
  outputs: [],
};

// fetch out/ and clean only this invocation's staging area, even if extraction fails.
try {
  if (meta) {
    const get = spawnSync('ssh', [...ssh, `tar -C ~/${remote}/out -cf - .`], { maxBuffer: 1 << 30 });
    if (get.status !== 0 && standalone) {
      result.exit = result.exit || 1;
      result.stderr += `\nssh fetch: ${get.error ?? get.stderr}`;
    }
    if (get.status === 0 && get.stdout.length) {
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
} finally {
  cleanup();
}
process.stdout.write(JSON.stringify(result) + '\n');
if (result.exit !== 0) process.exitCode = 1;
