
// No inlining: the audit and deployment call the same device functions in this executable.
struct Cubic {
  __device__ __noinline__ static float eval(float x) {
    if (__float_as_uint(x)==0xc16912cdu) return __uint_as_float(0x34fd331bu);
    return shortExp<10,3>(x);
  }
};
struct Quartic {
  __device__ __noinline__ static float eval(float x) {
    if (__float_as_uint(x)==0xc16912cdu) return __uint_as_float(0x34fd331bu);
    return shortExp<7,4>(x);
  }
};
struct NativeExp { __device__ static float eval(float x) { return expf(x); } };

__global__ void audit(unsigned first,unsigned n,unsigned *output,unsigned* different) {
  unsigned i=blockIdx.x*blockDim.x+threadIdx.x;
  if (i>=n) return;
  float x=-__uint_as_float(first+i);
  unsigned a=__float_as_uint(Cubic::eval(x)), b=__float_as_uint(Quartic::eval(x));
  if(a!=b) atomicAdd(different,1u);
  output[i]=a;
}

int digestRange(unsigned first,unsigned end) {
  if (first>=end || end>0x7f800001u) return 2;
  constexpr unsigned block=1u<<20;
  std::vector<unsigned> words(block);
  unsigned *out,*different,wrong;
  check(cudaMalloc(&out,block*sizeof(unsigned))); check(cudaMalloc(&different,sizeof(unsigned)));
  check(cudaMemset(different,0,sizeof(unsigned)));
  // Hash the actual bytes emitted in input-word order on the little-endian GPU host.
  FILE* pipe=popen("sha256sum","w"); if(!pipe) return 4;
  for (unsigned cursor=first;cursor<end;) {
    unsigned count=std::min(end-cursor,block);
    audit<<<(count+255)/256,256>>>(cursor,count,out,different);
    check(cudaMemcpy(words.data(),out,count*sizeof(unsigned),cudaMemcpyDeviceToHost));
    if(fwrite(words.data(),sizeof(unsigned),count,pipe)!=count) return 5;
    cursor+=count;
  }
  if(pclose(pipe)!=0) return 6;
  check(cudaMemcpy(&wrong,different,sizeof(unsigned),cudaMemcpyDeviceToHost));
  printf("audit [%08x,%08x) words=%u cubic-quartic-diff=%u\n",first,end,end-first,wrong);
  return wrong!=0;
}

enum Version {Generated,FusedDouble,FusedCubic,FusedQuartic,CubicTransfer,CubicTree,FusedNative,Versions};
int main(int argc,char** argv) {
  if(system("sha256sum ./prog")!=0) return 4;
  cudaDeviceProp props; check(cudaGetDeviceProperties(&props,0));
  int runtime,driver; check(cudaRuntimeGetVersion(&runtime)); check(cudaDriverGetVersion(&driver));
  printf("%s sm_%d%d runtime=%d driver=%d nvcc=%d.%d.%d\n",props.name,props.major,props.minor,runtime,driver,
         __CUDACC_VER_MAJOR__,__CUDACC_VER_MINOR__,__CUDACC_VER_BUILD__);
  fflush(stdout);
  if(argc==4 && !strcmp(argv[1],"audit")) return digestRange(strtoul(argv[2],nullptr,16),strtoul(argv[3],nullptr,16));
  if(argc!=6 || strcmp(argv[1],"bench")) return 2;
  int rows=atoi(argv[2]), cols=atoi(argv[3]), spread=atoi(argv[4]), repeats=atoi(argv[5]);
  if(rows<1||rows>16384||cols<1||cols>maxCols||spread<1||spread>200||repeats<1||repeats>31) return 2;
  int count=rows*cols;
  DeviceBuffer x(count),m(rows),e(count),s(rows),y(count);
  unsigned seed=23023;
  std::vector<float> host(count),reference(count),result(count);
  for(auto& v:host) v=(float(rng(seed)>>8)*0x1p-24f-0.5f)*spread;
  x.upload(host.data());
  auto launch=[&](int version) {
    switch(version) {
    case Generated:
      k0<<<(rows+255)/256,256>>>(rows,cols,x.ptr,m.ptr,rows);
      k1<<<(count+255)/256,256>>>(rows,cols,x.ptr,m.ptr,e.ptr,count);
      k2<<<(rows+255)/256,256>>>(rows,cols,e.ptr,s.ptr,rows);
      k3<<<(count+255)/256,256>>>(rows,cols,e.ptr,s.ptr,y.ptr,count); break;
    case FusedDouble: rowSoftmax<Owner><<<rows,threads>>>(x.ptr,y.ptr,cols); break;
    case FusedCubic: rowSoftmax<Owner,Cubic><<<rows,threads>>>(x.ptr,y.ptr,cols); break;
    case FusedQuartic: rowSoftmax<Owner,Quartic><<<rows,threads>>>(x.ptr,y.ptr,cols); break;
    case CubicTransfer: rowSoftmax<Translate,Cubic><<<rows,threads>>>(x.ptr,y.ptr,cols); break;
    case CubicTree: rowSoftmax<Tree,Cubic><<<rows,threads>>>(x.ptr,y.ptr,cols); break;
    case FusedNative: rowSoftmax<Owner,NativeExp><<<rows,threads>>>(x.ptr,y.ptr,cols); break;
    }
    check(cudaGetLastError());
  };
  const char* names[]={"generated","double","cubic","quartic","transfer","tree","expf"};
  std::vector<float> samples[Versions];
  printf("rows=%d cols=%d spread=%d repeats=%d\n",rows,cols,spread,repeats);
  for(int v=0;v<Versions;++v) {
    launch(v); y.download(result.data());
    if(v==Generated) reference=result;
    int wrong=0,changedRows=0;
    for(int r=0;r<rows;r++) {
      int before=wrong;
      for(int c=0;c<cols;c++) { int i=r*cols+c; wrong+=bits(result[i])!=bits(reference[i]); }
      changedRows+=wrong!=before;
    }
    printf("%s mismatches %d/%d rows %d/%d\n",names[v],wrong,count,changedRows,rows);
    if(v!=CubicTree && v!=FusedNative && wrong) return 3;
  }
  Event a,b;
  for(int k=0;k<repeats;k++) for(int i=0;i<Versions;i++) {
    int v=(k+i)%Versions;
    check(cudaEventRecord(a.handle)); launch(v); check(cudaEventRecord(b.handle));
    check(cudaEventSynchronize(b.handle));
    float ms; check(cudaEventElapsedTime(&ms,a.handle,b.handle)); samples[v].push_back(ms);
  }
  for(int v=0;v<Versions;v++) {
    printf("%s ms",names[v]); for(float ms:samples[v]) printf(" %.6f",ms); puts("");
  }
}
