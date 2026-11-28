// Compile and run a CUDA program on the GPU machine over ssh, and bring its outputs back.
//
//   node tools/cuda-remote.mjs <dir> [--timed] [--host user@host] [--arch sm_121]
//     [--link <lib>]... [--runtime-input relative-path ...] [-- program args...]
//
// <dir> holds main.cu and any input files. Each invocation uploads to its own remote working directory.
// Each --link <lib> appends -l<lib> after main.cu in the nvcc command (e.g. --link cublas).
// The cache key includes the compiler path, architecture, ordered link flags and build files.
// Each --runtime-input path marks an uploaded file that does not affect compilation. Files under out/
// are copied back to <dir>/out/ after running ./prog from the working directory.
// --timed takes an exclusive lock on the GPU (flock ~/irwb-cuda/.gpu.lock) for the run, so concurrent timed
// users do not disturb each other's timings. Untimed runs do not wait for it.
// Prints one JSON object: { host, hash, compiled, compileMs, runMs, exit, stdout, stderr, outputs }.
// Each ssh step is retried (IRWB-054) when the connection itself is what failed: sshd on the GPU machine allows ten
// unauthenticated connections at a time (MaxStartups 10:30:100) and drops the rest, and a GPU test suite holds more
// than that open at once. The retry repeats the whole job in a fresh remote directory, so a dropped run cannot leave a
// half-written result behind; failures of the remote commands themselves (a compile, the program) are not retried.
// Environment: CUDA_REMOTE_HOST (default manuel@bling, the Tailscale name; bling.local resolves only on the home
// LAN), CUDA_REMOTE_NVCC (default /usr/local/cuda-13.0/bin/nvcc).
// Inside the Codex sandbox, ssh needs network access (-c sandbox_workspace_write.network_access=true); without it,
// agents request escalation instead.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const opts = sep < 0 ? argv : argv.slice(0, sep);
const progArgs = sep < 0 ? [] : argv.slice(sep + 1);
const valued = ['--host', '--arch', '--runtime-input', '--link'];
const dir = opts.find((a, i) => !a.startsWith('--') && !valued.includes(opts[i - 1]));
if (!dir)
  throw new Error(
    'usage: node tools/cuda-remote.mjs <dir> [--timed] [--host h] [--arch a] [--link <lib>]... [--runtime-input path ...] [-- args]',
  );
for (const [i, opt] of opts.entries())
  if (valued.includes(opt) && (!opts[i + 1] || opts[i + 1].startsWith('--')))
    throw new Error('Missing argument to ' + opt);
const value = (name, fallback) => (opts.includes(name) ? opts[opts.indexOf(name) + 1] : fallback);
const host = value('--host', process.env.CUDA_REMOTE_HOST ?? 'manuel@bling');
const arch = value('--arch', 'sm_121');
const nvcc = process.env.CUDA_REMOTE_NVCC ?? '/usr/local/cuda-13.0/bin/nvcc';
const linkFlags = opts.flatMap((arg, i) => (arg === '--link' ? ['-l' + opts[i + 1]] : []));

const files = [];
function walk(d) {
  for (const entry of readdirSync(d).sort()) {
    const p = join(d, entry);
    if (relative(dir, p) === 'out') continue;
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative(dir, p));
  }
}
walk(dir);
if (!files.includes('main.cu')) throw new Error(dir + ': no main.cu');
const runtime = new Set(opts.flatMap((arg, i) => (arg === '--runtime-input' ? [opts[i + 1]] : [])));
for (const path of runtime)
  if (path === 'main.cu' || !files.includes(path)) throw new Error('Invalid runtime input: ' + path);
const h = createHash('sha256').update(JSON.stringify([nvcc, '-O3', arch, ...linkFlags]));
for (const f of files) {
  if (runtime.has(f)) continue;
  const bytes = readFileSync(join(dir, f));
  h.update(JSON.stringify([f, bytes.length])).update(bytes);
}
const hash = h.digest('hex');
const ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', host];
const q = s => "'" + String(s).replaceAll("'", "'\\''") + "'";

// A connection sshd dropped, as opposed to a command that failed: the remote work never started, so the job can be
// repeated. ssh reports these on stderr and exits 255; the same errors also kill a channel that was already open.
const dropped =
  /kex_exchange_identification|ssh_exchange_identification|Connection closed|Connection reset|Connection timed out|Connection refused|No route to host|Network is unreachable|Broken pipe|closed by remote host|client_loop|Timeout, server|Control socket/;
