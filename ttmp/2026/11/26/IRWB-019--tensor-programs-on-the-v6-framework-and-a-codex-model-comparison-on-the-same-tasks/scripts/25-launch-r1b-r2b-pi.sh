#!/usr/bin/env bash
# IRWB-019 rounds R1b and R2b: the R1 brief (deriving streaming attention, design only) and the R2 brief ("what would
# make Tix best in class?", design and experiments) on two more model families, through Pi 1.5.1:
#   DeepSeek 4.1 Flash at high, xhigh and max; GLM 5.3 Flash at high and max (its catalogue maps only low, high and
#   max to distinct levels; DeepSeek's maps all of them).
# Both models come from the LunaRoute provider, which is a Pi extension, so the harness is --no-extensions --no-mcp plus
# that one extension (-e), with the tools pinned by --tools:
#   R1b: read, bash, edit, write, as the original R1 Pi cells (whose --no-extensions gave exactly those four);
#   R2b: the same plus web_search (LunaRoute's), since the R2 brief asks for web research (Codex had web_search=live,
#        the Claude cells WebSearch and WebFetch). web_fetch is listed but the server does not offer it yet.
# Same bases, policies and briefs as R1 and R2. The only brief change: R2b's common.md says the GPU machine is shared
# with four other agents (R2 said three). Config keys: results/r1b-config-key.json, results/r2b-config-key.json.
# Usage: 25-launch-r1b-r2b-pi.sh [r1b|r2b ...]   (default: both)
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
E=/home/manuel/.pi/agent/npm/node_modules/@lunaroute/pi-extension/src/index.ts
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees
launch() { # task base policy timeout
  local task=$1
  export BASE=$2 DEV_INSTRUCTIONS_FILE=$T/various/prompts/$3 AGENT_TIMEOUT=$4
  while read -r item round model effort tools; do
    PI_FLAGS="--no-extensions --no-mcp -e $E --tools $tools" MODEL=$model EFFORT=$effort \
      bash $K/12-launch-pi-round.sh "$round" "$T/various/prompts/$task" "$item" &
  done < <(node -e 'for (const [item, c] of Object.entries(require(process.argv[1]))) console.log(item, c.round, c.model, c.effort, c.tools)' "$T/various/results/$task-config-key.json")
}
for task in "${@:-r1b r2b}"; do
  for t in $task; do
    case $t in
      r1b) launch r1b 19ad269 developer-instructions.md 7200 ;;
      r2b) launch r2b 12bc661 developer-instructions-r2.md 10800 ;;
      *) echo "unknown task $t" >&2; exit 2 ;;
    esac
  done
done
wait
