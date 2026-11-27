#!/usr/bin/env bash
# Probes run before launching new model cells (IRWB-019 steps 33-35), kept as a script on the user's instruction.
#   pi:     each LunaRoute model and thinking level through Pi with only the LunaRoute extension, the tool list it
#           sees, and the tool allowlists used by R1b (four built-ins) and R2b (plus web_search);
#   maps:   each model's thinking-level map from Pi's cached catalogue (~/.pi/agent/models-store.json), which shows
#           which requested levels are distinct;
#   codex:  whether Codex runs a model at an effort level with this account (gpt-6.2-terra does not; gpt-6.1-terra does).
# Outputs go to $OUT (default: various/results/model-probes/). Usage: 30-probe-agent-models.sh [pi|maps|codex ...]
set -u
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
E=/home/manuel/.pi/agent/npm/node_modules/@lunaroute/pi-extension/src/index.ts
OUT=${OUT:-$T/various/results/model-probes}; mkdir -p "$OUT"; cd "$OUT"
PI_CONFIGS="deepseek-4.1-flash:high deepseek-4.1-flash:xhigh deepseek-4.1-flash:max glm-5.3-flash:high glm-5.3-flash:max glm-5.3:high glm-5.3:max"
CODEX_CONFIGS="gpt-6.2-astra:low gpt-6.2-sol:low gpt-6.2-terra:low gpt-6.1-terra:low"
for what in "${@:-pi maps codex}"; do for w in $what; do case $w in
  pi)
    for c in $PI_CONFIGS; do m=${c%%:*}; t=${c##*:}
      ( timeout 300 pi -p --no-extensions --no-mcp -e "$E" --model "lunaroute/$m" --thinking "$t" --session-dir "pi-sess-$m-$t" \
          "List the names of the tools you can call, comma-separated, then on a new line write the number 17*23." \
          < /dev/null 2>&1 | grep -v '^Warning' > "pi-$m-$t.out"
        echo "pi $m $t: $(tr '\n' ' ' < "pi-$m-$t.out" | cut -c1-160)" ) &
    done; wait
    for set in read,bash,edit,write read,bash,edit,write,web_search,web_fetch; do
      echo "pi --tools $set: $(timeout 200 pi -p --no-extensions --no-mcp -e "$E" --tools "$set" --model lunaroute/deepseek-4.1-flash \
        --thinking high "List the names of the tools you can call, comma-separated, nothing else." < /dev/null 2>&1 | grep -v '^Warning' | tr '\n' ' ')"
    done ;;
  maps)
    python3 - <<'PY'
import json
d = json.load(open('/home/manuel/.pi/agent/models-store.json'))
def walk(o):
    if isinstance(o, dict):
        if o.get('id') in ('deepseek-4.1-flash', 'glm-5.3-flash', 'glm-5.3'): yield o
        for v in o.values(): yield from walk(v)
    elif isinstance(o, list):
        for v in o: yield from walk(v)
for m in walk(d):
    print('map', m['id'], json.dumps(m.get('thinkingLevelMap')))
PY
    ;;
  codex)
    for c in $CODEX_CONFIGS; do m=${c%%:*}; e=${c##*:}
      timeout 120 codex exec -m "$m" -c model_reasoning_effort="$e" -s read-only --skip-git-repo-check -o "codex-$m.md" \
        "Reply with the single word ok." < /dev/null > "codex-$m.log" 2>&1
      echo "codex $m $e: exit $? :: $(cat "codex-$m.md" 2>/dev/null) :: $(grep -m1 ERROR "codex-$m.log")"
    done ;;
  *) echo "unknown probe $w" >&2; exit 2 ;;
esac; done; done
