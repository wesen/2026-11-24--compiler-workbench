| Program (shape values) | Kernels fused / stage 2 | Block-mode kernels and their reductions |
| --- | ---: | --- |
| matmul (M=512, K=512, N=512) | 1 / 1 | k0 thread y |
| softmax (N=4096, C=1024) | 1 / 4 | k0 block[1] m,e,s,y: no parallel terms; serial m:max(C) s:sum(C) |
| layernorm (N=4096, D=1024) | 1 / 4 | k0 block[1] mean,centered,variance,y: no parallel terms; serial mean:sum(D) variance:sum(D) |
| attention (Q=1024, K=1024, D=64, V=64) | 1 / 6 | k0 block[1] score,shift,e,z,weight,out: no parallel terms; serial score:sum(D) shift:max(K) z:sum(K) out:sum(K) |
| mlp (N=1024, D=256, H=1024, O=256) | 1 / 3 | k0 block[1] h,g,y: no parallel terms; serial h:sum(D) y:sum(H) |
| conv2d (N=8, C=16, H=64, W=64, O=32) | 1 / 1 | k0 thread out |
| layernorm_inside (N=4096, D=1024) | 1 / 4 | k0 block[1] mean,centered,variance,y: parallel terms mean:sum(D) variance:sum(D) |
| attention_inside (Q=1024, K=1024, D=64, V=64) | 1 / 5 | k0 block[1] score,shift,e,l,out: no parallel terms; serial score:sum(D) shift:max(K) l:sum(K) out:sum(K) |
| softmax_exp_in_sum (N=4096, C=1024) | 1 / 3 | k0 block[1] m,s,y: parallel terms s:sum(C); serial m:max(C) |
| longterm (N=2048, D=1024, C=8) | 1 / 2 | k0 block[1] s,e: parallel terms s:sum(D) |
| softmax (N=524288, C=4) | 4 / 4 | k0 thread m<br>k1 thread e<br>k2 thread s<br>k3 thread y — **gated** (width 4): m,e,s,y |
| softmax (N=262144, C=8) | 4 / 4 | k0 thread m<br>k1 thread e<br>k2 thread s<br>k3 thread y — **gated** (width 8): m,e,s,y |
| softmax (N=131072, C=16) | 4 / 4 | k0 thread m<br>k1 thread e<br>k2 thread s<br>k3 thread y — **gated** (width 16): m,e,s,y |
| softmax (N=65536, C=32) | 1 / 4 | k0 block[1] m,e,s,y: no parallel terms; serial m:max(C) s:sum(C) |
| softmax (N=32768, C=64) | 1 / 4 | k0 block[1] m,e,s,y: no parallel terms; serial m:max(C) s:sum(C) |
