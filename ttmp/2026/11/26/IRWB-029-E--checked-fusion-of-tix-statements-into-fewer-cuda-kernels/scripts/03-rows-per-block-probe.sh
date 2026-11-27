#!/bin/sh
# Run from the worktree root. Timed (takes the GPU lock); about 3 s on the GPU.
exec node tools/cuda-remote.mjs "$(dirname "$0")/03-rows-per-block-probe" --timed
