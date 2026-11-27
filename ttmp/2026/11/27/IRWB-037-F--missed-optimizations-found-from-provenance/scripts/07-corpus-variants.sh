#!/bin/sh
# `speed` variants over the corpus (scripts/03 with --pipelines speed --speed ...), four runs in parallel, each to
# various/variant-<name>.json. Run after a build; compare with scripts/08-compare.mjs.
cd "$(dirname "$0")/.."
A="inline,inline,cfg,fold,simplify,constprop,fold,simplify,dce,cfg,licm,lvn,strength,bce"
Z="rotate,cfg"
v() { node scripts/03-corpus-measure.mjs "various/variant-$1.json" --pipelines speed --speed "$2" > "various/variant-$1.log" 2>&1 & }
v bce      "$A,subst,subst,dce,cfg,subst,$Z"
v bcm      "$A,bcm,subst,subst,dce,cfg,subst,$Z"
v bcm-ra   "$A,bcm,subst,subst,dce,cfg,subst,reassoc,simplify,$Z"
v bcm-ral  "$A,bcm,subst,subst,dce,cfg,subst,reassoc,simplify,lvn,$Z"
wait
