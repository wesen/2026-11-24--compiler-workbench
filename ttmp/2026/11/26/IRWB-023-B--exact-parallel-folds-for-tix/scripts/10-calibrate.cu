#include <cuda_runtime.h>
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include "power.cuh"
#include "exp.cuh"

using U64=unsigned long long;
static void check(cudaError_t e) { if(e!=cudaSuccess) { puts(cudaGetErrorString(e)); exit(1); } }

template<int bits,int degree>
__global__ void constrain(unsigned first,unsigned end,int window,U64* lows,U64* highs) {
  constexpr int B=1<<bits;
  for(unsigned mag=first+blockIdx.x*blockDim.x+threadIdx.x;mag<end;mag+=gridDim.x*blockDim.x) {
    float x=-__uint_as_float(mag);
    unsigned ref=__float_as_uint(__double2float_rn(exp(double(x))));
    int k=__float2int_rn(__fmul_rn(x,float(B)*0x1.715476p+0f));
    int cell=k&(B-1);
    // A positive table entry scales the positive (1+u) before monotone rounding.
    if(__float_as_uint(shortExp<bits,degree>(x,-window))<ref) {
      int lo=-window,hi=window+1;
      while(hi-lo>1) {
        int m=lo+(hi-lo)/2;
        if(__float_as_uint(shortExp<bits,degree>(x,m))<ref) lo=m; else hi=m;
      }
      atomicMax(&lows[cell],(U64(hi+window+1)<<32)|mag);
    }
    if(__float_as_uint(shortExp<bits,degree>(x,window))>ref) {
      int lo=-window-1,hi=window;
      while(hi-lo>1) {
        int m=lo+(hi-lo)/2;
        if(__float_as_uint(shortExp<bits,degree>(x,m))>ref) hi=m; else lo=m;
      }
      atomicMin(&highs[cell],(U64(lo+window+1)<<32)|mag);
    }
  }
}
template<int bits,int degree>
void run(unsigned first,unsigned end,int w) {
  constexpr int B=1<<bits;
  U64 *dl,*dh;
  check(cudaMalloc(&dl,B*sizeof(U64))); check(cudaMalloc(&dh,B*sizeof(U64)));
  check(cudaMemset(dl,0,B*sizeof(U64))); check(cudaMemset(dh,255,B*sizeof(U64)));
  constrain<bits,degree><<<1024,256>>>(first,end,w,dl,dh);
  std::vector<U64> l(B),h(B);
  check(cudaMemcpy(l.data(),dl,B*sizeof(U64),cudaMemcpyDeviceToHost));
  check(cudaMemcpy(h.data(),dh,B*sizeof(U64),cudaMemcpyDeviceToHost));
  unsigned impossible=0,outside=0,changes=0;
  for(int t=0;t<B;t++) {
    int low=l[t]?int(l[t]>>32)-w-1:-w,high=h[t]!=~U64(0)?int(h[t]>>32)-w-1:w;
    if(low>high) {
      if(l[t] && h[t]!=~U64(0)) {
        if(!impossible) printf("conflict B=%d deg=%d cell=%d lower=%d at=%08x upper=%d at=%08x\n",
          B,degree,t,low,unsigned(l[t]),high,unsigned(h[t]));
        impossible++;
      } else outside++;
    } else {
      int chosen=std::clamp(0,low,high);
      if(chosen) {
        printf("fix %d %d %d %d [%d,%d]\n",B,degree,t,chosen,low,high);
        changes++;
      }
    }
  }
  printf("summary B=%d deg=%d window=%d impossible=%u outside=%u fixes=%u\n",B,degree,w,impossible,outside,changes);
  check(cudaFree(dl)); check(cudaFree(dh));
}
int main(int argc,char** argv) {
  unsigned first=argc>1?strtoul(argv[1],nullptr,16):startMag;
  unsigned end=argc>2?strtoul(argv[2],nullptr,16):stopMag;
  if(first<startMag || end>stopMag || first>=end) return 2;
  run<7,3>(first,end,65536); run<7,4>(first,end,64);
  run<10,2>(first,end,65536); run<10,3>(first,end,64);
  run<12,2>(first,end,512); run<14,2>(first,end,128);
}
