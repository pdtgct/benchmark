/*******************************************************
 * spline_fit.gs
 * Fit 2D cubic B-spline surfaces TPIT(tokens,qps) and
 * TPOT(tokens,qps) from a selected Sheet range, then
 * inject into the existing 4D evaluation model as two
 * degenerate extra dimensions (x3,x4 singleton).
 *******************************************************/

/** User-tunable defaults *****************************************************/
const SF_DEFAULT_K_SPANS_TOKENS = 9;   // internal spans in tokens dimension
const SF_DEFAULT_K_SPANS_QPS    = 8;   // internal spans in qps dimension
const SF_DEFAULT_SMOOTH_LAMBDA  = 1e-2;// smoothing strength (0 = interpolate)

/** UI menu *******************************************************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Spline4D')
    .addItem('Fit from selection', 'SF_fitFromCurrentSelection')
    .addItem('Clear cached model', 'SF_clearCache')
    .addToUi();
}

/** Clear cached model (use if you change data or params). */
function SF_clearCache() {
  delete globalThis.MODEL;
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('SPLINE4D_COEFFS');
  SpreadsheetApp.getActiveSpreadsheet().toast('Spline4D cache cleared');
}

/** Main entry: fit from current selection in sheet. */
function SF_fitFromCurrentSelection() {
  const range = SpreadsheetApp.getActiveRange();
  if (!range) throw new Error('No range selected.');
  const values = range.getValues();
  const rows = SF_extractRows(values);        // [[tokens,qps,tpit,tpot],...]
  if (!rows.length) throw new Error('No numeric rows found.');

  // derive knot endpoints from data min/max
  const tMin = Math.min.apply(null, rows.map(r=>r[0]));
  const tMax = Math.max.apply(null, rows.map(r=>r[0]));
  const qMin = Math.min.apply(null, rows.map(r=>r[1]));
  const qMax = Math.max.apply(null, rows.map(r=>r[1]));

  const K1 = makeUniformKnots(tMin, tMax, SF_DEFAULT_K_SPANS_TOKENS);
  const K2 = makeUniformKnots(qMin, qMax, SF_DEFAULT_K_SPANS_QPS);

  // build & solve for two outputs
  const fit = SF_fit2DSplinePair(rows, K1, K2, SF_DEFAULT_SMOOTH_LAMBDA);

  // wrap into 4D model with singleton extra dims
  const K3 = makeUniformKnots(0, 1, 1);   // singleton dimension
  const K4 = makeUniformKnots(0, 1, 1);   // singleton dimension
  const dims = [K1.length-4, K2.length-4, 1, 1];
  const nCoeffs = dims[0]*dims[1];

  // allocate 4D coefficient array (×2 outputs)
  const C = new Float64Array(nCoeffs*2);
  for (let i=0;i<nCoeffs;i++){
    C[2*i]   = fit.cTPIT[i];
    C[2*i+1] = fit.cTPOT[i];
  }

  // cache persistent
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPLINE4D_COEFFS', JSON.stringify({
    K1,K2,K3,K4,
    c:[...C]
  }));

  // install into runtime model cache
  globalThis.MODEL = {C,K1,K2,K3,K4,dims};

  SpreadsheetApp.getActiveSpreadsheet()
    .toast('Spline4D: fitted '+rows.length+' rows; '+nCoeffs+' coeffs.');
}

/** Extract numeric data rows from a 2D value array.
 *  Accepts optional header row: non-numeric tokens in row[0] are skipped.
 */
function SF_extractRows(values) {
  const out=[];
  for (let r=0;r<values.length;r++){
    const row=values[r];
    if (row.length < 4) continue;
    const t = Number(row[0]), q = Number(row[1]),
          ti=Number(row[2]), to=Number(row[3]);
    if (!isFinite(t) || !isFinite(q) || !isFinite(ti) || !isFinite(to)) continue;
    out.push([t,q,ti,to]);
  }
  return out;
}

/******************************************************************************
 * FITTING
 * Penalized least squares smoothing spline in 2D (tensor-product cubic).
 * Returns two coefficient arrays (TPIT & TPOT) flattened with K2 fastest.
 ******************************************************************************/

/** Top-level fit */
function SF_fit2DSplinePair(rows, K1, K2, lambda) {
  const p=3;
  const n1=K1.length-(p+1);
  const n2=K2.length-(p+1);
  const nb = n1*n2;

  // Build sparse design matrix storage: rowPtrs[], colIdx[], val[]
  const N = rows.length;
  const rowCols = new Array(N);    // each row: {idx:[],val:[]}
  const yTPIT  = new Float64Array(N);
  const yTPOT  = new Float64Array(N);

  for (let r=0;r<N;r++){
    const [x1,x2,tpit,tpot]=rows[r];
    const b1=basisCubic(K1,x1);  // 4 vals
    const b2=basisCubic(K2,x2);
    const idx=[],val=[];
    for (let i=0;i<4;i++){
      const ii=b1.idx[i]; if (ii<0||ii>=n1) continue;
      for (let j=0;j<4;j++){
        const jj=b2.idx[j]; if (jj<0||jj>=n2) continue;
        idx.push(ii*n2+jj);
        val.push(b1.val[i]*b2.val[j]);
      }
    }
    rowCols[r]={idx,val};
    yTPIT[r]=tpit;
    yTPOT[r]=tpot;
  }

  // Assemble normal eq A = B^T B + λR; b = B^T y
  const A = SF_normalEq(nb,rowCols,lambda,n1,n2);
  const b1=SF_Bt_y(nb,rowCols,yTPIT);
  const b2=SF_Bt_y(nb,rowCols,yTPOT);

  // Solve (Cholesky) two RHS
  const L = SF_choleskyDenseSPD(A);                    // in-place
  const cTPIT = SF_choleskySolve(L,b1);
  const cTPOT = SF_choleskySolve(L,b2);

  return {cTPIT,cTPOT};
}

