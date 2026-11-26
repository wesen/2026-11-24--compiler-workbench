#!/usr/bin/env bash
# Build a blind judge directory for one IRWB-019 task from its config key (all cells, all harnesses).
# Usage: 09-judge-pack.sh <task> <judge-dir> <rubric.md> [seed]
#   Writes heads.json for rounds that have none (Claude subagent cells: worktree and HEAD from the key), packs the
#   design documents with the kit's 06-blind-pack.mjs, renames the key to results/blind-key-<task>.json, and puts the
#   rubric and the brief (common.md, ticket id neutralized) in the judge directory. The key never enters it.
set -eu
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=$(cd "$(dirname "$0")/.." && pwd); OUT=$T/various/kit
task=$1; J=$2; rubric=$3; seed=${4:-19}
key=$T/various/results/$task-config-key.json
rounds=$(node -e '
const fs = require("fs"), { execFileSync } = require("child_process");
const [key, out] = process.argv.slice(1), k = JSON.parse(fs.readFileSync(key, "utf8")), rs = new Set();
for (const [item, c] of Object.entries(k)) {
  rs.add(c.round);
  const h = `${out}/${c.round}/heads.json`;
  if (fs.existsSync(h) || !c.worktree) continue;
  fs.mkdirSync(`${out}/${c.round}`, { recursive: true });
  const rev = execFileSync("git", ["-C", c.worktree, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  fs.writeFileSync(h, JSON.stringify({ [item]: { worktree: c.worktree, branch: c.branch, base: "19ad269", rev, harness: c.harness } }, null, 1));
}
console.log([...rs].sort().join(","));' "$key" "$OUT")
id=$(node -e 'console.log(Object.keys(require(process.argv[1]))[0].replace(/-[A-Z]$/, ""))' "$key")
rm -rf "$J"; mkdir -p "$J/specs"
node "$K/06-blind-pack.mjs" "$OUT" "$J" --rounds "$rounds" --doc-regex "ttmp/2026/11/26/$id-[A-Z][^/]*/design-doc/.*\\.md\$" --seed "$seed"
mv "$OUT/results/blind-key.json" "$T/various/results/blind-key-$task.json"
cp "$rubric" "$J/RUBRIC.md"
sed 's/<ID>/(the author'"'"'s ticket)/g' "$T/various/prompts/$task/common.md" > "$J/specs/brief.md"
echo "packed $(ls "$J/docs" | wc -l) documents for $task into $J (key: various/results/blind-key-$task.json)"
