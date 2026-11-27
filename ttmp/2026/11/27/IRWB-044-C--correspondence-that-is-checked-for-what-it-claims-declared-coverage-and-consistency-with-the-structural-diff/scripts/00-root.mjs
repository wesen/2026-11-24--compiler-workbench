// IRWB-044-C: shared helper. Probes read the code under test from ROOT (default: this checkout, after `npm run build`).
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
export const repo = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../../../');
export const root = resolve(process.env.ROOT ?? repo);
export const dist = path => import(pathToFileURL(resolve(root, 'dist', path)).href);
export const at = path => resolve(root, path);
