import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {collectSources} from '../dist/workbench/source-catalog.js';
import {styles} from '../dist/workbench/styles.js';
import {sourceStyles,compactStyles,strategyStyles,irStyles} from '../dist/source-workbench/styles.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const common={bundle:true,format:'iife',platform:'browser',target:'es2022',write:false,legalComments:'inline'};
const [{outputFiles:[ui]},{outputFiles:[worker]}]=await Promise.all([build({...common,entryPoints:[root+'src/source-workbench/ui.ts']}),build({...common,entryPoints:[root+'src/source-workbench/worker.ts']})]);
const typescript=await readFile(root+'node_modules/typescript/lib/typescript.js','utf8');
const embed=v=>JSON.stringify(v).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const catalog=await collectSources(root);
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none';"><title>IR workbench v6 · source, strategies, contracts and transformations</title><style>${styles}\n${sourceStyles}
${compactStyles}\n${strategyStyles}\n${irStyles}</style></head><body><div id="app"><p style="padding:32px">Loading v6 IR manipulation workbench…</p></div><script id="source-data" type="application/json">${embed(catalog)}</script><script id="worker-source" type="application/json">${embed(typescript+'\n;\n'+worker.text)}</script><script>${ui.text.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
await mkdir(root+'output',{recursive:true});await writeFile(root+'output/source-workbench.html',html);console.log(`Standalone source-first workbench: ${(html.length/1024/1024).toFixed(1)} MB`);
