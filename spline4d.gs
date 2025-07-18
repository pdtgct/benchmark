/**
 * Cubic B-spline utilities for Google Apps Script.
 *
 * This module implements a simple tensor-product cubic B-spline in four
 * variables.  The spline is suitable for execution inside Google Apps
 * Script (V8 runtime).
 *
 * The implementation only covers evaluation of the spline surface given
 * a coefficient tensor.  Building / fitting the spline to data would
 * require solving a large sparse linear system and is beyond this
 * lightweight example.
 */

/***** Knot helpers *****/

/**
 * Construct an open, clamped uniform knot vector.
 *
 * @param {number} a  Start of the parameter range.
 * @param {number} b  End of the parameter range.
 * @param {number} k  Number of internal spans.
 * @return {!Array<number>} Knot vector with length k + 7.
 */
function makeUniformKnots(a, b, k) {
  const h = (b - a) / k;
  const knots = [];
  for (let i = 0; i < k + 7; i++) knots.push(a - 3 * h + i * h);
  return knots;
}

/***** Basis evaluation helpers *****/

/** Locate knot span for a given parameter. */
function findSpan(T, p, u) {
  const n = T.length - p - 1;
  if (u <= T[p]) return p;
  if (u >= T[n]) return n - 1;
  let low = p;
  let high = n;
  let mid = Math.floor((low + high) / 2);
  while (u < T[mid] || u >= T[mid + 1]) {
    if (u < T[mid]) high = mid; else low = mid;
    mid = Math.floor((low + high) / 2);
  }
  return mid;
}

