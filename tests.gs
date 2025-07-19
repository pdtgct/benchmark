function _test_FitRoundTrip() {
  // synthetic 5× data
  const rows=[];
  for (let t=0;t<=4000;t+=1000){
    for (let q=1;q<=64;q*=4){
      const tpit = 5 + 0.01*t + 0.2*q + 0.0001*t*q;
      const tpot = 10 + 0.005*t + 0.4*q;
      rows.push([t,q,tpit,tpot]);
    }
  }
  const K1=makeUniformKnots(0,4000,8);
  const K2=makeUniformKnots(1,64,6);
  const fit=SF_fit2DSplinePair(rows,K1,K2,1e-8);

  // build 4D wrapper
  const K3=makeUniformKnots(0,1,1);
  const K4=makeUniformKnots(0,1,1);
  const dims=[K1.length-4,K2.length-4,1,1];
  const nb=dims[0]*dims[1];
  const C=new Float64Array(nb*2);
  for (let i=0;i<nb;i++){C[2*i]=fit.cTPIT[i]; C[2*i+1]=fit.cTPOT[i];}
  globalThis.MODEL={C,K1,K2,K3,K4,dims};

  // spot check
  const pred=evalSpline4d(globalThis.MODEL,2000,16,0,0);
  Logger.log('Predicted: %s', JSON.stringify(pred));
}
