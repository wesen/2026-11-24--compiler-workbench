import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, [root+'node_modules/typescript/bin/tsc', '-p',root+'tsconfig.json'], {stdio:'inherit',cwd:root});
if(result.status!==0)process.exit(result.status??1);
if(existsSync(root+'src/workbench/ui-entry.ts')) {
  mkdirSync(root+'dist/workbench',{recursive:true});
  await build({entryPoints:[root+'src/workbench/ui-entry.ts'],outfile:root+'dist/workbench/workbench.js',bundle:true,minify:false,format:'iife',platform:'browser',target:'es2022',sourcemap:false});
}
console.log('Strict TypeScript build complete.');
