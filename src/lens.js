/**
 * Null geodesics of a Schwarzschild hole, for the gravitational-lens preset.
 * Impact parameters are in units of the horizon radius. traceRay() is the
 * equatorial null geodesic with E = 1; the sheet vertex shader is not involved.
 * Paths are computed once. The world scales them by the live horizon.
 */
import { M_SUN, R_SUN, schwarzschildRadius } from './constants.js';

export const GALACTIC_CENTER_PC = 8277;
const PC_METERS = 3.0856775814913673e16;

export const B_CRIT = (3 * Math.sqrt(3)) / 2;
export const PHOTON_RADIUS = 1.5;
export const FEATURE_B = 6.5;

const IMPACTS = [1.55, 2.15, 2.47, 2.575, 2.63, 3.35, FEATURE_B];

export const liveLens = {
  enabled: false,
  cx: 0,
  cz: 0,
  rs: 1,
};

function deriv(r, vr, L, rs) {
  const r2 = r * r;
  const r3 = r2 * r;
  const r4 = r3 * r;
  return {
    dr: vr,
    dphi: L / r2,
    dvr: L * L * (1 / r3 - (1.5 * rs) / r4),
  };
}

function rk4(r, phi, vr, L, rs, dλ) {
  const h = dλ;
  const a = deriv(r, vr, L, rs);
  const b = deriv(r + a.dr * h * 0.5, vr + a.dvr * h * 0.5, L, rs);
  const c = deriv(r + b.dr * h * 0.5, vr + b.dvr * h * 0.5, L, rs);
  const d = deriv(r + c.dr * h, vr + c.dvr * h, L, rs);
  return {
    r: r + (a.dr + 2 * b.dr + 2 * c.dr + d.dr) * h / 6,
    phi: phi + (a.dphi + 2 * b.dphi + 2 * c.dphi + d.dphi) * h / 6,
    vr: vr + (a.dvr + 2 * b.dvr + 2 * c.dvr + d.dvr) * h / 6,
  };
}

function projectSpeed(r, vr, b, rs) {
  const V = (b * b * (1 - rs / r)) / (r * r);
  const rest = 1 - V;
  if (rest <= 1e-10) return vr;
  const speed = Math.sqrt(rest);
  if (Math.abs(vr) < 1e-8) return vr < 0 ? -speed : speed;
  return Math.sign(vr) * speed;
}

/**
 * One ray. bSigned > 0 passes above the hole (positive z) and is pulled down.
 * Coordinates are in units of rs, incoming from the left.
 */
