import type { Tile } from './schedule.js';

// Both panel barriers are reached by all lanes, even when only one output is in bounds.
export function printTile(
  t: Tile,
  left: string,
  right: string,
  m: string,
  n: string,
  k: string,
  store: string,
) {
  const [ly, lx] = t.lanes,
    [ry, rx] = t.registers;
  const bm = ly * ry,
    bn = lx * rx,
    bk = t.depth;
  const bRead = t.transposed ? `${right}[col*K + start+q]` : `${right}[(start+q)*N + col]`;
  const aRead = t.leftTransposed ? `${left}[(start+q)*M+row]` : `${left}[row*K + start+q]`;
  const aCoordinates = t.leftTransposed ? `y=u%${bm}, q=u/${bm}` : `y=u/${bk}, q=u%${bk}`;
  const scalarLoads = `
    for (int u=tid; u<${bm * bk}; u+=${ly * lx}) {
      const int ${aCoordinates};
      const I row=baseY+y;
      A[q][y] = full || (row<M && start+q<K) ? ${aRead} : 0.0f;
    }
    for (int u=tid; u<${bk * bn}; u+=${ly * lx}) {
      const int x=${t.transposed ? 'u/' + bk : 'u%' + bn}, q=${t.transposed ? 'u%' + bk : 'u/' + bn};
      const I col=baseX+x;
      B[q][x] = full || (col<N && start+q<K) ? ${bRead} : 0.0f;
    }`;
  const packedLoads = `
    for (int u=tid*4; u<${bm * bk}; u+=${ly * lx * 4}) {
      const int ${aCoordinates};
      const I row=baseY+y;
      const float4 v=*reinterpret_cast<const float4*>(&${aRead});
      ${
        t.leftTransposed
          ? 'A[q][y]=v.x; A[q][y+1]=v.y; A[q][y+2]=v.z; A[q][y+3]=v.w;'
          : 'A[q][y]=v.x; A[q+1][y]=v.y; A[q+2][y]=v.z; A[q+3][y]=v.w;'
      }
    }
    for (int u=tid*4; u<${bk * bn}; u+=${ly * lx * 4}) {
      const int x=${t.transposed ? 'u/' + bk : 'u%' + bn}, q=${t.transposed ? 'u%' + bk : 'u/' + bn};
      const I col=baseX+x;
      const float4 v=*reinterpret_cast<const float4*>(&${bRead});
      ${
        t.transposed
          ? 'B[q][x]=v.x; B[q+1][x]=v.y; B[q+2][x]=v.z; B[q+3][x]=v.w;'
          : '*reinterpret_cast<float4*>(&B[q][x])=v;'
      }
    }`;
  const yIndex = t.fragment === 4 ? `ty*${ry}+y` : `ty+y*${ly}`;
  const xIndex = t.fragment === 4 ? `tx*${rx}+x` : `tx+x*${lx}`;
  const panels = t.shared
    ? `
    __shared__ __align__(16) float A[${bk}][${bm}+${t.fragment}];
    __shared__ __align__(16) float B[${bk}][${bn}];
    ${t.vector === 4 ? `if constexpr(full) { ${packedLoads} } else { ${scalarLoads} }` : scalarLoads}
    __syncthreads();`
    : '';
  return `
  const I M=${m}, N=${n}, K=${k};
  auto compute = [&](auto aligned) {
  constexpr bool full = decltype(aligned)::value;
  const I cols=(N+${bn - 1})/${bn};
  const I baseY=(blockIdx.x/cols)*${bm}, baseX=(blockIdx.x%cols)*${bn};
  const int tid=threadIdx.x, ty=tid/${lx}, tx=tid%${lx};
  float acc[${ry}][${rx}] = {};
  for (I start=0; start<K; start+=${bk}) {
    ${panels}
    #pragma unroll
    for (int q=0; q<${bk}; ++q) {
      if (full || start+q<K) {
        float a[${ry}], b[${rx}];
${
  t.fragment === 4
    ? `
        #pragma unroll
        for (int y=0; y<${ry}; y+=4) {
          const float4 v=*reinterpret_cast<const float4*>(&A[q][${yIndex}]);
          a[y]=v.x; a[y+1]=v.y; a[y+2]=v.z; a[y+3]=v.w;
        }
        #pragma unroll
        for (int x=0; x<${rx}; x+=4) {
          const float4 v=*reinterpret_cast<const float4*>(&B[q][${xIndex}]);
          b[x]=v.x; b[x+1]=v.y; b[x+2]=v.z; b[x+3]=v.w;
        }`
    : `
        #pragma unroll
        for (int y=0; y<${ry}; ++y) {
          const I row=baseY+${yIndex};
          a[y]=${t.shared ? `A[q][${yIndex}]` : `row<M ? ${aRead} : 0.0f`};
        }
        #pragma unroll
        for (int x=0; x<${rx}; ++x) {
          const I col=baseX+${xIndex};
          b[x]=${t.shared ? `B[q][${xIndex}]` : `col<N ? ${bRead} : 0.0f`};
        }
`
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
    const I row=baseY+${yIndex};
    #pragma unroll
    for (int x=0; x<${rx}; ++x) {
      const I col=baseX+${xIndex};
      if (full || (row<M && col<N)) {
        ${store}
      }
    }
  }
  };
  if ((M % ${bm}) == 0 && (N % ${bn}) == 0 && (K % ${bk}) == 0)
    compute(std::true_type{});
  else compute(std::false_type{});
  return;`;
}