class StrayConnection extends Error {}
function sshCall(what, args, options) {
  const r = spawnSync('ssh', [...ssh, ...args], options);
  if (r.status === 0) return r;
  const text = [r.error?.message, r.stderr?.toString(), r.stdout?.toString()]
    .filter(Boolean)
    .join('\n')
    .trim();
  const kind = StrayConnection.transported(r.error, text, r.status);
  const error = new (kind === 'dropped' ? StrayConnection : Error)(`${what}: ${text || 'exit ' + r.status}`);
  throw error;
}
StrayConnection.transported = (error, text, status) =>
  ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE'].includes(error?.code) ||
  dropped.test(text) ||
  (status === 255 && !text)
    ? 'dropped'
    : 'failed';
const attempts = 6;
const sleep = ms => new Promise(done => setTimeout(done, ms));

const tar = spawnSync('tar', ['-C', dir, '-cf', '-', '--', ...files], { maxBuffer: 1 << 30 });
if (tar.status !== 0) throw new Error('tar: ' + (tar.error ?? tar.stderr));
for (let attempt = 1; ; ++attempt) {
  const remote = 'irwb-cuda/run/' + randomUUID();
  // Removed by the fetch below, on success; a failed attempt removes its own directory.
  let cleaned = false;
  const cleanUp = () =>
    cleaned || spawnSync('ssh', [...ssh, `rm -rf ~/${remote}`], { stdio: 'ignore', timeout: 60_000 });
  try {
    sshCall('ssh copy', [`mkdir -p ~/${remote} && tar -C ~/${remote} -xf -`], { input: tar.stdout });

    // Hold the compile lock until the cached binary is linked into this job.
    const lock = opts.includes('--timed') ? 'flock ~/irwb-cuda/.gpu.lock ' : '';
    const script = [
      'set -e',
      `cd ~/${remote}`,
      `cache=~/irwb-cuda/build/${hash}`,
      'compiled=0; c0=$(date +%s%N)',
      'mkdir -p "$cache"',
      'exec 9>"$cache/.lock"',
      'flock 9',
      'if [ ! -x "$cache/prog" ]; then',
      `  ${q(nvcc)} -O3 ${q('-arch=' + arch)} -o prog.tmp main.cu ${linkFlags.map(q).join(' ')} || exit 97`,
      '  mv prog.tmp "$cache/prog"',
      '  compiled=1',
      'fi',
      'ln "$cache/prog" prog',
      'exec 9>&-',
      'c1=$(date +%s%N); mkdir -p out',
      `r0=$(date +%s%N); status=0; ${lock}./prog ${progArgs.map(q).join(' ')} || status=$?; r1=$(date +%s%N)`,
      'printf "\\n@@meta %s %s %s %s\\n" "$compiled" "$(( (c1 - c0) / 1000000 ))" "$(( (r1 - r0) / 1000000 ))" "$status"',
    ].join('\n');
    const run = sshCall('ssh run', ['bash -s'], { input: script, maxBuffer: 1 << 28, encoding: 'utf8' });
    const meta = run.status === 0 && /\n@@meta (\d) (\d+) (\d+) (\d+)\n?$/.exec(run.stdout ?? '');
    const result = {
      host,
      hash,
      compiled: meta ? meta[1] === '1' : false,
      compileMs: meta ? Number(meta[2]) : null,
      runMs: meta ? Number(meta[3]) : null,
      exit: meta ? Number(meta[4]) : run.status || 1,
      stdout: meta ? run.stdout.slice(0, meta.index) : (run.stdout ?? ''),
      stderr: run.error?.message ?? run.stderr ?? '',
      outputs: [],
    };

    if (meta) {
      const get = sshCall('ssh fetch', [`tar -C ~/${remote}/out -cf - . && rm -rf ~/${remote}`], {
        maxBuffer: 1 << 30,
      });
      cleaned = true;
      const out = join(dir, 'out');
      mkdirSync(out, { recursive: true });
      execFileSync('tar', ['-C', out, '-xf', '-'], { input: get.stdout });
      const collect = d => {
        for (const entry of readdirSync(d)) {
          const p = join(d, entry);
          if (statSync(p).isDirectory()) collect(p);
          else result.outputs.push(relative(out, p));
        }
      };
      collect(out);
      result.outputs.sort();
    }
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.exit !== 0) process.exitCode = 1;
    if (!cleaned) cleanUp();
    break;
  } catch (error) {
    cleanUp();
    if (!(error instanceof StrayConnection) || attempt === attempts) throw error;
    // Back off past the throttling burst: sshd drops for as long as the surplus connections keep arriving.
    const delay = Math.round(Math.min(4000, 250 * 2 ** (attempt - 1)) * (0.75 + Math.random() / 2));
    process.stderr.write(`cuda-remote: ${error.message.split('\n')[0]}; attempt ${attempt}/${attempts}, retrying in ${delay} ms\n`);
    await sleep(delay);
  }
}
