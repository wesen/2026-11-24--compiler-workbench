#!/usr/bin/env bash
# IRWB-019: build each worktree and run the test files it added or changed against its base (A0 and B1 have no common
# API, so each cell is first held to its own tests), plus lines changed per area. Usage: 59-own-tests.sh <base> <wt>...
base=$1; shift
for wt in "$@"; do
  cd "$wt" || continue
  files=$( { git diff --name-only "$base" HEAD; git status --porcelain | awk '{print $2}'; } | grep -E '^tests/.*\.test\.mjs$' | sort -u)
  b=$(npm run build --silent 2>&1 | tail -2 | tr '\n' ' ')
  r=$( [ -n "$files" ] && node --test $files 2>&1 | grep -E '^ℹ (pass|fail|skipped) ' | tr '\n' ' ')
  c=$(git log --oneline "$base"..HEAD | wc -l); u=$(git status --porcelain | wc -l)
  echo "$(basename $wt): commits $c, uncommitted $u, build [${b:-ok}], own tests [$(echo $files | wc -w) files: $r]"
  git diff --numstat "$base" HEAD | awk '$3 ~ /^(src|tests|tools)\// {split($3,p,"/"); k=p[1]"/"p[2]; a[k]+=$1} END {for (k in a) printf "   %s +%d", k, a[k]; print ""}'
done
