# IRWB-033-E script 09: put script 08's tables into the report at their @@NAME@@ markers (kept in
# scripts/09-report.template.md, so the report can be regenerated when a measurement file changes).
import os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
ref = os.path.join(here, '..', 'reference')
out = subprocess.run([sys.executable, os.path.join(here, '08-report-tables.py')], capture_output=True, text=True).stdout
sections, name = {}, None
for line in out.splitlines():
    if line.isupper() and line.isalpha(): name = line; sections[name] = []
    elif name: sections[name].append(line)
text = open(os.path.join(here, '09-report.template.md')).read()
for key, lines in sections.items():
    text = text.replace(f'@@{key}@@', '\n'.join(lines).strip())
open(os.path.join(ref, '02-report-schedule-ir-and-exact-tiled-contractions.md'), 'w').write(text)
