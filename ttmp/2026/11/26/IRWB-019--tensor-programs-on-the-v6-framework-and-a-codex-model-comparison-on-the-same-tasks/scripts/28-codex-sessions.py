#!/usr/bin/env python3
"""List the Codex sessions that ran in given worktrees, from Codex's own rollout files (~/.codex/sessions/YYYY/MM/DD).

The kit's exec logs can be overwritten (IRWB-019 step 35: a launcher re-ran an agent and truncated its log), but every
session keeps its rollout. One row per session: id, start and end (UTC), minutes, token totals, tool calls, and
whether it is an approval sidecar (whose prompt quotes "whose request action you are assessing"; not the agent itself).

Usage: 28-codex-sessions.py <worktree-substring>... [--days 2026/11/26,2026/11/27] [--json out.json]
"""
import argparse
import json
import os
from datetime import datetime

ap = argparse.ArgumentParser()
ap.add_argument('worktrees', nargs='+')
ap.add_argument('--days', default='2026/11/26,2026/11/27')
ap.add_argument('--json')
a = ap.parse_args()
root = os.path.expanduser('~/.codex/sessions')
rows = []
for day in a.days.split(','):
    d = os.path.join(root, day)
    if not os.path.isdir(d):
        continue
    for name in sorted(os.listdir(d)):
        if not name.endswith('.jsonl'):
            continue
        path = os.path.join(d, name)
        with open(path, encoding='utf-8') as fh:
            head = fh.read(200000)
        cwd = next((json.loads(l)['payload'].get('cwd') for l in head.splitlines()[:5]
                    if '"session_meta"' in l), None) or ''
        wt = next((w for w in a.worktrees if w in cwd), None)
        if not wt:
            continue
        first = last = None
        tokens = {}
        calls = 0
        with open(path, encoding='utf-8') as fh:
            for line in fh:
                o = json.loads(line)
                ts = o.get('timestamp')
                first = first or ts
                last = ts or last
                p = o.get('payload') or {}
                if p.get('type') == 'token_count' and p.get('info'):
                    tokens = p['info'].get('total_token_usage') or tokens
                if o.get('type') == 'response_item' and p.get('type') in ('function_call', 'custom_tool_call'):
                    calls += 1
        t = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))
        rows.append({
            'worktree': wt, 'session': name[-42:-6], 'start': first[11:19] + 'Z', 'end': last[11:19] + 'Z',
            'minutes': round((t(last) - t(first)).total_seconds() / 60, 1),
            'total_tokens': tokens.get('total_tokens'), 'output_tokens': tokens.get('output_tokens'),
            'reasoning_tokens': tokens.get('reasoning_output_tokens'), 'tool_calls': calls,
            'sidecar': 'whose request action you are assessing' in head,
        })
rows.sort(key=lambda r: (r['worktree'], r['start']))
for r in rows:
    print(f"{r['worktree']:20} {r['session']} {r['start']}-{r['end']} {r['minutes']:6} min "
          f"tokens {r['total_tokens']} (out {r['output_tokens']}, reasoning {r['reasoning_tokens']}) "
          f"calls {r['tool_calls']}{'  SIDECAR' if r['sidecar'] else ''}")
if a.json:
    json.dump(rows, open(a.json, 'w'), indent=1)
