#!/bin/sh
# Pipeline variants on the regex and LZ benchmarks (scripts/01), one line each: the placement of bcm, reassoc,
# simplify and fold in `speed`. usage: sh 05-variants.sh [only=regex,lz]
cd "$(dirname "$0")/.."
ONLY=${1:-regex,lz}
A="inline,inline,cfg,fold,simplify,constprop,fold,simplify,dce,cfg,licm,lvn,strength,bce"
Z="rotate,cfg"
run() { printf '%-10s ' "$1"; node scripts/01-bench-three.mjs --only "$ONLY" --passes "$2" | tr -d ' \n'; echo; }
run speed   "$A,subst,subst,dce,cfg,subst,$Z"
run bcm     "$A,bcm,subst,subst,dce,cfg,subst,$Z"
run bcm+ra  "$A,bcm,subst,subst,dce,cfg,subst,reassoc,$Z"
run bcm+ras "$A,bcm,subst,subst,dce,cfg,subst,reassoc,simplify,$Z"
run bcm+rasl "$A,bcm,subst,subst,dce,cfg,subst,reassoc,simplify,lvn,$Z"
run ra      "$A,subst,subst,dce,cfg,subst,reassoc,simplify,$Z"
