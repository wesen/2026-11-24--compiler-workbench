"""Package the complete workspace and verify every archived file against SHA-256.

Usage: python scripts/package-release.py /absolute/path/to/release.zip
The archive must be outside this project so it cannot recursively include itself.
"""
from __future__ import annotations

import hashlib
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT.parent / 'ir-source-workbench-v6-complete.zip'
if TARGET.is_relative_to(ROOT):
    raise SystemExit('Place the archive outside the workspace being packaged.')

manifest_path = ROOT / 'WORKSPACE-MANIFEST.json'
paths = sorted(p for p in ROOT.rglob('*') if p.is_file() and p != manifest_path and '__pycache__' not in p.parts)
entries = []
for path in paths:
    content = path.read_bytes()
    entries.append({'path': path.relative_to(ROOT).as_posix(), 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
manifest = {
    'formatVersion': 1,
    'release': 'v6',
    'packageVersion': json.loads((ROOT / 'package.json').read_text())['version'],
    'createdAt': datetime.now(timezone.utc).isoformat(),
    'description': 'Complete project including source, build dependencies, compiled output, tests, reports and evidence. Python bytecode caches are reproducible and excluded.',
    'files': entries,
}
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
TARGET.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(TARGET, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for path in [*paths, manifest_path]:
        archive.write(path, f'{ROOT.name}/{path.relative_to(ROOT).as_posix()}')

with zipfile.ZipFile(TARGET) as archive:
    bad = archive.testzip()
    if bad:
        raise SystemExit(f'ZIP CRC verification failed: {bad}')
    archived_manifest = json.loads(archive.read(f'{ROOT.name}/WORKSPACE-MANIFEST.json'))
    if archived_manifest != manifest:
        raise SystemExit('Archived manifest differs from the workspace manifest.')
    expected_names = {f'{ROOT.name}/{entry["path"]}' for entry in entries} | {f'{ROOT.name}/WORKSPACE-MANIFEST.json'}
    if set(archive.namelist()) != expected_names:
        raise SystemExit('Archive file set differs from the workspace manifest.')
    for entry in entries:
        content = archive.read(f'{ROOT.name}/{entry["path"]}')
        if len(content) != entry['bytes'] or hashlib.sha256(content).hexdigest() != entry['sha256']:
            raise SystemExit(f'Archived content verification failed: {entry["path"]}')

content = TARGET.read_bytes()
print(json.dumps({'archive': str(TARGET), 'files': len(entries) + 1, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest(), 'crc': 'passed', 'manifest': 'every archived file verified'}, indent=2))
