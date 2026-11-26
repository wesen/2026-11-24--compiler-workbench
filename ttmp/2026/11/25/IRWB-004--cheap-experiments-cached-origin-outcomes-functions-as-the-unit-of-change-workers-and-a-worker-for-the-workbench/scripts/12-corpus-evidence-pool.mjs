// IRWB-004 F4: the corpus through O2, one project per job on a pool of worker threads (src/typed/parallel/job-pool.ts).
// Prints the same lines as 08-corpus-evidence.mjs, in corpus order, and the wall time on stderr.
//   node …/12-corpus-evidence-pool.mjs [--threads 4]
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const { projectIds } = await import(root + 'tools/corpus.mjs');
const { startJobPool } = await import(root + 'dist/typed/parallel/job-pool.js');
const args = process.argv.slice(2);
const threads = args.includes('--threads') ? +args[args.indexOf('--threads') + 1] : 4;
const t0 = performance.now();
const pool = startJobPool(new URL('./11-corpus-job.mjs', import.meta.url), 'o2Evidence', { threads });
const lines = await Promise.all(projectIds().map(id => pool.run(id)));
await pool.close();
console.log(lines.join('\n'));
process.stderr.write(`threads ${threads} total ${Math.round(performance.now() - t0)} ms\n`);