export function traceRay(bSigned, options = {}) {
  const rs = 1;
  const b = Math.abs(bSigned);
  const sign = Math.sign(bSigned) || 1;
  const x0 = -(options.x0 ?? 18);
  const z0 = sign * b;
  let r = Math.hypot(x0, z0);
  let phi = Math.atan2(z0, x0);
  const L = -sign * b;
  let vr = -Math.sqrt(Math.max(0, 1 - (b * b * (1 - rs / r)) / (r * r)));
  const phi0 = phi;
  const windCap = options.wind ?? Math.PI * 3.25;
  const rEscape = options.rEscape ?? 16;
  const minDist = options.minDist ?? 0.085;

  const xs = [r * Math.cos(phi)];
  const zs = [r * Math.sin(phi)];
  let lastX = xs[0];
  let lastZ = zs[0];
  let rMin = r;
  let captured = false;
  let winding = false;
  let headingPrev = null;
  let deflection = 0;
  let energyError = 0;

  const push = (x, z) => {
    if (Math.hypot(x - lastX, z - lastZ) < minDist * 0.25) return;
    xs.push(x);
    zs.push(z);
    lastX = x;
    lastZ = z;
  };

  for (let n = 0; n < 28000; n += 1) {
    const dλ = Math.min(0.45, Math.max(0.008, 0.012 * Math.max(1, r * 0.22)));
    const next = rk4(r, phi, vr, L, rs, dλ);
    if (!Number.isFinite(next.r) || next.r <= 0.2) break;
    r = next.r;
    phi = next.phi;
    vr = projectSpeed(r, next.vr, b, rs);
    const V = (b * b * (1 - rs / r)) / (r * r);
    energyError = Math.max(energyError, Math.abs(vr * vr + V - 1));
    if (r < rMin) rMin = r;

    const dphi = L / (r * r);
    const dx = vr * Math.cos(phi) - r * Math.sin(phi) * dphi;
    const dz = vr * Math.sin(phi) + r * Math.cos(phi) * dphi;
    const heading = Math.atan2(dz, dx);
    if (headingPrev !== null) {
      let turn = heading - headingPrev;
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      deflection += turn;
    }
    headingPrev = heading;

    const x = r * Math.cos(phi);
    const z = r * Math.sin(phi);
    if (Math.hypot(x - lastX, z - lastZ) >= minDist) push(x, z);

    if (r < 1.025) {
      captured = true;
      push(x, z);
      const end = 0.7;
      xs.push((x / r) * end);
      zs.push((z / r) * end);
      break;
    }
    if (Math.abs(phi - phi0) > windCap && r < 3.4) {
      winding = true;
      push(x, z);
      break;
    }
    if (n > 8 && r > rEscape && vr > 0) {
      push(x, z);
      break;
    }
  }

  const arc = new Float32Array(xs.length);
  for (let i = 1; i < xs.length; i += 1) {
    arc[i] = arc[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  }

  return {
    b: bSigned,
    captured,
    winding,
    deflection,
    rMin,
    energyError,
    x: Float32Array.from(xs),
    z: Float32Array.from(zs),
    arc,
  };
}

function mirrorRay(ray) {
  const z = new Float32Array(ray.z.length);
  for (let i = 0; i < z.length; i += 1) z[i] = -ray.z[i];
  return {
    b: -ray.b,
    captured: ray.captured,
    winding: ray.winding,
    deflection: -ray.deflection,
    rMin: ray.rMin,
    energyError: ray.energyError,
    x: ray.x,
    z,
    arc: ray.arc,
  };
}

function buildCatalog() {
  const rays = [];
  for (let i = 0; i < IMPACTS.length; i += 1) {
    const ray = traceRay(IMPACTS[i]);
    rays.push(ray);
    rays.push(mirrorRay(ray));
  }
  rays.sort((a, b) => Math.abs(b.b) - Math.abs(a.b));
  return rays;
}

export const UNIT_RAYS = buildCatalog();

const featureRay = UNIT_RAYS.find((ray) => Math.abs(ray.b - FEATURE_B) < 1e-6);

function weakDeflection(bOverRs) {
  return 2 / bOverRs + (15 * Math.PI) / (16 * bOverRs * bOverRs);
}

function assertIntegrator() {
  const wide = traceRay(20, { x0: 160, rEscape: 160, minDist: 0.4 });
  const expected = weakDeflection(20);
  const got = Math.abs(wide.deflection);
  if (!(Math.abs(got - expected) < 0.008)) {
    throw new Error(`lens deflection ${got} != ${expected}`);
  }
  const plunge = UNIT_RAYS.find((ray) => Math.abs(ray.b - 1.55) < 1e-6);
  const scatter = featureRay;
  if (!plunge?.captured) throw new Error('inner ray was not captured');
  if (!scatter || scatter.captured) throw new Error('outer ray did not escape');
  if (!(scatter.x.length > 24)) throw new Error('outer ray is too short');
  if (wide.energyError > 1e-3) throw new Error('energy drifted');
}

assertIntegrator();

export function updateLiveLens(state) {
  if (!state.lens) {
    liveLens.enabled = false;
    return;
  }
  const hole = state.bodies.find((body) => body.kind === 'blackhole');
  if (!hole) {
    liveLens.enabled = false;
    return;
  }
  liveLens.enabled = true;
  liveLens.cx = hole.x;
  liveLens.cz = hole.z;
  liveLens.rs = Math.max(hole.displayHorizon, 0.08);
}

export function solarGrazingDeflection() {
  return (2 * schwarzschildRadius(M_SUN)) / R_SUN;
}

export function lensMetrics(bodies) {
  if (!liveLens.enabled || !featureRay) return null;
  const hole = bodies.find((body) => body.kind === 'blackhole');
  if (!hole) return null;
  const rs = schwarzschildRadius(hole.massKg);
  if (!(rs > 0)) return null;
  const distance = GALACTIC_CENTER_PC * PC_METERS;
  const shadow = (3 * Math.sqrt(3) * rs) / distance;
  const b = FEATURE_B;
  return {
    photonM: PHOTON_RADIUS * rs,
    bCritM: B_CRIT * rs,
    rs,
    featureB: b,
    deflection: Math.abs(featureRay.deflection),
    weak: 2 / b,
    solar: solarGrazingDeflection(),
    shadow,
    distancePc: GALACTIC_CENTER_PC,
  };
}

export function sampleRay(ray, distance) {
  const arc = ray.arc;
  const total = arc[arc.length - 1];
  if (!(total > 0)) return null;
  let s = distance % total;
  if (s < 0) s += total;
  let lo = 0;
  let hi = arc.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (arc[mid] <= s) lo = mid;
    else hi = mid;
  }
  const span = arc[hi] - arc[lo] || 1;
  const t = (s - arc[lo]) / span;
  const x = ray.x[lo] + (ray.x[hi] - ray.x[lo]) * t;
  const z = ray.z[lo] + (ray.z[hi] - ray.z[lo]) * t;
  const r = Math.hypot(x, z);
  return { x, z, r, t: s / total };
}
