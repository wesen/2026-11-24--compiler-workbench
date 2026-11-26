// Included after the same stage-2 kernels and cooperative row template.
struct SelectedExp {
  __device__ __noinline__ static float eval(float x) {
    if (!(x<=0.0f)) return RoundedDoubleExp::eval(x);
    return shortExp<14,2>(x);
  }
};
__global__ void classify(unsigned start,unsigned n,unsigned* out) {
  unsigned i=blockIdx.x*blockDim.x+threadIdx.x;
  if(i<n) out[i]=__float_as_uint(SelectedExp::eval(-__uint_as_float(start+i)));
}
__global__ void twice(const float* x,float* y,int n) {
  int i=blockIdx.x*blockDim.x+threadIdx.x;
  if(i<n) y[i]=__fmul_rn(2.0f,x[i]);
}
static void digest(const void* ptr,size_t bytes) {
  FILE* pipe=popen("sha256sum","w"); if(!pipe) exit(4);
  if(bytes && fwrite(ptr,1,bytes,pipe)!=bytes) exit(5);
  if(pclose(pipe)!=0) exit(6);
}
static void audit(unsigned lo,unsigned hi) {
  if(lo>=hi||hi>0x7f800001u) exit(2);
  constexpr unsigned b=1<<20;
  std::vector<unsigned> h(b); unsigned* d; check(cudaMalloc(&d,b*4));
  FILE* pipe=popen("sha256sum","w"); if(!pipe) exit(4);
  for(unsigned first=lo;first<hi;) {
    unsigned count=std::min(b,hi-first);
    classify<<<(count+255)/256,256>>>(first,count,d);
    check(cudaMemcpy(h.data(),d,count*4,cudaMemcpyDeviceToHost));
    if(fwrite(h.data(),4,count,pipe)!=count) exit(5);
    first+=count;
  }
  if(pclose(pipe)!=0) exit(6);
  printf("audit [%08x,%08x) words=%u selected=quadratic\n",lo,hi,hi-lo);
}

static void softmax(int rows,int cols,int spread,int reps,bool timed) {
  if(rows<0||rows>16384||cols<0||cols>4096||spread<0||spread>200||reps<1||reps>31) exit(2);
  int n=rows*cols;
  DeviceBuffer x(n),m(rows),e(n),s(rows),y(n);
  std::vector<float> input(n),ref(n),out(n);
  unsigned seed=23023;
  const float edge[]={0.0f,-0.0f,-14.56709003448486328125f,-0x1p-149f,-16.635532f,-104.f,-87.3f,
    -0x1.fffffep127f,0x1.fffffep127f,1.0f,-1.0f,-0x1p-25f};
  for(int i=0;i<n;i++) {
    if(spread) input[i]=(float(rng(seed)>>8)*0x1p-24f-0.5f)*spread;
    else input[i]=edge[(i/cols+i%cols)%12];
  }
  x.upload(input.data());
  auto generated=[&] {
    if(rows) k0<<<(rows+255)/256,256>>>(rows,cols,x.ptr,m.ptr,rows);
    if(n) k1<<<(n+255)/256,256>>>(rows,cols,x.ptr,m.ptr,e.ptr,n);
    if(rows) k2<<<(rows+255)/256,256>>>(rows,cols,e.ptr,s.ptr,rows);
    if(n) k3<<<(n+255)/256,256>>>(rows,cols,e.ptr,s.ptr,y.ptr,n);
  };
  const bool eligible=rows>0 && cols>0 && cols<=1024;
  auto launch=[&](int v) {
    if(v==0 || (!eligible && v==1)) generated();
    else if(v==1) rowSoftmax<Owner,SelectedExp><<<rows,threads>>>(x.ptr,y.ptr,cols);
    else if(n) twice<<<(n+255)/256,256>>>(x.ptr,y.ptr,n);
    check(cudaGetLastError());
  };
  launch(0); y.download(ref.data());
  launch(1); y.download(out.data());
  if(n && memcmp(ref.data(),out.data(),n*sizeof(float))) exit(3);
  printf("rows=%d cols=%d spread=%d route=%s matched=%d bytes=%d\n",rows,cols,spread,eligible?"fused":"generated",n,4*n);
  fflush(stdout); digest(out.data(),n*4);
  if(!timed) return;
  launch(2); check(cudaDeviceSynchronize());
  Event a,b;
  std::vector<float> times[3];
  for(int k=0;k<reps;k++) for(int i=0;i<3;i++) {
    int v=(k+i)%3;
    check(cudaEventRecord(a.handle)); launch(v); check(cudaEventRecord(b.handle));
    check(cudaEventSynchronize(b.handle)); float ms; check(cudaEventElapsedTime(&ms,a.handle,b.handle)); times[v].push_back(ms);
  }
  const char* names[]={"generated","quadratic","stream"};
  for(int i=0;i<3;i++) { printf("%s ms",names[i]); for(float t:times[i]) printf(" %.6f",t); puts(""); }
}
int main(int argc,char** argv) {
  if(system("sha256sum ./prog")!=0) return 4;
  cudaDeviceProp p; check(cudaGetDeviceProperties(&p,0)); int rt,drv;
  check(cudaRuntimeGetVersion(&rt)); check(cudaDriverGetVersion(&drv));
  printf("%s sm_%d%d runtime=%d driver=%d nvcc=%d.%d.%d\n",p.name,p.major,p.minor,rt,drv,__CUDACC_VER_MAJOR__,__CUDACC_VER_MINOR__,__CUDACC_VER_BUILD__);
  fflush(stdout);
  if(argc==4 && !strcmp(argv[1],"audit")) audit(strtoul(argv[2],nullptr,16),strtoul(argv[3],nullptr,16));
  else if(argc==6 && !strcmp(argv[1],"bench")) softmax(atoi(argv[2]),atoi(argv[3]),atoi(argv[4]),atoi(argv[5]),true);
  else if(argc==2 && !strcmp(argv[1],"edges")) {
    for(int c:{0,1,2,7,31,32,33,997,1023,1024,1025}) softmax(7,c,0,1,false);
    softmax(0,17,0,1,false);
  } else return 2;
}