/** Build BᵀB + λR (dense nb×nb) */
function SF_normalEq(nb,rowCols,lambda,n1,n2){
  // init zero matrix
  const A = Array.from({length:nb},()=>new Float64Array(nb));
  // accumulate BᵀB
  for (let r=0;r<rowCols.length;r++){
    const rc=rowCols[r];
    const idx=rc.idx,val=rc.val;
    for (let a=0;a<idx.length;a++){
      const ia=idx[a], va=val[a];
      for (let b=a;b<idx.length;b++){
        const ib=idx[b], vb=val[b];
        const v = va*vb;
        A[ia][ib]+=v;
        if (ib!==ia) A[ib][ia]+=v;
      }
    }
  }
  // add λR (roughness)
  if (lambda>0){
    const R = SF_roughnessPenalty(n1,n2);
    for (let i=0;i<nb;i++){
      const Ri=R[i];
      const Ai=A[i];
      for (let j=0;j<nb;j++) Ai[j]+=lambda*Ri[j];
    }
  }
  return A;
}

/** Compute b = Bᵀ y */
function SF_Bt_y(nb,rowCols,y){
  const b=new Float64Array(nb);
  for (let r=0;r<rowCols.length;r++){
    const rc=rowCols[r];
    const yr=y[r];
    for (let a=0;a<rc.idx.length;a++){
      b[rc.idx[a]] += rc.val[a]*yr;
    }
  }
  return b;
}

/** Roughness penalty matrix using tensor of 1D second-difference operators. */
function SF_roughnessPenalty(n1,n2){
  // D2_t: (n1-2) × n1 second-diff; D2_q same; R = kron(I,D2_q^T D2_q)+kron(D2_t^T D2_t,I)
  const Dt=SF_D2(n1);
  const Dq=SF_D2(n2);
  const Rt=SF_mulT(Dt,Dt);    // n1×n1
  const Rq=SF_mulT(Dq,Dq);    // n2×n2
  const nb=n1*n2;
  const R = Array.from({length:nb},()=>new Float64Array(nb));

  // kron(Rt, I)
  for (let i1=0;i1<n1;i1++){
    for (let j1=0;j1<n1;j1++){
      const v=Rt[i1][j1];
      if (!v) continue;
      for (let k=0;k<n2;k++){
        const row=i1*n2+k;
        const col=j1*n2+k;
        R[row][col]+=v;
      }
    }
  }
  // kron(I, Rq)
  for (let i2=0;i2<n2;i2++){
    for (let j2=0;j2<n2;j2++){
      const v=Rq[i2][j2];
      if (!v) continue;
      for (let k=0;k<n1;k++){
        const row=k*n2+i2;
        const col=k*n2+j2;
        R[row][col]+=v;
      }
    }
  }
  return R;
}

/** Build 2nd-difference matrix (m-2)×m */
function SF_D2(m){
  if (m<3){
    // degenerate: return zeros
    return Array.from({length:0},()=>new Float64Array(m));
  }
  const out=Array.from({length:m-2},()=>new Float64Array(m));
  for (let i=0;i<m-2;i++){
    out[i][i]   = 1;
    out[i][i+1] = -2;
    out[i][i+2] = 1;
  }
  return out;
}

/** Compute MᵀM given M as row-major JS arrays */
function SF_mulT(M,N){
  // here N==M; still code generally
  const r=M.length;
  const m=M[0]?M[0].length:0;
  const out=Array.from({length:m},()=>new Float64Array(m));
  for (let i=0;i<r;i++){
    const Mi=M[i];
    for (let a=0;a<m;a++){
      const va=Mi[a];
      if (!va) continue;
      for (let b=a;b<m;b++){
        const vb=Mi[b];
        const v=va*vb;
        out[a][b]+=v;
        if (b!==a) out[b][a]+=v;
      }
    }
  }
  return out;
}

/*******************************************************************************
 * Dense SPD Cholesky (A = L Lᵀ).  Input: nested arrays; output lower-tri copy.
 ******************************************************************************/
function SF_choleskyDenseSPD(A){
  const n=A.length;
  // copy
  const L=Array.from({length:n},(_,i)=>new Float64Array(A[i]));
  for (let j=0;j<n;j++){
    let sum=L[j][j];
    for (let k=0;k<j;k++){
      const Ljk=L[j][k];
      sum -= Ljk*Ljk;
    }
    if (sum<=0) throw new Error('Matrix not SPD (λ too small / bad data).');
    const diag=Math.sqrt(sum);
    L[j][j]=diag;
    const invDiag=1/diag;
    for (let i=j+1;i<n;i++){
      let s=L[i][j];
      for (let k=0;k<j;k++) s-=L[i][k]*L[j][k];
      L[i][j]=s*invDiag;
    }
    // zero upper
    for (let k=j+1;k<n;k++) L[j][k]=0;
  }
  return L;
}

/** Solve L Lᵀ x = b */
function SF_choleskySolve(L,b){
  const n=L.length;
  const y=new Float64Array(n);
  // forward L y = b
  for (let i=0;i<n;i++){
    let s=b[i];
    const Li=L[i];
    for (let k=0;k<i;k++) s-=Li[k]*y[k];
    y[i]=s/Li[i];
  }
  // backward Lᵀ x = y
  const x=new Float64Array(n);
  for (let i=n-1;i>=0;i--){
    let s=y[i];
    for (let k=i+1;k<n;k++) s-=L[k][i]*x[k];
    x[i]=s/L[i][i];
  }
  return x;
}
