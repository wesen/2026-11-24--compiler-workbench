#!/usr/bin/env bash
# List every exported declaration under src/ with file:line, as the raw material for the
# API references in the intern guide. Reads only; run from the repository root.
# Usage: 02-exported-api.sh [dir ...]   (default: src/framework src/typed src/workbench)
set -euo pipefail
dirs=("$@"); [ $# -eq 0 ] && dirs=(src/framework src/typed src/workbench)
grep -rnE '^export (async )?(function|const|class|interface|type|enum) ' "${dirs[@]}" --include='*.ts' \
  | sed -E 's/^([^:]+:[0-9]+):export /\1  /' | cut -c1-230 | sort -t: -k1,1 -k2,2n
