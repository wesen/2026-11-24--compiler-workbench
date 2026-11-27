#!/bin/sh
# A frozen copy of the current build for a long measurement: dist/ and tools/ copied, vendor/, corpus/ and
# node_modules/ linked. usage: sh 10-snapshot.sh <dir>   then   IRWB_ROOT=<dir> node 09-ablation.mjs ...
set -e
dir=${1:?directory}
root=$(cd "$(dirname "$0")/../../../../../.." && pwd)
rm -rf "$dir"; mkdir -p "$dir"
cp -r "$root/dist" "$root/tools" "$dir/"
cp "$root/package.json" "$dir/"
ln -s "$root/vendor" "$dir/vendor"; ln -s "$root/corpus" "$dir/corpus"; ln -s "$root/node_modules" "$dir/node_modules"
echo "$dir"
