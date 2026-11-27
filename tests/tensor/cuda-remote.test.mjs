import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('remote builds include repeated link libraries in the command and cache key', () => {
  const root = mkdtempSync(join(tmpdir(), 'cuda-remote-test-'));
  const bin = join(root, 'bin'), dir = join(root, 'source'), captured = join(root, 'script');
  mkdirSync(bin); mkdirSync(dir);
  writeFileSync(join(dir, 'main.cu'), 'int main() {}\n');
  writeFileSync(join(bin, 'ssh'), `#!/bin/sh\ncase "$*" in\n  *'bash -s'*) cat > '${captured}'; printf '\\n@@meta 1 0 0 0\\n' ;;\n  *'tar -C'*'/out'*) tar -cf - --files-from /dev/null ;;\n  *) cat >/dev/null ;;\nesac\n`, { mode: 0o755 });
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [resolve('tools/cuda-remote.mjs'), dir, ...args], {
    env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8',
  }));
  const plain = run();
  const linked = run('--link', 'cublas', '--link', 'cudart');
  assert.notEqual(linked.hash, plain.hash);
  const script = readFileSync(captured, 'utf8');
  assert.match(script, /main\.cu '-lcublas' '-lcudart'/);
  assert.equal(run('--link', 'cublas', '--link', 'cudart').hash, linked.hash);
  assert.notEqual(run('--link', 'cudart', '--link', 'cublas').hash, linked.hash);
});
