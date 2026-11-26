// Reuses the audited scalar routine, row schedule and digest helpers from 11-deploy.cu.
int main(int argc,char** argv) {
  if(system("sha256sum ./prog")!=0) return 4;
  cudaDeviceProp p; check(cudaGetDeviceProperties(&p,0)); int rt,drv;
  check(cudaRuntimeGetVersion(&rt)); check(cudaDriverGetVersion(&drv));
  printf("%s sm_%d%d runtime=%d driver=%d nvcc=%d.%d.%d\n",p.name,p.major,p.minor,rt,drv,__CUDACC_VER_MAJOR__,__CUDACC_VER_MINOR__,__CUDACC_VER_BUILD__);
  fflush(stdout);
  if(argc==4 && !strcmp(argv[1],"audit")) {
    audit(strtoul(argv[2],nullptr,16),strtoul(argv[3],nullptr,16)); return 0;
  }
  if(argc!=7 || strcmp(argv[1],"bench")) return 2;
  int Q=atoi(argv[2]),K=atoi(argv[3]),D=atoi(argv[4]),V=atoi(argv[5]),reps=atoi(argv[6]);
  if(Q<1||Q>2048||K<1||K>1024||D<1||D>256||V<1||V>256||reps<1||reps>31) return 2;
  DeviceBuffer q(Q*D),k(K*D),v(K*V),score(Q*K),m(Q),e(Q*K),s(Q),w(Q*K),out(Q*V);
  unsigned seed=23023;
  for(DeviceBuffer* p:{&q,&k,&v}) {
    std::vector<float> h(p->size); for(float& x:h) x=float(rng(seed)>>8)*0x1p-23f-1.0f;
    p->upload(h.data());
  }
  auto launch=[&](int mode) {
    if(mode!=2) att::k0<<<(Q*K+255)/256,256>>>(Q,D,K,V,q.ptr,k.ptr,score.ptr,Q*K);
    if(mode==0) {
      att::k1<<<(Q+255)/256,256>>>(Q,D,K,V,score.ptr,m.ptr,Q);
      att::k2<<<(Q*K+255)/256,256>>>(Q,D,K,V,score.ptr,m.ptr,e.ptr,Q*K);
      att::k3<<<(Q+255)/256,256>>>(Q,D,K,V,e.ptr,s.ptr,Q);
      att::k4<<<(Q*K+255)/256,256>>>(Q,D,K,V,e.ptr,s.ptr,w.ptr,Q*K);
    } else rowSoftmax<Owner,SelectedExp><<<Q,threads>>>(score.ptr,w.ptr,K);
    if(mode!=2) att::k5<<<(Q*V+255)/256,256>>>(Q,D,K,V,w.ptr,v.ptr,out.ptr,Q*V);
    check(cudaGetLastError());
  };
  std::vector<float> before(Q*V),after(Q*V);
  launch(0); out.download(before.data()); launch(1); out.download(after.data());
  if(memcmp(before.data(),after.data(),Q*V*sizeof(float))) return 3;
  printf("Q=%d K=%d D=%d V=%d matched=%d\n",Q,K,D,V,Q*V);
  fflush(stdout); digest(after.data(),after.size()*4);
  launch(2); check(cudaDeviceSynchronize());
  Event a,b; std::vector<float> times[3];
  for(int rep=0;rep<reps;rep++) for(int i=0;i<3;i++) {
    int op=(i+rep)%3;
    check(cudaEventRecord(a.handle)); launch(op); check(cudaEventRecord(b.handle)); check(cudaEventSynchronize(b.handle));
    float ms; check(cudaEventElapsedTime(&ms,a.handle,b.handle)); times[op].push_back(ms);
  }
  const char* names[]={"generated","three","region"};
  for(int i=0;i<3;i++) { printf("%s ms",names[i]); for(float t:times[i]) printf(" %.6f",t); puts(""); }
}
