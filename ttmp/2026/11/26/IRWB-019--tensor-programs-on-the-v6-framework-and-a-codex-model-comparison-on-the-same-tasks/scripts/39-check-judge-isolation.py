#!/usr/bin/env python3
"""Check that blind Codex judges stayed blind: scan each judge session's commands and tool calls (Codex rollouts in
~/.codex/sessions) for references outside the pack and the base repository: the blind keys, the config keys, the
coordinator's ticket (IRWB-019), the kit logs, and any worktree other than the allowed base.

Usage: 39-check-judge-isolation.py <pack-dir-substring>... [--days 2026/11/26,2026/11/27] [--allow t1-judge-base,r2-base]
"""
import argparse
import json
import os
import re

ap = argparse.ArgumentParser()
ap.add_argument('packs', nargs='+')
ap.add_argument('--days', default='2026/11/26,2026/11/27')
ap.add_argument('--allow', default='t1-judge-base,r2-base,t2-base')
a = ap.parse_args()
allow = '|'.join(re.escape(x) for x in a.allow.split(','))
outside = re.compile(r'(blind-key[^\s"\']*|config-key[^\s"\']*|IRWB-019[^\s"\']*|worktrees/(?!' + allow + r')[\w.-]+|/kit/[\w.-]+)')
root = os.path.expanduser('~/.codex/sessions')
for day in a.days.split(','):
    d = os.path.join(root, day)
    if not os.path.isdir(d):
        continue
    for name in sorted(os.listdir(d)):
        path = os.path.join(d, name)
        with open(path, encoding='utf-8') as fh:
            head = fh.read(4000)
        m = re.search(r'"cwd":"([^"]*)"', head)
        if not m or not any(p in m.group(1) for p in a.packs):
            continue
        calls = []
        with open(path, encoding='utf-8') as fh:
            for line in fh:
                o = json.loads(line)
                p = o.get('payload') or {}
                if o.get('type') == 'response_item' and p.get('type') in ('function_call', 'custom_tool_call'):
                    calls.append(str(p.get('arguments') or p.get('input') or ''))
        hits = sorted(set(outside.findall('\n'.join(calls))))
        print(f"{name[9:28]} {m.group(1).rsplit('/', 1)[-1]:14} tool calls {len(calls):4}  outside-pack references: {hits[:10] or 'none'}")
