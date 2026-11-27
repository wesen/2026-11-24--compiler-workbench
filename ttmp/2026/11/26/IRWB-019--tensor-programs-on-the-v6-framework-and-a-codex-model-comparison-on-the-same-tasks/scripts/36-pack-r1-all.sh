#!/usr/bin/env bash
# Blind pack of all nineteen R1 designs, the twelve original cells (Sol and Astra; Codex and Pi; three efforts) and the
# seven R1b cells (DeepSeek 4.1 Flash, GLM 5.3 Flash, GLM 5.3 through Pi), for one judge session per judge.
#   The design is any .md under the ticket's design-doc/ or design/ (two R1b cells used design/; one named its ticket
#   IRWB-021 without its letter). The kit's 06-blind-pack.mjs takes each round's heads.json revision and strips
#   frontmatter. Then every ticket id becomes TICKET, because the R1b letters (M-S) would mark a separate batch, and a
#   leak scan looks for model, vendor and harness names.
# Usage: 36-pack-r1-all.sh <judge-dir> [seed]   Writes results/blind-key-r1-all.json (kept out of the pack).
set -eu
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=$(cd "$(dirname "$0")/.." && pwd); OUT=$T/various/kit; J=$1; seed=${2:-18}
rounds=$(node -e 'const r = new Set(); for (const f of process.argv.slice(1)) for (const c of Object.values(require(f))) r.add(c.round); console.log([...r].sort().join(","))' \
  "$T/various/results/r1-config-key.json" "$T/various/results/r1b-config-key.json")
rm -rf "$J"; mkdir -p "$J/specs"
node "$K/06-blind-pack.mjs" "$OUT" "$J" --rounds "$rounds" --doc-regex 'ttmp/2026/11/26/IRWB-021(-[A-Z])?--[^/]*/(design-doc|design)/.*\.md$' --seed "$seed"
mv "$OUT/results/blind-key.json" "$T/various/results/blind-key-r1-all.json"
for f in "$J"/docs/*.md; do sed -i -E 's/IRWB-021(-[A-Z])?/TICKET/g' "$f"; done
cp "$T/scripts/04-judge-rubric-r1.md" "$J/RUBRIC.md"
sed 's/<ID>/(the author'"'"'s ticket)/g' "$T/various/prompts/r1/common.md" > "$J/specs/brief.md"
echo "packed $(ls "$J/docs" | wc -l) documents into $J"
echo "leaks: $(grep -l -i -E 'claude|anthropic|openai|codex|\bsol\b|astra|opus|fable|deepseek|glm|zhipu|z\.ai|lunaroute|\bpi\b coding|pi-coding|IRWB-021' "$J"/docs/*.md | tr '\n' ' ')"
