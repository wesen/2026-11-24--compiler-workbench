#!/bin/sh
# Run from the worktree root. Timed (takes the GPU lock); about 2 s on the GPU.
exec node tools/cuda-remote.mjs "$(dirname "$0")/05-max-fold-probe" --timed
