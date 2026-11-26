// Appended to unmodified stage-2 softmax kernels by 02-benchmark.mjs.
// Each input row is finite. Width is in [1,1024]; host owns the dispatch.
#include <cstdlib>
enum Method { Stage2, Owner, Translate, Tree, Methods };
constexpr int threads = 128, maxCols = 1024, chunk = 32;
struct Transfer { unsigned seed, end[2]; };

__device__ float prefix(float x, int lane) {
  for (int step=1; step<32; step*=2) {
    float prior = __shfl_up_sync(0xffffffffu,x,step);
    if (lane>=step) x=__fadd_rn(x,prior);
  }
  return x;
}

struct RoundedDoubleExp {
  __device__ static float eval(float x) { return __double2float_rn(exp(static_cast<double>(x))); }
};

template<Method method, class Exp = RoundedDoubleExp>
__global__ void rowSoftmax(const float* input, float* output, int cols) {
  __shared__ float e[maxCols], work[threads], maximum, denominator;
  __shared__ Transfer table[32];
  const int lane=threadIdx.x, row=blockIdx.x;
  int base=row*cols;
  float local=-INFINITY;
  for (int j=lane;j<cols;j+=threads) local=minmax(local,input[base+j],true);
  work[lane]=local;
  __syncthreads();
  for (int step=threads/2;step>0;step/=2) {
    if (lane<step) work[lane]=minmax(work[lane],work[lane+step],true);
    __syncthreads();
  }
  if (lane==0) maximum=work[0];
  __syncthreads();
  for (int j=lane;j<cols;j+=threads) {
    float shift=__fsub_rn(input[base+j],maximum);
    e[j]=Exp::eval(shift);
  }
  __syncthreads();
  if constexpr (method==Owner) {
    if (lane==0) {
      float carry=0;
      for (int j=0;j<cols;++j) carry=__fadd_rn(carry,e[j]);
      denominator=carry;
    }
  }
  if constexpr (method==Tree) {
    float part=0;
    for (int j=lane;j<cols;j+=threads) part=__fadd_rn(part,e[j]);
    work[lane]=part;
    __syncthreads();
    for (int step=threads/2;step>0;step/=2) {
      if (lane<step) work[lane]=__fadd_rn(work[lane],work[lane+step]);
      __syncthreads();
    }
    if (lane==0) denominator=work[0];
  }
  if constexpr (method==Translate) {
    if (lane<32) {
      int first=lane*chunk, last=min(cols,first+chunk);
      float part=0;
      for (int j=first;j<last;++j) part=__fadd_rn(part,e[j]);
      float incl=prefix(part,lane);
      float pred=__shfl_up_sync(0xffffffffu,incl,1);
      unsigned seed=__float_as_uint(lane==0 ? 0.0f : pred) & ~1u;
      float a=__uint_as_float(seed), b=__uint_as_float(seed+1);
      for (int j=first;j<last;++j) { a=__fadd_rn(a,e[j]); b=__fadd_rn(b,e[j]); }
      table[lane]={seed,{__float_as_uint(a),__float_as_uint(b)}};
    }
    __syncthreads();
    if (lane==0) {
      float carry=0;
      for (int j=0;j<cols;j+=chunk) {
        Transfer t=table[j/chunk];
        unsigned w=__float_as_uint(carry), parity=w&1, s=t.seed+parity, end=t.end[parity];
        // Monotone nonnegative terms. Endpoints bound all intermediate states.
        // For this softmax row, 0 <= carry,end <= 1024; signed int fits every word.
        int d=int(w)-int(s);
        if (d==0) carry=__uint_as_float(end);
        else if ((w>>23)==(s>>23) && (s>>23)>0 && (end>>23)==(s>>23) &&
                 (w&0x7fffff)>0 && (s&0x7fffff)>0 &&
                 int(end&0x7fffff)+d<0x800000) {
          carry=__uint_as_float(end+d);
        } else {
          for (int k=j;k<min(cols,j+chunk);++k) carry=__fadd_rn(carry,e[k]);
        }
      }
      denominator=carry;
    }
  }
  __syncthreads();
  for (int j=lane;j<cols;j+=threads) output[base+j]=__fdiv_rn(e[j],denominator);
}

static unsigned rng(unsigned& s) { s^=s<<13; s^=s>>17; s^=s<<5; return s; }
static unsigned bits(float x) { unsigned u; memcpy(&u,&x,sizeof(x)); return u; }
#ifndef TIX_KERNELS_ONLY
int main(int argc,char** argv) {
  int rows=argc>1?atoi(argv[1]):4096, cols=argc>2?atoi(argv[2]):1024;
  int spread=argc>3?atoi(argv[3]):2, repeats=argc>4?atoi(argv[4]):11;
  if (rows<1 || rows>16384 || cols<1 || cols>maxCols || spread<1 || repeats<1 || repeats>31) return 2;
  cudaDeviceProp prop; check(cudaGetDeviceProperties(&prop,0));
  printf("%s sm_%d%d rows=%d cols=%d spread=%d repeats=%d\n",prop.name,prop.major,prop.minor,rows,cols,spread,repeats);
  int count=rows*cols;
  DeviceBuffer x(count), maxRow(rows), expRow(count), sumRow(rows), output(count);
  std::vector<float> host(count), baseline(count), result(count);
  unsigned seed=23023;
  for (float& v:host) v=(float(rng(seed)>>8)*0x1p-24f-0.5f)*spread;
  x.upload(host.data());
  auto launch=[&](int variant) {
    switch (variant) {
    case Stage2:
      k0<<<(rows+255)/256,256>>>(rows,cols,x.ptr,maxRow.ptr,rows);
      k1<<<(count+255)/256,256>>>(rows,cols,x.ptr,maxRow.ptr,expRow.ptr,count);
      k2<<<(rows+255)/256,256>>>(rows,cols,expRow.ptr,sumRow.ptr,rows);
      k3<<<(count+255)/256,256>>>(rows,cols,expRow.ptr,sumRow.ptr,output.ptr,count); break;
    case Owner: rowSoftmax<Owner><<<rows,threads>>>(x.ptr,output.ptr,cols); break;
    case Translate: rowSoftmax<Translate><<<rows,threads>>>(x.ptr,output.ptr,cols); break;
    case Tree: rowSoftmax<Tree><<<rows,threads>>>(x.ptr,output.ptr,cols); break;
    }
    check(cudaGetLastError());
  };
  std::vector<float> samples[Methods];
  const char* names[]={"stage2","owner","translate","tree"};
  for (int m=0;m<Methods;++m) {
    launch(m); output.download(result.data());
    if (m==0) baseline=result;
    int wrong=0; for (int i=0;i<count;++i) wrong+=bits(result[i])!=bits(baseline[i]);
    printf("%s mismatches %d/%d\n",names[m],wrong,count);
    if (m!=Tree && wrong) return 3;
  }
  Event begin,finish;
  for (int k=0;k<repeats;++k) for (int i=0;i<Methods;++i) {
    int m=(i+k)%Methods;
    check(cudaEventRecord(begin.handle)); launch(m); check(cudaEventRecord(finish.handle));
    check(cudaEventSynchronize(finish.handle));
    float ms; check(cudaEventElapsedTime(&ms,begin.handle,finish.handle)); samples[m].push_back(ms);
  }
  for (int m=0;m<Methods;++m) {
    printf("%s ms",names[m]); for(float ms:samples[m]) printf(" %.6f",ms);
    puts("");
  }
}
#endif
