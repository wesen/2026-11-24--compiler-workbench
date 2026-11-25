// Build the standalone browser workbench into dist/site/ (npm run build:site):
//   index.html      site-src/index.html
//   app.js          site-src/main.js bundled with esbuild (the UI, src/workbench, src/typed, src/framework) and the
//                   built-in content: corpus/projects, corpus/book, corpus/reference.md and the workbench's source
//   app.css         site-src/{kiln,agent,app,port}.css
//   vendor/*.js     the vendored ds-js-os front end and emulator, checked against vendor/ds-js-os/VENDOR.json
// Nothing is fetched at run time; the page makes no network requests (see the CSP in index.html).
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinProjects } from './corpus.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, process.argv[2] || 'dist/site');
const t0 = performance.now();

// ---------- content ----------
function book() {
  const dir = join(root, 'corpus/book');
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => {
      const text = readFileSync(join(dir, f), 'utf8');
      const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
      const meta = {};
      if (m) for (const line of m[1].split('\n')) {
        const k = /^(\w+):\s*(.*)$/.exec(line);
        if (k) meta[k[1]] = k[2].trim();
      }
      return {
        id: meta.id || f.replace(/^\d+-|\.md$/g, ''),
        title: meta.title || f,
        part: meta.part || '',
        projects: meta.projects ? meta.projects.split(',').map(s => s.trim()).filter(Boolean) : [],
        md: m ? text.slice(m[0].length) : text,
      };
    });
}
function reference() {
  const divergences = readFileSync(join(root, 'src/workbench/DIVERGENCES.md'), 'utf8');
  const ref = readFileSync(join(root, 'corpus/reference.md'), 'utf8');
  // the prototype's reference, with this build's differences first (wb.help('divergences') prints them)
  const body = divergences.replace(/^# .*\n/, '');
  return ref.replace(/^(# .*\n)/, `$1\n## Divergences in this build\n\n${body.replace(/^## /gm, '### ')}\n`);
}
function sources() {
  const files = {};
  const walk = (dir, filter) => {
    for (const f of readdirSync(dir).sort()) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p, filter);
      else if (filter(f)) files[relative(root, p)] = readFileSync(p, 'utf8');
    }
  };
  walk(join(root, 'src/workbench'), f => /\.(ts|md)$/.test(f));
  walk(join(root, 'src/typed'), f => /\.ts$/.test(f));
  walk(join(root, 'src/framework'), f => /\.ts$/.test(f));
  walk(join(root, 'site-src'), f => /\.(js|html)$/.test(f));
  return files;
}
const git = (() => {
  try {
    const head = readFileSync(join(root, '.git'), 'utf8');
    return head.startsWith('gitdir:') ? 'worktree' : 'repo';
  } catch {
    return 'repo';
  }
})();
const content = {
  PROJECTS: builtinProjects(),
  BOOK: book(),
  REFERENCE: reference(),
  SOURCES: sources(),
  BUILD: { label: `build ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, at: new Date().toISOString(), from: git },
};

// ---------- the bundle ----------
const contentPlugin = {
  name: 'content',
  setup(b) {
    b.onResolve({ filter: /content\.generated\.js$/ }, () => ({ path: 'content', namespace: 'wb-content' }));
    b.onLoad({ filter: /.*/, namespace: 'wb-content' }, () => ({
      contents: Object.entries(content)
        .map(([k, v]) => `export const ${k} = ${JSON.stringify(v)};`)
        .join('\n'),
      loader: 'js',
    }));
  },
};
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'vendor'), { recursive: true });
const result = await build({
  entryPoints: [join(root, 'site-src/main.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  outfile: join(out, 'app.js'),
  sourcemap: true,
  legalComments: 'none',
  plugins: [contentPlugin],
  metafile: true,
  logLevel: 'warning',
});

// ---------- styles, page and vendored scripts ----------
writeFileSync(
  join(out, 'app.css'),
  ['kiln.css', 'agent.css', 'app.css', 'port.css'].map(f => `/* ${f} */\n` + readFileSync(join(root, 'site-src', f), 'utf8')).join('\n'),
);
copyFileSync(join(root, 'site-src/index.html'), join(out, 'index.html'));
const manifest = JSON.parse(readFileSync(join(root, 'vendor/ds-js-os/VENDOR.json'), 'utf8'));
const vendored = { 'compiler/typed/tape.js': 'tape.js', 'compiler/typed/typed-wasm.js': 'typed-wasm.js', 'bench/host/rv32-interp.js': 'rv32-interp.js' };
for (const [path, name] of Object.entries(vendored)) {
  const entry = manifest.files.find(f => f.path === path);
  const bytes = readFileSync(join(root, 'vendor/ds-js-os', path));
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (!entry || digest !== entry.sha256) throw new Error(`${path}: sha256 ${digest} does not match VENDOR.json`);
  writeFileSync(join(out, 'vendor', name), bytes);
}

const size = f => statSync(join(out, f)).size;
const kb = n => `${(n / 1024).toFixed(0)} KiB`;
console.log(
  `dist/site built in ${(performance.now() - t0).toFixed(0)} ms: app.js ${kb(size('app.js'))}, app.css ${kb(size('app.css'))}, ` +
    `${content.PROJECTS.length} projects, ${content.BOOK.length} chapters, ${Object.keys(content.SOURCES).length} source files` +
    (result.warnings.length ? `, ${result.warnings.length} warnings` : ''),
);
