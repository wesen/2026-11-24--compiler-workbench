#include <cuda_runtime.h>
#include <cstdio>
#include <cmath>
__global__ void sample(float* out) {
  int i=blockIdx.x*blockDim.x+threadIdx.x;
  float x=(i-8192)/1024.f;
  out[4*i]=expf(x); out[4*i+1]=logf(x+9); out[4*i+2]=sqrtf(x+9); out[4*i+3]=tanhf(x);
}
int main(){ cudaDeviceProp p; if(cudaGetDeviceProperties(&p,0)) return 1;
  printf("%s sm_%d%d nvcc %d.%d.%d\n",p.name,p.major,p.minor,__CUDACC_VER_MAJOR__,__CUDACC_VER_MINOR__,__CUDACC_VER_BUILD__);
  float *d; size_t n=4*16384; float *h=new float[n]; if(cudaMalloc(&d,n*4)) return 2;
  sample<<<64,256>>>(d); if(cudaMemcpy(h,d,n*4,cudaMemcpyDeviceToHost)) return 3;
  FILE*f=fopen("out/words","wb"); if(!f || fwrite(h,4,n,f)!=n) return 4; return fclose(f);
}
