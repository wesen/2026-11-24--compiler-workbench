# Candela images: 332 functions, 100 cases each

Produced on build e3e91b1 (branch worktree-agent-a00035077b8e1dd46) by

    node --max-old-space-size=12288 tools/candela-image.mjs --count 100 --head <head.json> --policies stock,kernel \
      --json f32-backend-01-candela-images.json --table f32-backend-01-candela-images.tsv

where <head.json> is the O2 head (r13, 9,479 statements) saved by `tools/candela-o2.mjs --save`; 22 min 26 s wall clock. r0 and o2 are our images (judged by the evaluator of the revision each was lowered from); stock and kernel are the reference compiler (typed-rv32.js) on the source (judged by the evaluator of r0). Instructions are summed over the cases every image and evaluator finished (limits 2e5 statements, 2e7 instructions). This summary: `node tools/candela-image-summary.mjs f32-backend-01-candela-images.json`.

O2 against r0 per function: 180 functions run fewer instructions, 21 more (not investigated; licm and lvn add copies, diary 04 step 9).

Decided cases (every image and evaluator within its limit): 32985 of 33200 (31617 values, 1368 traps).

| image | bytes | agree | disagree | inconclusive | instructions | per case |
|---|---:|---:|---:|---:|---:|---:|
| r0 | 183324 | 32985 | 0 | 215 | 30380140 | 921 |
| o2 | 151748 | 32990 | 0 | 210 | 28706118 | 870.3 |
| stock | 312740 | 32985 | 0 | 215 | 52730673 | 1598.6 |
| kernel | 434996 | 32985 | 0 | 215 | 24662932 | 747.7 |

Against the stock image (second oracle), disagreements: {"r0":0,"o2":0}.

- r0 against stock: bytes 58.6%, instructions 57.6%
- r0 against kernel: bytes 42.1%, instructions 123.2%
- o2 against stock: bytes 48.5%, instructions 54.4%
- o2 against kernel: bytes 34.9%, instructions 116.4%
- o2 against r0: bytes 82.8%, instructions 94.5%

## Largest gaps (o2 − kernel, instructions over the decided cases)

| function | Σ o2 − kernel | per case r0 | per case o2 | per case stock | per case kernel | bytes r0 | bytes o2 | bytes stock | bytes kernel |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| fbm3 | 1816436 | 77314.8 | 77709.1 | 134638 | 58588.7 | 272 | 288 | 380 | 2016 |
| cdlRenderSpan | 870466 | 77169.1 | 71612.2 | 130333.7 | 62046.6 | 640 | 636 | 1116 | 692 |
| s16_mat_0 | 214147 | 9773.6 | 9677.2 | 16677.6 | 7535.7 | 1348 | 948 | 1968 | 4812 |
| s16_bumpN_1 | 192918 | 8015 | 8056.4 | 13620.1 | 6127.3 | 540 | 568 | 764 | 724 |
| s15_sdf_0 | 184904 | 7498.5 | 7544.5 | 12964.8 | 5695.5 | 224 | 264 | 368 | 376 |
| s17_hf_0 | 157994 | 6458 | 6487.9 | 11066 | 4907.9 | 192 | 176 | 260 | 1320 |
| s12_dens_0 | 151540 | 6298.5 | 6333.5 | 10879.4 | 4818.1 | 484 | 480 | 696 | 664 |
| s13_dens_0 | 149170 | 6301.1 | 6336.1 | 10897.3 | 4844.4 | 636 | 632 | 1048 | 772 |
| s5_mat_0 | 145843 | 6896.2 | 6812 | 11845.2 | 5353.6 | 1928 | 1404 | 2668 | 5800 |
| s14_mat_1 | 134860 | 6611.3 | 6501.1 | 11444.6 | 5152.4 | 1408 | 964 | 1972 | 2164 |
| s14_sdf_0 | 119232 | 4967.8 | 5001.8 | 8584.1 | 3809.5 | 240 | 256 | 388 | 312 |
| s14_sdf_1 | 119232 | 4967.8 | 5001.8 | 8584.1 | 3809.5 | 240 | 256 | 388 | 312 |

## Largest wins

| function | Σ o2 − kernel | per case r0 | per case o2 | per case stock | per case kernel | bytes r0 | bytes o2 | bytes stock | bytes kernel |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| cdlInit | -77300 | 2794 | 2027 | 4107 | 2800 | 12200 | 9132 | 17452 | 12224 |
| hitEmission | -30595 | 353.2 | 268.9 | 794.9 | 574.8 | 184 | 80 | 580 | 528 |
| s15_evalMaterial | -26960 | 195.6 | 137.4 | 487.8 | 407 | 824 | 812 | 2116 | 4852 |
| s6_evalMaterial | -26655 | 203.2 | 145.8 | 494.9 | 412.3 | 856 | 852 | 2132 | 4904 |
| hitAlbedo | -26598 | 363.4 | 287 | 812.1 | 553 | 296 | 224 | 776 | 540 |
| s14_evalMaterial | -21976 | 383.2 | 327.9 | 804.1 | 547.7 | 696 | 692 | 1720 | 4492 |
| evalMaterial | -19172 | 304.1 | 246.4 | 646.2 | 438.1 | 3852 | 3852 | 9400 | 9264 |
| lobeNone | -16100 | 92 | 40 | 245 | 201 | 368 | 160 | 980 | 804 |
| s15_mat_0 | -13415 | 489.4 | 342.1 | 840 | 476.3 | 1552 | 1104 | 2224 | 2044 |
| s17_evalMaterial | -12940 | 173 | 117.2 | 466.5 | 246.6 | 472 | 460 | 1280 | 1388 |
| noHit | -12800 | 60 | 29 | 212 | 157 | 240 | 116 | 848 | 628 |
| s14_mat_0 | -12445 | 352.9 | 217.9 | 652 | 342.3 | 1048 | 628 | 1512 | 1532 |

