/**
 * Mercury's perihelion advance, from the Schwarzschild orbit equation.
 *
 * A test mass on an inverse-square force traces a closed ellipse. The
 * relativistic correction is an extra inward acceleration
 *   a = −(3 K GM h²) / (c² r⁴)
 * which is exactly the term that turns
 *   d²u/dφ² + u = GM/h²
 * into
 *   d²u/dφ² + u = GM/h² + (3 GM/c²) u²
 * when K = 1. u = 1/r and h² is the squared specific angular momentum.
 *
 * K is hundreds of thousands, so the rosette is visible. The readout
 * undoes that and quotes the real advance in arcseconds. The path is the
 * Schwarzschild shape; the clock along it is still the simulation clock,
 * not proper time. Distances use the preset's meters-per-unit scale.
 */
import { AU, C, G, M_SUN } from './constants.js';

export const MERCURY_E = 0.20563;
export const MERCURY_A_AU = 0.387098;
export const MERCURY_A_SIM = 14;
export const PERI_ANGLE = 0.95;
export const PRECESS_SIM_MASS = 340;

const MERCURY_A_M = MERCURY_A_AU * AU;
const MERCURY_P_M = MERCURY_A_M * (1 - MERCURY_E * MERCURY_E);
const JULIAN_CENTURY_S = 36525 * 86400;

/** Radians of perihelion advance per revolution. pMeters is the semi-latus rectum. */
export function trueAdvance(massKg, pMeters) {
  if (!(massKg > 0) || !(pMeters > 0)) return NaN;
  return (6 * Math.PI * G * massKg) / (C * C * pMeters);
}

export const CANONICAL_ADVANCE = trueAdvance(M_SUN, MERCURY_P_M);

// First-order advance drawn on the sheet for the real Mercury elements.
// The integrator is the orbit equation itself, so the walked angle sits a
// little above this once the term is large. The trace measures the walk
// and the panel prefers that measurement. Kept near 10° so the ellipse
// does not get badly distorted by the enlarged 1/r⁴ pull.
const SCREEN_TARGET_RAD = (10 * Math.PI) / 180;
export const PRECESS_GAIN = SCREEN_TARGET_RAD / CANONICAL_ADVANCE;

export const livePrecess = {
  enabled: false,
  gain: PRECESS_GAIN,
  metersPerUnit: 1,
  primaryId: null,
  planetId: null,
  cx: 0,
  cz: 0,
  primaryRadius: 1,
  elements: null,
  markers: [],
  measuredAdvance: null,
  seenOutbound: false,
  seenInbound: false,
  prevVr: 0,
};

function heaviest(bodies) {
  let best = bodies[0] ?? null;
  for (let i = 1; i < bodies.length; i += 1) {
    if (bodies[i].massKg > best.massKg) best = bodies[i];
  }
  return best;
}

export function orbitElements(body, primary) {
  const x = body.x - primary.x;
  const z = body.z - primary.z;
  const vx = body.vx - primary.vx;
  const vz = body.vz - primary.vz;
  const r2 = x * x + z * z;
  const r = Math.sqrt(r2);
  const mu = primary.simMass;
  if (!(r > 1e-4) || !(mu > 0)) return null;
  const h = x * vz - z * vx;
  const v2 = vx * vx + vz * vz;
  const rv = x * vx + z * vz;
  const ex = ((v2 - mu / r) * x - rv * vx) / mu;
  const ez = ((v2 - mu / r) * z - rv * vz) / mu;
  return {
    x,
    z,
    vx,
    vz,
    r,
    h,
    ex,
    ez,
    e: Math.hypot(ex, ez),
    p: (h * h) / mu,
    mu,
  };
}

export function mercuryInitial(simMass, angle = PERI_ANGLE) {
  const a = MERCURY_A_SIM;
  const e = MERCURY_E;
  const rp = a * (1 - e);
  const speed = Math.sqrt((simMass * (1 + e)) / (a * (1 - e)));
  return {
    x: Math.cos(angle) * rp,
    z: Math.sin(angle) * rp,
    vx: -Math.sin(angle) * speed,
    vz: Math.cos(angle) * speed,
  };
}

export function resetLivePrecess(state) {
  livePrecess.markers = [];
  livePrecess.measuredAdvance = null;
  livePrecess.seenOutbound = false;
  livePrecess.seenInbound = false;
  livePrecess.prevVr = 0;
  livePrecess.primaryId = null;
  livePrecess.planetId = null;
  livePrecess.elements = null;
  livePrecess.gain = PRECESS_GAIN;
  updateLivePrecess(state);
}

export function clearPrecessMarks() {
  livePrecess.markers = [];
  livePrecess.measuredAdvance = null;
  livePrecess.seenOutbound = false;
  livePrecess.seenInbound = false;
  livePrecess.prevVr = 0;
}