/** Basic Cox–de Boor evaluation of basis functions. */
function basisFuns(T, i, u, p) {
  const N = new Array(p + 1).fill(0);
  const left = new Array(p + 1).fill(0);
  const right = new Array(p + 1).fill(0);
  N[0] = 1.0;
  for (let j = 1; j <= p; j++) {
    left[j] = u - T[i + 1 - j];
    right[j] = T[i + j] - u;
    let saved = 0.0;
    for (let r = 0; r < j; r++) {
      const temp = N[r] / (right[r + 1] + left[j - r]);
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
  return N;
}

/** Evaluate basis functions and first derivatives for a cubic spline. */
function basisCubicWithDeriv(T, u) {
  const p = 3;
  const span = findSpan(T, p, u);
  const ndu = Array.from({ length: p + 1 }, () => new Array(p + 1).fill(0));
  const left = new Array(p + 1).fill(0);
  const right = new Array(p + 1).fill(0);
  ndu[0][0] = 1.0;
  for (let j = 1; j <= p; j++) {
    left[j] = u - T[span + 1 - j];
    right[j] = T[span + j] - u;
    let saved = 0.0;
    for (let r = 0; r < j; r++) {
      ndu[j][r] = right[r + 1] + left[j - r];
      const temp = ndu[r][j - 1] / ndu[j][r];
      ndu[r][j] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    ndu[j][j] = saved;
  }
  const ders = Array.from({ length: 2 }, () => new Array(p + 1).fill(0));
  for (let j = 0; j <= p; j++) ders[0][j] = ndu[j][p];
  const a = [new Array(p + 1).fill(0), new Array(p + 1).fill(0)];
  for (let r = 0; r <= p; r++) {
    let s1 = 0, s2 = 1;
    a[0][0] = 1.0;
    for (let k = 1; k <= 1; k++) { // only first derivative
      let d = 0.0;
      const rk = r - k;
      const pk = p - k;
      if (r >= k) {
        a[s2][0] = a[s1][0] / ndu[pk + 1][rk];
        d = a[s2][0] * ndu[rk][pk];
      }
      const j1 = rk >= -1 ? 1 : -rk;
      const j2 = r - 1 <= pk ? k - 1 : p - r;
      for (let j = j1; j <= j2; j++) {
        a[s2][j] = (a[s1][j] - a[s1][j - 1]) / ndu[pk + 1][rk + j];
        d += a[s2][j] * ndu[rk + j][pk];
      }
      if (r <= pk) {
        a[s2][k] = -a[s1][k - 1] / ndu[pk + 1][r];
        d += a[s2][k] * ndu[r][pk];
      }
      ders[k][r] = d;
      const tmp = s1; s1 = s2; s2 = tmp;
    }
  }
  for (let j = 0; j <= p; j++) {
    ders[1][j] *= p;
  }
  const idx = [span - 3, span - 2, span - 1, span];
  return { idx: idx, val: ders[0].slice(0, 4), d1: ders[1].slice(0, 4) };
}

/** Convenience wrapper when only values are needed. */
function basisCubic(T, u) {
  const res = basisCubicWithDeriv(T, u);
  return { idx: res.idx, val: res.val };
}

/***** Spline evaluation *****/

/**
 * Evaluate tensor-product cubic B-spline surface.
 *
 * @param {Object} model  Spline model as returned by `buildSpline4d`.
 * @param {number} x1     Parameter 1.
 * @param {number} x2     Parameter 2.
 * @param {number} x3     Parameter 3.
 * @param {number} x4     Parameter 4.
 * @return {!Array<number>} Two-element array [TPIT, TPOT].
 */
function evalSpline4d(model, x1, x2, x3, x4) {
  const { C, K1, K2, K3, K4, dims } = model;
  const b1 = basisCubic(K1, x1);
  const b2 = basisCubic(K2, x2);
  const b3 = basisCubic(K3, x3);
  const b4 = basisCubic(K4, x4);
  let tpit = 0, tpot = 0;
  b1.idx.forEach((i, ii) => {
    if (i < 0 || i >= dims[0]) return;
    b2.idx.forEach((j, jj) => {
      if (j < 0 || j >= dims[1]) return;
      b3.idx.forEach((m, mm) => {
        if (m < 0 || m >= dims[2]) return;
        b4.idx.forEach((n, nn) => {
          if (n < 0 || n >= dims[3]) return;
          const col = ((i * dims[1] + j) * dims[2] + m) * dims[3] + n;
          const basis = b1.val[ii] * b2.val[jj] * b3.val[mm] * b4.val[nn];
          tpit += basis * C[col * 2];
          tpot += basis * C[col * 2 + 1];
        });
      });
    });
  });
  return [tpit, tpot];
}

/**
 * Evaluate partial derivatives with respect to x1 and x2 at (x1,x2,x3,x4).
 * Only derivatives of the first output (TPIT) and second output (TPOT)
 * with respect to x1 and x2 are returned.
 *
 * @param {Object} model  Spline model.
 * @param {number} x1     Parameter 1.
 * @param {number} x2     Parameter 2.
 * @param {number} x3     Parameter 3.
 * @param {number} x4     Parameter 4.
 * @return {!Array<number>} Two-element array [d/dx1 TPIT, d/dx2 TPIT].
 */
function splineGrad(model, x1, x2, x3, x4) {
  const { C, K1, K2, K3, K4, dims } = model;
  const b1 = basisCubicWithDeriv(K1, x1);
  const b2 = basisCubicWithDeriv(K2, x2);
  const b3 = basisCubic(K3, x3);
  const b4 = basisCubic(K4, x4);
  let d1 = 0, d2 = 0;
  b1.idx.forEach((i, ii) => {
    if (i < 0 || i >= dims[0]) return;
    b2.idx.forEach((j, jj) => {
      if (j < 0 || j >= dims[1]) return;
      b3.idx.forEach((m, mm) => {
        if (m < 0 || m >= dims[2]) return;
        b4.idx.forEach((n, nn) => {
          if (n < 0 || n >= dims[3]) return;
          const col = ((i * dims[1] + j) * dims[2] + m) * dims[3] + n;
          const c1 = C[col * 2];
          const c2 = C[col * 2 + 1];
          const bCommon = b3.val[mm] * b4.val[nn];
          d1 += b1.d1[ii] * b2.val[jj] * bCommon * c1;
          d2 += b1.val[ii] * b2.d1[jj] * bCommon * c1;
          // second output (TPOT) gradient can be computed similarly if needed
        });
      });
    });
  });
  return [d1, d2];
}

/***** Model builder (placeholder) *****/

/**
 * Build a spline model from tabulated rows.
 *
 * NOTE: Solving for the coefficient tensor requires a large sparse linear
 * system which is not implemented in this minimal example.  This function
 * simply returns a model object with zero coefficients and knot vectors so
 * that `evalSpline4d` can be exercised if coefficients are supplied from an
 * external source.
 *
 * @param {!Array<!Array<number>>} rows Training rows: [x1,x2,tpit,tpot].
 * @param {Object} opts Knot vectors {K1,K2,K3,K4}.
 * @return {Object} Spline model.
 */
function buildSpline4d(rows, { K1, K2, K3, K4 }) {
  const dims = [K1.length - 4, K2.length - 4, K3.length - 4, K4.length - 4];
  const nCoeffs = dims[0] * dims[1] * dims[2] * dims[3];
  // In a full implementation, coefficients would be solved for here.
  const C = new Float64Array(nCoeffs * 2); // zeros
  return { C, K1, K2, K3, K4, dims };
}

/** Export utilities in a manner compatible with Apps Script and Node. */
function getSplineModule() {
  return { makeUniformKnots, buildSpline4d, evalSpline4d, splineGrad };
}

if (typeof module !== 'undefined') module.exports = { getSplineModule };
