#!/usr/bin/env bash
# IRWB-049-A script 02: the acceptance suites, one file at a time (the brief: pass files, not a
# directory; no *-gpu.test.mjs — there is no GPU on this machine). Writes one line per file:
# 'ok <file> <pass>/<tests>' or 'FAIL <file> <fail> failures'.
set -u
log="$(dirname "$0")/../various/suite-results.txt"
mkdir -p "$(dirname "$log")"
: > "$log"
for f in tests/typed/*.test.mjs tests/framework/*.test.mjs tests/workbench/*.test.mjs \
  tests/stdlib/*.test.mjs tests/tensor/*.test.mjs; do
  case "$f" in *-gpu.test.mjs) continue ;; esac
  out=$(node --test "$f" 2>&1)
  pass=$(grep -c '^ℹ pass' <<<"$out" >/dev/null && sed -n 's/^ℹ pass \([0-9]*\)$/\1/p' <<<"$out" | tail -1)
  fail=$(sed -n 's/^ℹ fail \([0-9]*\)$/\1/p' <<<"$out" | tail -1)
  total=$(sed -n 's/^ℹ tests \([0-9]*\)$/\1/p' <<<"$out" | tail -1)
  if [ "${fail:-1}" = "0" ]; then echo "ok $f $pass/$total" >> "$log"; else echo "FAIL $f fail=$fail" >> "$log"; fi
done
echo DONE >> "$log"
