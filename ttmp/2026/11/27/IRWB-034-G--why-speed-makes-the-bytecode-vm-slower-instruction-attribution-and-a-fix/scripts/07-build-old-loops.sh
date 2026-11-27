#!/bin/sh
# Build the compiler with the loops analysis of the baseline (commit 85889a1: one loop per back edge) and
# everything else as in the working tree, into out/old-loops/dist (out/ is ignored by git). Scripts that take
# IRWB_DIST use it to reproduce "before" numbers without switching dist/.
set -e
root=$(cd "$(dirname "$0")/../../../../../.." && pwd)
cd "$root"
rm -rf out/old-loops && mkdir -p out/old-loops
cp -r src out/old-loops/src
git show 85889a1:src/typed/analyses.ts > out/old-loops/src/typed/analyses.ts
cat > out/old-loops/tsconfig.json <<JSON
{ "extends": "../../tsconfig.json", "compilerOptions": { "rootDir": "src", "outDir": "dist", "typeRoots": ["../../node_modules/@types"] }, "include": ["src/**/*.ts"] }
JSON
npx tsc -p out/old-loops/tsconfig.json
ls out/old-loops/dist/typed/analyses.js
