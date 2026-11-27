// The listing of one function after a pass list: node 11-listing.mjs <project> <passes a,b,c | pipeline> <fn>
const root = new URL('../../../../../../', import.meta.url);
const { installVendor } = await import(new URL('tools/node-vendor.mjs', root));
const { projectFiles } = await import(new URL('tools/corpus.mjs', root));
await installVendor();
const { Program } = await import(new URL('dist/typed/program.js', root));
const { projectSource } = await import(new URL('dist/typed/project.js', root));
const [id, passes, fn] = process.argv.slice(2);
const p = Program.fromProject(projectSource(id, projectFiles(id)));
const run = await p.pipeline(passes.includes(',') ? passes.split(',') : passes, { count: 5 });
console.log(run.steps.map(s => `${s.pass}${s.changed ? '*' : ''}${s.rejected ? '!' : ''}`).join(' '));
console.log(p.listing(fn));
