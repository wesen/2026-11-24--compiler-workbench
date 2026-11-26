// Host/device support included verbatim in every standalone translation unit.
export const cudaRuntime = String.raw`#include <cuda_runtime.h>
#include <math_constants.h>
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <vector>
using I = long long;
using U = uint32_t;
static void fail(const char *s) { fprintf(stderr,"%s\n",s); exit(2); }
#define CK(e) do { auto rc=(e); if(rc!=cudaSuccess) fail(cudaGetErrorString(rc)); } while(0)
template<class T> T get(FILE *f) { T x; if(fread(&x,sizeof(T),1,f)!=1) fail("short input"); return x; }
template<class T> void put(FILE *f,T x) { if(fwrite(&x,sizeof(T),1,f)!=1) fail("write failed"); }
static I extent(FILE *f) { auto n=get<uint64_t>(f); if(n>9007199254740991ULL) fail("bad extent"); return I(n); }
struct Tensor {
  std::vector<I> shape;
  I n=1;
  float *dev=nullptr;
  explicit Tensor(std::vector<I> dims):shape(dims) {
    for(I d:shape) {
      if(d<0 || (d && n>std::numeric_limits<I>::max()/I(sizeof(float))/d)) fail("invalid tensor size");
      n*=d;
    }
    if(n) CK(cudaMalloc(&dev,n*sizeof(float)));
  }
  void read(FILE *f) {
    if(!n) return;
    std::vector<float> h(n);
    if(fread(h.data(),sizeof(float),n,f)!=size_t(n)) fail("short tensor");
    CK(cudaMemcpy(dev,h.data(),n*sizeof(float),cudaMemcpyHostToDevice));
  }
  void write(FILE *f,double ms) {
    put(f,U(shape.size())); for(I d:shape) put(f,uint64_t(d)); put(f,ms);
    if(!n) return;
    std::vector<float> h(n);
    CK(cudaMemcpy(h.data(),dev,n*sizeof(float),cudaMemcpyDeviceToHost));
    if(fwrite(h.data(),sizeof(float),n,f)!=size_t(n)) fail("short output");
  }
  ~Tensor(){ if(dev) CK(cudaFree(dev)); }
};
static std::vector<I> dims(FILE *f,U rank) {
  if(get<U>(f)!=rank) fail("bad input rank");
  std::vector<I> shape(rank); for(auto &d:shape) d=extent(f); return shape;
}
static unsigned blocks(I n) {
  I b=n/128+(n%128!=0); if(b>2147483647) fail("grid too large"); return unsigned(b);
}
__device__ float mx(float a,float b){return isnan(a)||isnan(b)?CUDART_NAN_F:fmaxf(a,b);}
__device__ float mn(float a,float b){return isnan(a)||isnan(b)?CUDART_NAN_F:fminf(a,b);}
struct Events {
  cudaEvent_t start,stop;
  Events(){ CK(cudaEventCreate(&start)); CK(cudaEventCreate(&stop)); }
  ~Events(){ CK(cudaEventDestroy(start)); CK(cudaEventDestroy(stop)); }
  template<class F> double measure(F launch,bool bench) {
    if(bench){ launch(); CK(cudaDeviceSynchronize()); }
    float ms[3];
    for(int j=0;j<(bench?3:1);++j){
      CK(cudaEventRecord(start)); launch(); CK(cudaEventRecord(stop)); CK(cudaEventSynchronize(stop));
      CK(cudaEventElapsedTime(ms+j,start,stop));
    }
    if(!bench) return ms[0];
    printf("benchmark_ms %.9g %.9g %.9g\n",ms[0],ms[1],ms[2]);
    std::sort(ms,ms+3); return ms[1];
  }
};
`;
