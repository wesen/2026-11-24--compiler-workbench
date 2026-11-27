#!/bin/sh
# Claims: (C, D) eight of ten T6 cells changed src/framework, no Typed cell (D1, A0, B1) did; (A, B, C, D) most B1
# cells wrote a binding-time / specialization engine inside src/typed; which framework files the T6 cells touched.
# Read-only: git diff against t6-base and git status in each worktree.
W=$(cd "$(dirname "$0")/../../../../../../../../.claude/worktrees" && pwd)
echo "== T6: committed changes under src/framework (t6-base..HEAD), and uncommitted"
for w in "$W"/t6-*; do
  n=$(basename "$w")
  files=$(git -C "$w" diff --name-only t6-base HEAD -- src/framework | sed 's|src/framework/||' | tr '\n' ' ')
  u=$(git -C "$w" status --short -- src/framework | wc -l)
  echo "$n | ${files:-none} | uncommitted: $u"
done
echo "== D1, A0, B1: files changed under src/framework (committed + uncommitted)"
for w in "$W"/d1-* "$W"/a0-* "$W"/b1-*; do
  echo "$(basename "$w") $(git -C "$w" diff --name-only t6-base HEAD -- src/framework | wc -l) + $(git -C "$w" status --short -- src/framework | wc -l)"
done | awk '{ s += $2 + $4; print } END { print "total framework files changed by the 21 Typed cells:", s }'
echo "== B1: new or changed src/typed files whose name or content suggests binding times or residualization"
for w in "$W"/b1-*; do
  f=$( (git -C "$w" diff --name-only t6-base HEAD -- src/typed; git -C "$w" status --short -- src/typed | awk '{print $2}') | sort -u | while read -r p; do
    [ -f "$w/$p" ] && grep -lEi 'binding.?time|bta\b|residual|polyvariant|memo' "$w/$p" 2>/dev/null; done | sed "s|$w/src/typed/||" | tr '\n' ' ')
  echo "$(basename "$w") | ${f:-none}"
done
