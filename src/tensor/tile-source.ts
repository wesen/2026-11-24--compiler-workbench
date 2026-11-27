import type { Tile } from './schedule.js';

// Both panel barriers are reached by all lanes, even when only one output is in bounds.
export function printTile(t: Tile, left: string, right: string, m: string, n: string, k: string, store: string) {
  const [ly,lx] = t.lanes, [ry,rx] = t.registers;
  const bm = ly*ry, bn = lx*rx, bk = t.depth;
  const bRead = t.transposed ? `${right}[col*K + start+q]` : `${right}[(start+q)*N + col]`;
  const aRead = `${left}[row*K + start+q]`;
  const panels = t.shared ? `
    __shared__ float A[${bk}][${bm}+1], B[${bk}][${bn}];
    for (int u=tid; u<${bm*bk}; u+=${ly*lx}) {
      const int y=u/${bk}, q=u%${bk};
      const I row=baseY+y;
      A[q][y] = row<M && start+q<K ? ${aRead} : 0.0f;
    }
    for (int u=tid; u<${bk*bn}; u+=${ly*lx}) {
      const int x=${t.transposed ? 'u/'+bk : 'u%'+bn}, q=${t.transposed ? 'u%'+bk : 'u/'+bn};
      const I col=baseX+x;
      B[q][x] = col<N && start+q<K ? ${bRead} : 0.0f;
    }
    __syncthreads();` : '';
  return `
  const I M=${m}, N=${n}, K=${k};
  const I cols=(N+${bn-1})/${bn};
  const I baseY=(blockIdx.x/cols)*${bm}, baseX=(blockIdx.x%cols)*${bn};
  const int tid=threadIdx.x, ty=tid/${lx}, tx=tid%${lx};
  float acc[${ry}][${rx}] = {};
  for (I start=0; start<K; start+=${bk}) {
    ${panels}
    #pragma unroll
    for (int q=0; q<${bk}; ++q) {
      if (start+q<K) {
        float a[${ry}], b[${rx}];
        #pragma unroll
        for (int y=0; y<${ry}; ++y) {
          const I row=baseY+ty+y*${ly};
          a[y]=${t.shared ? `A[q][ty+y*${ly}]` : `row<M ? ${aRead} : 0.0f`};
        }
        #pragma unroll
        for (int x=0; x<${rx}; ++x) {
          const I col=baseX+tx+x*${lx};
          b[x]=${t.shared ? `B[q][tx+x*${lx}]` : `col<N ? ${bRead} : 0.0f`};
        }
        #pragma unroll
        for (int y=0; y<${ry}; ++y)
          #pragma unroll
          for (int x=0; x<${rx}; ++x)
            acc[y][x]=__fadd_rn(acc[y][x],__fmul_rn(a[y],b[x]));
      }
    }
    ${t.shared ? '__syncthreads();' : ''}
  }
  #pragma unroll
  for (int y=0; y<${ry}; ++y) {
    const I row=baseY+ty+y*${ly};
    #pragma unroll
    for (int x=0; x<${rx}; ++x) {
      const I col=baseX+tx+x*${lx};
      if (row<M && col<N) {
        ${store}
      }
    }
  }
  return;`;
}
