"""Assemble the full user guide from reviewed chapter sources."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
parts = sorted((ROOT / 'docs/guide-parts').glob('*.md'))
chapters = '\n\n'.join(p.read_text().strip() for p in parts)
headings = re.findall(r'^## (.+)$', chapters, flags=re.M)
def slug(text):
    return re.sub(r'[^\w\- ]', '', text.lower()).replace(' ', '-')
contents = '\n'.join(f'- [{title}](#{slug(title)})' for title in headings)
intro = '''# IR Workbench: a user's guide to reusable compilers

**Version 0.6.0 · TypeScript 5.9.3 · 24 November 2026**

Programs, compilation strategies, semantic contracts, and inspectable chains of intermediate representations.

This guide is for developers who want to understand, use and extend the complete framework. Start with Chapters 1 and 2 for the architecture and a first result. Follow Chapter 3 for concrete experiments. Chapters 4 through 7 explain the reusable APIs and their guarantees. Chapter 8 is the workbench manual; Chapters 9 and 10 cover extension, troubleshooting and terminology. Chapter 11 records verification and reproduction.

The five executable TypeScript tutorials under `src/guide/` are companions to the text. Focused code fragments in chapters assume the surrounding imports and definitions described there; the tutorial files are complete runnable programs.

## Contents

'''
text = intro + contents + '\n\n' + chapters + '\n'
text = text.replace('\u2011', '-').replace('\u2013', '-').replace('\u2014', ' - ')
target = ROOT / 'docs/v6-user-guide.md'
target.write_text(text)
print(f'{target}: {len(text.split())} words, {len(headings)} chapters')
