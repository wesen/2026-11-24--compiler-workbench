#!/bin/sh
set -eu
ticket=ttmp/2026/11/27/IRWB-037-B--missed-typed-optimizations-from-instruction-provenance
node tools/parity.mjs > "$ticket/various/parity.txt"
node tools/reference-check.mjs > "$ticket/various/reference.txt"
node tools/reference-check.mjs --o2 >> "$ticket/various/reference.txt"
