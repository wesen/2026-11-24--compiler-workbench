// The generated TU is self-contained. The binary layout matches cuda-run.ts (little-endian GB10).
export const runtime = String.raw`#include <cuda_runtime.h>
#include <stdint.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <initializer_list>
#include <vector>
using I = long long;
using U = uint32_t;
static_assert(sizeof(I)==8 && sizeof(float)==4);
void fail(const char* message) { fprintf(stderr,"Tix: %s\n",message); exit(1); }
void ck(cudaError_t error) { if(error!=cudaSuccess) fail(cudaGetErrorString(error)); }
template<class T> T get(FILE* f) { T x; if(fread(&x,sizeof(T),1,f)!=1) fail("short input"); return x; }
template<class T> void put(FILE* f,T x) { if(fwrite(&x,sizeof(T),1,f)!=1) fail("short output"); }
struct Tensor {
  std::vector<I> dims;
  I count=1;
  float* ptr=nullptr;
  void allocate() {
    for(I x:dims) {
      if(x<0 || (x && count>INT64_MAX/4/x)) fail("tensor extent overflow");
      count*=x;
    }
    if(count) ck(cudaMalloc(&ptr,count*sizeof(float)));
  }
  explicit Tensor(std::initializer_list<I> ds):dims(ds) { allocate(); }
  Tensor(FILE* f,U rank) {
    if(get<U>(f)!=rank) fail("rank mismatch");
    for(U j=0;j<rank;j++) dims.push_back(get<I>(f));
    allocate();
    if(count) {
      std::vector<float> buf(count);
      if(fread(buf.data(),4,count,f)!=size_t(count)) fail("short tensor");
      ck(cudaMemcpy(ptr,buf.data(),count*4,cudaMemcpyHostToDevice));
    }
  }
  void write(FILE* f,float ms) const {
    put(f,U(dims.size())); for(I x:dims) put(f,x);
    if(count) {
      std::vector<float> buf(count);
      ck(cudaMemcpy(buf.data(),ptr,count*4,cudaMemcpyDeviceToHost));
      if(fwrite(buf.data(),4,count,f)!=size_t(count)) fail("short result");
    }
    put(f,ms);
  }
  ~Tensor(){ if(ptr) ck(cudaFree(ptr)); }
};
__device__ float maximum(float x,float y) {
  if(isnan(x)||isnan(y)) return NAN;
  if(x==0.f && y==0.f) return __uint_as_float(__float_as_uint(x)&__float_as_uint(y));
  return x>y?x:y;
}
__device__ float minimum(float x,float y) {
  if(isnan(x)||isnan(y)) return NAN;
  if(x==0.f && y==0.f) return __uint_as_float(__float_as_uint(x)|__float_as_uint(y));
  return x<y?x:y;
}
__device__ I index_at(I i,I dim) { if(i<0 || i>=dim) asm("trap;"); return i; }
`;
