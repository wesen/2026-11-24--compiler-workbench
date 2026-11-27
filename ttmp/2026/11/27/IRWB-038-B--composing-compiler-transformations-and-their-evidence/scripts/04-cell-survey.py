"""Print locators for a read-only survey, from the review worktree root."""
from pathlib import Path
import re
import subprocess

# One discriminating source site per implementation. Reading the working file
# separately from the committed diff preserves evidence of unfinished work.
sites = {
    '033': {
        'a': ('src/tensor/schedule.ts', 'planFusion(fragmentFor'),
        'b': ('src/tensor/schedule.ts', 'initialSchedule(fn, fuse ?'),
        'c': ('src/tensor/schedule.ts', 'canonical(planFusion'),
        'd': ('src/framework/passes/define-pass.ts', 'legal?(ctx'),
        'e': ('src/framework/strategy/sync.ts', 'export function executeSync'),
        'f': ('src/tensor/schedule.ts', 'const plan = fuse ?'),
        'g': ('src/tensor/schedule-passes.ts', 'params.fuse === false'),
        'h': ('src/framework/strategy/sync.ts', 'export function runPlanSync'),
        'i': ('src/tensor/schedule-passes.ts', 'const initial = toSchedule'),
        'j': ('src/tensor/schedule.ts', 'const plan: FusionPlan = planFusion')},
    '034': {c: (f'src/typed/{file}.ts', needle) for c,file,needle in [
        ('a','backend/attribution','export function attributeInstructions'),
        ('b','attribution','export function attributeInstructions'),
        ('c','backend/attribution','export function attributeInstructions'),
        ('d','attribution','export function lineageOf'),
        ('e','attribute','export function attributeTransition'),
        ('f','attribution','export function attributeSteps'),
        ('g','attribute','function stepRows')]},
    '035': {c: (file, needle) for c,file,needle in [
        ('a','src/typed/edit-classification.ts','export function classifyEdits'),
        ('b','src/typed/edit-census.ts','export function classifyRevision'),
        ('c','tools/edit-census.mjs','export function classifyEdits'),
        ('d','src/typed/edit-classes.ts','function classifyChain'),
        ('e','src/typed/edit-class.ts','function classifyEdit('),
        ('f','src/typed/edit-classes.ts','export function classifyApplication'),
        ('g','src/typed/edit-classes.ts','const chains = new Map')]},
    '036': {
        'a': ('src/typed/specialize-memory.ts','export function residualize'),
        'b': ('src/typed/residualize.ts','function version('),
        'c': ('reference/01-final-report.md','were not implemented'),
        'd': ('src/typed/specialize.ts','the binding-time analysis over'),
        'e': ('src/typed/peval.ts','This trace is the binding-time analysis'),
        'f': ('src/typed/pe.ts','export function bindingTimes'),
        'g': ('src/typed/bta.ts','for (let changed = true')}}
def git(root, *args):
    return subprocess.check_output(['git','-C',str(root),*args], text=True).strip()
def row(root, num, cell):
    ticket, = (root/'ttmp/2026/11/27').glob('IRWB-'+num+'-'+cell.upper()+'--*')
    path, needle = sites[num][cell]
    site = (ticket if path.startswith('reference/') else root)/path
    rel = str(site.relative_to(root))
    line = next(i for i,s in enumerate(site.read_text().splitlines(),1) if needle in s)
    dirty = bool(git(root,'status','--porcelain','--',rel))
    changes = git(root,'diff','--name-only','t6-base','HEAD','--','src','tools').splitlines()
    docs = sorted(f for f in ticket.rglob('*.md') if f.parent != ticket)
    report = next((f for f in docs if re.search(r'report|results',f.stem) and 'diary' not in f.stem),None)
    if not report:
        report = next(f for f in docs if 'design' in str(f.relative_to(ticket)) or 'schedule' in f.name)
    rlines = report.read_text().splitlines()
    start = next((i for i,s in enumerate(rlines,1) if s.startswith('# ')), 1)
    return (f'| {root.name} | {git(root,"rev-parse","--short","HEAD")} | {len(changes)} | '
            f'{"working copy" if dirty else "committed"} | `{rel}:{line}` | '
            f'`{report.relative_to(root)}:{start}` |')
print('| Sibling worktree | HEAD | Changed src/tools paths | Cited site | Code or negative control | Cell record |')
print('|---|---|---:|---|---|---|')
for num,cells in sites.items():
    for cell in sorted(cells):
        root, = Path('..').glob(f'*-irwb-{num}-{cell}')
        print(row(root,num,cell))
