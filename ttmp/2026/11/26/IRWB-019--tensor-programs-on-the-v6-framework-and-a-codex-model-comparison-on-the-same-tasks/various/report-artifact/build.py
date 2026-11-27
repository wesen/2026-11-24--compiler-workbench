#!/usr/bin/env python3
"""Build the Tix compiler report page (index.html) with source links pinned to one pushed commit."""
import html, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
REV = 'e72865e'
GH = f'https://github.com/wesen/2026-11-24--compiler-workbench'
REFS = json.load(open(os.path.join(HERE, 'references.json')))
T19 = 'ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks'
TK = {
    'T1': 'ttmp/2026/11/26/IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes',
    'T2': 'ttmp/2026/11/26/IRWB-022-I--lowering-tix-to-cuda-with-checked-execution-on-the-gpu-machine',
    'T3': 'ttmp/2026/11/26/IRWB-029-D--checked-fusion-of-tix-kernels-on-the-gpu',
    'T3b': 'ttmp/2026/11/27/IRWB-030-E--fusion-that-is-never-slower-parallel-terms-serial-fold-and-a-cost-gate',
    'F14': 'ttmp/2026/11/26/IRWB-024--framework-and-tensor-fixes-f14-f19-f20',
    'F2': 'ttmp/2026/11/26/IRWB-028--typed-side-fixes-f2-to-f6',
    'F23': 'ttmp/2026/11/27/IRWB-031--f23-check-correspondence-entity-lists-against-the-artifacts',
    'F24': 'ttmp/2026/11/27/IRWB-032--f24-to-f26-kernel-entities-the-gate-s-choice-the-baseline-key-contract',
}


def src(path, label=None, tree=False):
    kind = 'tree' if tree else 'blob'
    return f'<a class="src" href="{GH}/{kind}/{REV}/{path}">{html.escape(label or path)}</a>'


def refs(*topics):
    items = []
    for t in topics:
        for r in REFS.get(str(t), []):
            items.append(f'<li><a href="{html.escape(r["url"])}">{html.escape(r["title"])}</a><span class="what">{html.escape(r["what"])}</span></li>')
    return '<ul class="refs">' + ''.join(items) + '</ul>' if items else ''


def files(*pairs):
    return '<ul class="files">' + ''.join(f'<li>{src(p, l)}</li>' for p, l in pairs) + '</ul>'


page = open(os.path.join(HERE, 'template.html')).read()
import re, urllib.parse, subprocess
VREV = 'd72f4c6'
VGH = 'https://github.com/go-go-golems/go-go-parc'
for frag in ('FRAMEWORK_BIG', 'WORKFLOW_BIG', 'DOCS_BIG'):
    page = page.replace('{{' + frag + '}}', open(os.path.join(HERE, frag.split('_')[0].lower() + '.html')).read())
LINKS = []
def _src(m):
    LINKS.append(('repo', m.group(1)))
    kind = 'tree' if subprocess.run(['git', '-C', '/home/manuel/code/wesen/2026-11-24--compiler-workbench', 'cat-file', '-t', f'{REV}:{m.group(1)}'], capture_output=True, text=True).stdout.strip() == 'tree' else 'blob'
    return f'<a class="src" href="{GH}/{kind}/{REV}/{urllib.parse.quote(m.group(1))}">{html.escape(m.group(2))}</a>'
def _vault(m):
    LINKS.append(('vault', m.group(1)))
    return f'<a class="src" href="{VGH}/blob/{VREV}/{urllib.parse.quote(m.group(1))}">{html.escape(m.group(2))}</a>'
page = re.sub(r'\{\{src:([^|}]+)\|([^}]+)\}\}', _src, page)
page = re.sub(r'\{\{vault:([^|}]+)\|([^}]+)\}\}', _vault, page)
for key, val in {
    '{{REV}}': f'<a class="src" href="{GH}/tree/{REV}">{REV}</a>',
    '{{REPO}}': f'<a href="{GH}">{GH.replace("https://", "")}</a>',
}.items():
    page = page.replace(key, val)


def sub(name, value):
    global page
    assert '{{' + name + '}}' in page, name
    page = page.replace('{{' + name + '}}', value)


