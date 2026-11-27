#!/usr/bin/env bash
# IRWB-019: push every finished agent cell's branch (and the stage bases) to origin under its own name, so unmerged work
# is preserved and the reports can link it. First scans what each branch adds beyond main: secrets, the user's email,
# blobs over 20 MB. Usage: SCAN_PRIVATE='addr|other' 62-push-cell-branches.sh [--push]   (without --push: scan and list
# only). SCAN_PRIVATE holds private strings to refuse (the user's email); it is never written to the repository.
cd /home/manuel/code/wesen/2026-11-24--compiler-workbench || exit 1
skip='^(d2-|t6-gf-h/|t6-g-max/|worktree-agent-|irwb-001/|main$)'
branches=$(git for-each-ref --format='%(refname:short)' refs/heads | grep -Ev "$skip")
[ -n "$SCAN_PRIVATE" ] || { echo 'set SCAN_PRIVATE (private strings to refuse) first'; exit 1; }
bad=0
for b in $branches; do
  hits=$(git diff main...$b 2>/dev/null | grep -E '^\+' | grep -aciE "$SCAN_PRIVATE|"'BEGIN (RSA|OPENSSH) PRIVATE|sk-[A-Za-z0-9]{32}|ghp_[A-Za-z0-9]{30}|xox[bp]-[0-9]')
  big=$(git rev-list --objects main..$b 2>/dev/null | git cat-file --batch-check='%(objecttype) %(objectsize) %(rest)' | awk '$1=="blob" && $2>20000000 {print $3" "$2}')
  if [ "$hits" != 0 ] || [ -n "$big" ]; then echo "FLAG $b hits=$hits big=$big"; bad=1; fi
done
echo "$(echo $branches | wc -w) branches scanned; flagged: $bad"
[ "$1" = --push ] && [ $bad = 0 ] && git push -q origin $branches && echo pushed
