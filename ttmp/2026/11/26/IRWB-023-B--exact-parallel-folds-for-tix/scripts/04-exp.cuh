// The driver emits uint64 words for 1024 powers of two. Scope: x <= 0 and x is not NaN.
constexpr unsigned startMag=0x33000000u, stopMag=0x42d00000u;
template<int tableBits,int degree>
__device__ float shortExp(float x) {
  unsigned mag=__float_as_uint(x)&0x7fffffffu;
  if (mag<=startMag) return 1.0f;
  if (mag>=stopMag) return 0.0f;
  constexpr int B=1<<tableBits;
  // A single precision estimate only selects a nearby cell. The residual uses the actual k.
  int k=__float2int_rn(__fmul_rn(x,float(B)*0x1.715476p+0f));
  int t=k&(B-1), j=(k-t)/B;
  auto scale=__longlong_as_double(powerBits[t*(1024/B)]+(static_cast<unsigned long long>(j)<<52));
  double r=__fma_rn(double(k),-0x1.62e42fefa39efp-1/double(B),double(x));
  double c=0.5;
  if constexpr (degree==3) c=__fma_rn(r,1.0/6.0,0.5);
  if constexpr (degree==4) c=__fma_rn(r,__fma_rn(r,1.0/24.0,1.0/6.0),0.5);
  double u=__dmul_rn(r,__fma_rn(r,c,1.0));
  return __double2float_rn(__fma_rn(scale,u,scale));
}