sub('FILES_FRAMEWORK', files(('src/framework/contracts/README.md', 'contracts/README.md'), ('src/framework/ir/README.md', 'ir/README.md'),
                             ('src/framework/passes/define-pass.ts', 'passes/define-pass.ts'), ('src/framework/contracts/differential.ts', 'contracts/differential.ts'),
                             ('src/framework/contracts/analysis-manager.ts', 'contracts/analysis-manager.ts'), ('src/framework/ir/correspondence.ts', 'ir/correspondence.ts')))
sub('REFS_FRAMEWORK', refs(4, 5, 3, 16))
sub('FILES_T1', files(('src/tensor/parser.ts', 'tensor/parser.ts'), ('src/tensor/ir.ts', 'tensor/ir.ts'), ('src/tensor/evaluate.ts', 'tensor/evaluate.ts'),
                      ('src/tensor/passes.ts', 'tensor/passes.ts'), ('src/tensor/contract.ts', 'tensor/contract.ts'), ('corpus/tensor', 'corpus/tensor/'),
                      (TK['T1'] + '/reference/02-report.md', 'IRWB-020-B report')))
sub('REFS_T1', refs(9, 14))
sub('FILES_T2', files(('src/tensor/cuda-source.ts', 'tensor/cuda-source.ts'), ('src/tensor/cuda-runtime.ts', 'tensor/cuda-runtime.ts'),
                      ('src/tensor/cuda-contract.ts', 'tensor/cuda-contract.ts'), ('tools/cuda-remote.mjs', 'tools/cuda-remote.mjs'),
                      (TK['T2'] + '/reference/02-report.md', 'IRWB-022-I report')))
sub('REFS_T2', refs(20, 18, 10, 11))
sub('FILES_T3', files(('src/tensor/fusion.ts', 'tensor/fusion.ts'), ('src/tensor/cuda-source.ts', 'tensor/cuda-source.ts'),
                      ('tests/tensor/fusion.test.mjs', 'tests/tensor/fusion.test.mjs'), ('tests/tensor/fusion-gpu.test.mjs', 'tests/tensor/fusion-gpu.test.mjs'),
                      (TK['T3'] + '/reference/02-report-checked-fusion-of-tix-kernels.md', 'IRWB-029-D report')))
sub('REFS_T3', refs(19, 7))
sub('FILES_T3B', files(('src/tensor/fusion.ts', 'tensor/fusion.ts (terms, gate)'), ('tests/tensor/terms-gpu.test.mjs', 'tests/tensor/terms-gpu.test.mjs'),
                       (TK['T3b'] + '/reference/02-report-fusion-that-is-never-slower.md', 'IRWB-030-E report')))
sub('FILES_FIXES', files((TK['F14'] + '/index.md', 'IRWB-024 (F14, F19, F20)'), (TK['F2'] + '/index.md', 'IRWB-028 (F2–F6)'),
                         (TK['F23'] + '/index.md', 'IRWB-031 (F23)'), (TK['F24'] + '/index.md', 'IRWB-032 (F24–F26)'), ('BACKLOG.md', 'BACKLOG.md')))
sub('FILES_EVAL', files((T19 + '/various/hidden-t3/t3-eval.mjs', 'hidden-t3/t3-eval.mjs'), (T19 + '/various/hidden-t3b/t3b-eval.mjs', 'hidden-t3b/t3b-eval.mjs'),
                        (T19 + '/various/hidden-t6/t6-eval.mjs', 'hidden-t6/t6-eval.mjs'), (T19 + '/scripts/43-probe-division-placement.mjs', 'scripts/43-probe-division-placement.mjs')))
sub('FILES_AGENTS', files((T19 + '/log/01-diary.md', 'IRWB-019 diary'), (T19 + '/various/results', 'results/'), (T19 + '/scripts', 'scripts/'),
                          (T19 + '/various/prompts', 'prompts/ (every brief)')))
sub('REFS_AGENTS', refs(17))
sub('REFS_T6', refs(1, 2, 8, 6, 13, 12, 15))
open(os.path.join(HERE, 'index.html'), 'w').write(page)
json.dump(LINKS, open(os.path.join(HERE, 'links.json'), 'w'))
print('ok', len(page))
