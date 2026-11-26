#include <cuda_runtime.h>
#include <cstdio>
#include <cstdlib>
#include <algorithm>
#include <vector>
#include "power.cuh"
#include "exp.cuh"
constexpr int methods=6, keep=128;
struct Hit { unsigned mag,got,want; };
struct Stats { unsigned count[methods]; Hit hits[methods][keep]; };

__device__ void record(int variant,unsigned mag,float got,unsigned want,Stats* out) {
  unsigned v=__float_as_uint(got);
  unsigned mask=__ballot_sync(0xffffffffu,v!=want);
  if (!mask) return;
  unsigned base=0, lane=threadIdx.x%32;
  if (lane==0) base=atomicAdd(&out->count[variant],__popc(mask));
  base=__shfl_sync(0xffffffffu,base,0);
  unsigned rank=base+__popc(mask&((1u<<lane)-1));
  if (v!=want && rank<keep) out->hits[variant][rank]={mag,v,want};
}
__global__ void sweep(unsigned first,unsigned last,Stats* out) {
  for (unsigned mag=first+blockIdx.x*blockDim.x+threadIdx.x;mag<last;mag+=gridDim.x*blockDim.x) {
    float x=-__uint_as_float(mag);
    unsigned want=__float_as_uint(__double2float_rn(exp(double(x))));
    record(0,mag,expf(x),want,out);
    record(1,mag,shortExp<7,2>(x),want,out);
    record(2,mag,shortExp<7,3>(x),want,out);
    record(3,mag,shortExp<10,2>(x),want,out);
    record(4,mag,shortExp<10,3>(x),want,out);
    record(5,mag,shortExp<7,4>(x),want,out);
  }
}
static void check(cudaError_t e) { if(e!=cudaSuccess) { puts(cudaGetErrorString(e)); exit(1); } }
int main(int argc,char** argv) {
  unsigned first=argc>1?strtoul(argv[1],nullptr,16):startMag;
  unsigned last=argc>2?strtoul(argv[2],nullptr,16):stopMag;
  if (first>=last || first%32 || last%32 || last>0x7f800000u) return 2;
  Stats* d; Stats h{}; check(cudaMalloc(&d,sizeof(h))); check(cudaMemset(d,0,sizeof(h)));
  sweep<<<1024,256>>>(first,last,d); check(cudaMemcpy(&h,d,sizeof(h),cudaMemcpyDeviceToHost));
  printf("range %08x %08x count %u\n",first,last,last-first);
  for (int m=0;m<methods;++m) {
    printf("variant %d mismatches %u\n",m,h.count[m]);
    unsigned n=std::min(h.count[m],(unsigned)keep);
    std::sort(h.hits[m],h.hits[m]+n,[](Hit a,Hit b){return a.mag<b.mag;});
    if(h.count[m]>keep) n=std::min(n,3u);
    for (unsigned i=0;i<n;++i) {
      Hit p=h.hits[m][i];
      printf("hit %d %08x %08x %08x\n",m,p.mag,p.got,p.want);
    }
  }
}
