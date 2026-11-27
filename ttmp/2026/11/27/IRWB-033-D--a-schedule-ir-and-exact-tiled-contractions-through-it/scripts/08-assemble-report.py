import subprocess, glob, re
root='/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-op-irwb-033-d/'
S=glob.glob(root+'ttmp/2026/11/27/IRWB-033-D*/scripts')[0]
out=subprocess.run(['node',S+'/07-report-tables.mjs'],capture_output=True,text=True).stdout
blocks=out.strip().split('\n\n')
corpus,contr,other,variants,cost=blocks
R=glob.glob(root+'ttmp/2026/11/27/IRWB-033-D*/reference/02-report*.md')[0]
s=open(R).read()
head=open(''+S+'/08-report-frontmatter.md').read()
body=open(''+S+'/08-report-body-head.md').read()+open(''+S+'/08-report-body.md').read()
body=body.replace('CORPUS_TABLE',corpus).replace('CONTRACTION_TABLE',contr+'\n\n**Other shapes** (matmul; fused against unfused, same protocol; measured before the rule\'s last line, variant 0 for grids under one block per SM, was added: with it 1 × 1 × 4096 ran 0.0974 ms fused against 0.0971 unfused and 100³ 0.0086 against 0.0086, script 09):\n\n'+other).replace('VARIANT_TABLE',variants)
body=body.replace('CASES_TABLE',cost+'\n\nA case list is 4 times stage 3b\'s for a program with contraction kernels (2 times was 3b\'s for gated programs), from one compilation; each mode is one GPU batch, run in parallel. `checkLowering` took 7 to 12 s of wall time per corpus program fused (script 02, binary in the remote build cache: mostly ssh and process start), against 5 to 12 s unfused. Scheduling (first call per function) is the CPU time in the last column, on this shared machine.')
open(R,'w').write(head+body)
print('ok', len(body))