export function updateLivePrecess(state) {
  if (!state.precess) {
    livePrecess.enabled = false;
    return;
  }
  livePrecess.enabled = true;
  livePrecess.metersPerUnit = state.metersPerUnit;
  livePrecess.gain = PRECESS_GAIN;
  let primary = state.bodies.find((body) => body.id === livePrecess.primaryId);
  if (!primary) primary = heaviest(state.bodies);
  if (!primary) {
    livePrecess.enabled = false;
    return;
  }
  livePrecess.primaryId = primary.id;
  livePrecess.cx = primary.x;
  livePrecess.cz = primary.z;
  livePrecess.primaryRadius = primary.radius;
  let planet = state.bodies.find((body) => body.id === livePrecess.planetId);
  if (!planet || planet.id === primary.id) {
    planet = state.bodies.find((body) => body.name === 'Mercury' && body.id !== primary.id)
      ?? state.bodies.find((body) => body.id !== primary.id)
      ?? null;
  }
  livePrecess.planetId = planet ? planet.id : null;
  if (!planet) return;
  const el = orbitElements(planet, primary);
  livePrecess.elements = el;
  if (!el) return;
  const vr = (el.x * el.vx + el.z * el.vz) / el.r;
  if (vr > 0.25) livePrecess.seenOutbound = true;
  if (livePrecess.seenOutbound && vr < -0.25) livePrecess.seenInbound = true;
  if (livePrecess.seenInbound && livePrecess.prevVr < 0 && vr >= 0) {
    livePrecess.markers.push({ ox: el.x, oz: el.z });
    if (livePrecess.markers.length > 6) livePrecess.markers.shift();
    livePrecess.seenOutbound = false;
    livePrecess.seenInbound = false;
  }
  livePrecess.prevVr = vr;
}

/**
 * Extra Schwarzschild acceleration on every body except the central mass.
 * Central-force, so h is conserved and the orbit equation applies.
 * The kick is capped so a dragged body cannot blow up the step.
 */
export function precessKick(bodies) {
  if (!livePrecess.enabled) return;
  const primary = bodies.find((body) => body.id === livePrecess.primaryId);
  if (!primary || !(primary.simMass > 0) || !(primary.massKg > 0)) return;
  const length = livePrecess.metersPerUnit;
  if (!(length > 0)) return;
  const gmOverC2 = (G * primary.massKg) / (C * C);
  const mu = primary.simMass;
  const gain = livePrecess.gain;
  for (let i = 0; i < bodies.length; i += 1) {
    const body = bodies[i];
    if (body.id === primary.id) continue;
    const x = body.x - primary.x;
    const z = body.z - primary.z;
    const r2 = x * x + z * z;
    if (r2 < 0.16) continue;
    const r = Math.sqrt(r2);
    const h = x * (body.vz - primary.vz) - z * (body.vx - primary.vx);
    const beta = gain * 3 * gmOverC2 * h * h / length;
    let mag = beta / (r2 * r2);
    const newtonMag = mu / r2;
    const cap = newtonMag * 2.5;
    if (mag > cap) mag = cap;
    const scale = mag / r;
    body.ax -= x * scale;
    body.az -= z * scale;
  }
}

export function writeNewtonEllipse(cx, cz, out) {
  const count = out.length / 2;
  const a = MERCURY_A_SIM;
  const e = MERCURY_E;
  const b = a * Math.sqrt(1 - e * e);
  const periX = Math.cos(PERI_ANGLE);
  const periZ = Math.sin(PERI_ANGLE);
  const sideX = -periZ;
  const sideZ = periX;
  const ox = cx - periX * a * e;
  const oz = cz - periZ * a * e;
  for (let i = 0; i < count; i += 1) {
    const E = (i / count) * Math.PI * 2;
    const cE = Math.cos(E);
    const sE = Math.sin(E);
    out[i * 2] = ox + periX * (a * cE) + sideX * (b * sE);
    out[i * 2 + 1] = oz + periZ * (a * cE) + sideZ * (b * sE);
  }
}

export function precessMetrics(bodies, metersPerUnit) {
  if (!livePrecess.enabled) return null;
  const primary = bodies.find((body) => body.id === livePrecess.primaryId);
  const planet = bodies.find((body) => body.id === livePrecess.planetId);
  if (!primary || !planet) return null;
  const el = livePrecess.elements ?? orbitElements(planet, primary);
  if (!el || !(el.p > 0)) return null;
  const pMeters = el.p * metersPerUnit;
  const perOrbit = trueAdvance(primary.massKg, pMeters);
  const designP = MERCURY_A_SIM * (1 - MERCURY_E * MERCURY_E);
  const onDesign = Math.abs(el.p - designP) / designP < 0.02
    && Math.abs(primary.massKg / M_SUN - 1) < 0.05;
  // On the preset orbit, p is conserved but the Newtonian eccentricity
  // vector breathes, because the enlarged term is no longer tiny. Quote
  // Mercury's elements, which match that p, instead of the breathing value.
  const e = onDesign ? MERCURY_E : el.e;
  const bound = e < 0.92 && el.p > 0.5;
  const aMeters = onDesign
    ? MERCURY_A_M
    : bound ? pMeters / (1 - Math.min(e, 0.999) * Math.min(e, 0.999)) : NaN;
  const period = Number.isFinite(aMeters) && primary.massKg > 0
    ? 2 * Math.PI * Math.sqrt((aMeters ** 3) / (G * primary.massKg))
    : NaN;
  const perCentury = Number.isFinite(period) && period > 0
    ? perOrbit * (JULIAN_CENTURY_S / period)
    : NaN;
  let screenRad = perOrbit * PRECESS_GAIN;
  if (Number.isFinite(livePrecess.measuredAdvance) && CANONICAL_ADVANCE > 0 && Number.isFinite(perOrbit)) {
    screenRad = livePrecess.measuredAdvance * (perOrbit / CANONICAL_ADVANCE);
  }
  const nearMercury = onDesign && bound;
  return {
    host: primary.name,
    planet: planet.name,
    e,
    bound,
    aMeters,
    pMeters,
    perOrbit,
    perCentury,
    period,
    gain: PRECESS_GAIN,
    screenRad,
    nearMercury,
    ex: el.ex,
    ez: el.ez,
    pSim: el.p,
  };
}
