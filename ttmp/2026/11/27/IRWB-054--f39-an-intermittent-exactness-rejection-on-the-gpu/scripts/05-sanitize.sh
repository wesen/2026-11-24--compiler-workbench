#!/usr/bin/env bash
# IRWB-054 probe 05: run the batched contraction kernel under compute-sanitizer on the GPU machine, one variant forced
# per run. tools/cuda-remote.mjs always runs ./prog unchanged, so this one goes over ssh itself.
# Usage: scripts/05-sanitize.sh <jobdir> [tool ...]     tools: racecheck (default), memcheck, synccheck, initcheck
set -e
dir=$1
shift
tools=${*:-racecheck}
host=${CUDA_REMOTE_HOST:-manuel@bling}
nvcc=${CUDA_REMOTE_NVCC:-/usr/local/cuda-13.0/bin/nvcc}
san=/usr/local/cuda-13.0/bin/compute-sanitizer
remote=irwb-cuda/sanitize/$$
tar -C "$dir" -cf - main.cu inputs.bin | ssh -o BatchMode=yes -o ConnectTimeout=10 -- "$host" "mkdir -p ~/$remote && tar -C ~/$remote -xf -"
trap 'ssh -o BatchMode=yes -- "$host" "rm -rf ~/$remote"' EXIT
ssh -o BatchMode=yes -- "$host" bash -s <<SCRIPT
set -e
cd ~/$remote
$nvcc -O3 -lineinfo -arch=sm_121 -o prog main.cu 2>&1 | grep -E '^main.cu\([0-9]+\): (error|warning)' | sort -u | head -5
mkdir -p out
for tool in $tools; do
  for variant in 0 1 2 3; do
    echo "== \$tool variant \$variant"
    $san --tool \$tool ./prog --variant=\$variant 2>&1 | grep -E 'SUMMARY|hazards|Invalid|out-of-bounds|Leaked|ERROR' | grep -v '^========= COMPUTE' | head -8
  done
done
SCRIPT
