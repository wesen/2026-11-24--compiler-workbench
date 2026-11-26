#!/usr/bin/env bash
# Resume every agent of a task for its next turn, each with its own prompt: <template> with <ID> replaced by the
# item and <REVIEW> by that item's review (reviews/<doc>.md, mapped through results/blind-key-<task>.json).
# Usage: 10-dispatch-turn.sh <task> <turn-name> <template> [<reviews-dir>] [--only ITEM,ITEM] [--network]
#   Codex cells: 02-resume-codex-round.sh <round>-<turn> <round> (developer_instructions as in turn 1).
#   Pi cells: 13-resume-pi-round.sh. Claude subagent cells: the prompt is written to
#   various/prompts/<task>/<turn>/<item>.md and listed; the coordinator sends it with SendMessage.
#   --network passes sandbox_workspace_write.network_access=true to Codex (needed for ssh to the GPU machine).
#   All resumes run in parallel; the script waits for them.
set -u
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=$(cd "$(dirname "$0")/.." && pwd); R=$(cd "$T/../../../../.." && pwd)
task=$1; turn=$2; tpl=$3; reviews=${4:-}; shift 3; [ -n "$reviews" ] && [ -d "$reviews" ] && shift
only=""; net=""
while [ $# -gt 0 ]; do case $1 in --only) only=$2; shift 2;; --network) net=1; shift;; *) shift;; esac; done
P=$T/various/prompts/$task/$turn; mkdir -p "$P"
export REPO=$R OUT=$T/various/kit WORKTREES=$R/.claude/worktrees AGENT_TIMEOUT=${AGENT_TIMEOUT:-7200}
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions.md
node -e '
const fs = require("fs");
const [T, task, tpl, reviews, P, only] = process.argv.slice(1);
const key = JSON.parse(fs.readFileSync(`${T}/various/results/${task}-config-key.json`, "utf8"));
let blind = []; try { blind = JSON.parse(fs.readFileSync(`${T}/various/results/blind-key-${task}.json`, "utf8")); } catch {}
const t = fs.readFileSync(tpl, "utf8");
for (const [item, c] of Object.entries(key)) {
  if (only && !only.split(",").includes(item)) continue;
  let review = "";
  if (reviews) { const b = blind.find(x => x.item === item); review = b ? fs.readFileSync(`${reviews}/${b.name}`, "utf8").trim() : ""; if (!review) { console.error(`no review for ${item}`); continue; } }
  fs.writeFileSync(`${P}/${item}.md`, t.replaceAll("<ID>", item).replace("<REVIEW>", review));
  console.log(item, c.round, c.model, c.effort, c.harness);
}' "$T" "$task" "$tpl" "$reviews" "$P" "$only" > "$P/dispatch.txt"
while read item round model effort harness; do
  case $harness in
    codex) EXTRA=(); [ -n "$net" ] && EXTRA=(-c sandbox_workspace_write.network_access=true)
           MODEL=$model EFFORT=$effort CODEX_EXTRA="${EXTRA[*]:-}" bash "$K/02-resume-codex-round.sh" "$round-$turn" "$round" "$P/$item.md" "$item" & ;;
    pi)    MODEL=$model EFFORT=$effort bash "$K/13-resume-pi-round.sh" "$round-$turn" "$round" "$P/$item.md" "$item" & ;;
    *)     echo "SEND (SendMessage) $item: $P/$item.md" ;;
  esac
done < "$P/dispatch.txt"
wait
echo "dispatched $task/$turn: $(wc -l < "$P/dispatch.txt") items"
