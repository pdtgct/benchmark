/***** model_data.gs *****
 * Loads cached fitted model (if present), or builds empty zero model.
 * Provides PREDICT_TT sheet function.
 *****************************************************************************/

function getModel_() {
  if (globalThis.MODEL) return globalThis.MODEL;

  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty('SPLINE4D_COEFFS');
  if (stored) {
    const obj = JSON.parse(stored);
    const {K1,K2,K3,K4,c} = obj;
    const dims = [K1.length-4, K2.length-4, K3.length-4, K4.length-4];
    const C = new Float64Array(c);
    globalThis.MODEL = {C,K1,K2,K3,K4,dims};
    return globalThis.MODEL;
  }

  // fallback (empty) – pick default knots; all coeff = 0
  const K1 = makeUniformKnots(0,1,1);
  const K2 = makeUniformKnots(0,1,1);
  const K3 = makeUniformKnots(0,1,1);
  const K4 = makeUniformKnots(0,1,1);
  globalThis.MODEL = buildSpline4d([], {K1,K2,K3,K4});
  return globalThis.MODEL;
}

/**
 * Predict TPIT & TPOT from tokens & QPS.
 * Usage in Sheet: =PREDICT_TT(A2,B2)
 * Spills two cells: TPIT | TPOT.
 * @customfunction
 */
function PREDICT_TT(tokens, qps) {
  const m = getModel_();
  return evalSpline4d(m, +tokens, +qps, 0, 0);
}
