/**
 * Frame dragging around a Kerr black hole.
 * The sheet shear and the ticks are a diagram: they turn fast enough to see,
 * and closer in they lead, falling as 1/r³. The readout uses the exact
 * equatorial ZAMO angular velocity, in SI, not that diagram rate.
 */
import { C, G, M_SUN, schwarzschildRadius } from './constants.js';

export const DRAG_SPIN = 0.9;
export const STAR_OVER_RS = 2.55;

export const TICK_RINGS = [
  { mul: 0.86, count: 8, span: 0.11, color: [1.7, 1.12, 0.38] },
  { mul: 1.48, count: 10, span: 0.12, color: [0.62, 1.38, 0.58] },
  { mul: STAR_OVER_RS, count: 12, span: 0.13, color: [0.42, 1.12, 0.62] },
];

const VISUAL_RATE = 0.92;

export const liveDrag = {
  enabled: false,
  ready: false,
  cx: 0,
  cz: 0,
  phase: 1.15,
  rRef: 1,
  rHorizon: 1,
  spin: DRAG_SPIN,
};

export function kerrHorizonOverRs(spin) {
  const a2 = Math.min(1, Math.max(0, spin)) ** 2;
  return 0.5 * (1 + Math.sqrt(Math.max(0, 1 - a2)));
}

/** Prograde ISCO in units of the Schwarzschild radius. 3 when spin is 0. */
export function iscoProgradeOverRs(spin) {
  const a = Math.max(0, Math.min(1, spin));
  const a2 = a * a;
  const cube = (value) => value ** (1 / 3);
  const z1 = 1 + cube(1 - a2) * (cube(1 + a) + cube(1 - a));
  const z2 = Math.sqrt(3 * a2 + z1 * z1);
  const rOverM = 3 + z2 - Math.sqrt(Math.max(0, (3 - z1) * (3 + z1 + 2 * z2)));
  return rOverM / 2;
}

function geomMass(massKg) {
  return (G * massKg) / (C * C);
}

/** Angular velocity of the horizon, radians per second. */
export function horizonOmega(massKg, spin) {
  const aHat = Math.max(0, Math.min(0.999999, spin));
  if (!(massKg > 0) || aHat === 0) return 0;
  const rPlus = geomMass(massKg) * (1 + Math.sqrt(1 - aHat * aHat));
  return (aHat * C) / (2 * rPlus);
}

/**
 * Equatorial angular velocity of a zero-angular-momentum observer.
 * Boyer–Lindquist, geometric ω times c. Valid outside the horizon.
 */
export function zamoOmega(massKg, spin, rMeters) {
  if (!(massKg > 0) || !(rMeters > 0)) return NaN;
  const aHat = Math.max(0, Math.min(0.999999, spin));
  const M = geomMass(massKg);
  const a = aHat * M;
  const r = rMeters;
  const delta = r * r - 2 * M * r + a * a;
  const radial = r * r + a * a;
  const denom = radial * radial - delta * a * a;
  if (!(denom > 0)) return NaN;
  return ((2 * M * a * r) / denom) * C;
}

/** Far-zone limit of the same rate: 2 G J / (c² r³), with J = â G M² / c. */
export function weakZamoOmega(massKg, spin, rMeters) {
  if (!(massKg > 0) || !(rMeters > 0)) return NaN;
  const aHat = Math.max(0, Math.min(1, spin));
  return (2 * aHat * G * G * massKg * massKg) / (C ** 3 * rMeters ** 3);
}

function nearly(got, expected, tol, label) {
  if (!Number.isFinite(got) || Math.abs(got - expected) > tol) {
    throw new Error(`${label}: ${got} != ${expected}`);
  }
}

function assertKerr() {
  nearly(kerrHorizonOverRs(0), 1, 1e-12, 'Schwarzschild horizon');
  nearly(kerrHorizonOverRs(1), 0.5, 1e-12, 'extremal horizon');
  nearly(iscoProgradeOverRs(0), 3, 1e-9, 'Schwarzschild ISCO');
  nearly(iscoProgradeOverRs(1), 0.5, 1e-9, 'extremal ISCO');
  nearly(iscoProgradeOverRs(0.9), 1.16044, 2e-4, 'spin 0.9 ISCO');
  nearly(kerrHorizonOverRs(0.9), 0.717945, 2e-4, 'spin 0.9 horizon');

  const mass = 6.5e9 * M_SUN;
  const rs = schwarzschildRadius(mass);
  const rPlus = kerrHorizonOverRs(0.9) * rs;
  const atHorizon = zamoOmega(mass, 0.9, rPlus);
  nearly(atHorizon, horizonOmega(mass, 0.9), Math.abs(atHorizon) * 1e-6 + 1e-18, 'horizon rate');

  const far = rs * 80;
  const exact = zamoOmega(mass, 0.9, far);
  const weak = weakZamoOmega(mass, 0.9, far);
  if (!(exact > 0) || Math.abs(exact - weak) / weak > 0.02) {
    throw new Error(`weak-field frame drag ${exact} vs ${weak}`);
  }
  if (!(horizonOmega(mass, 0) === 0)) throw new Error('zero spin still drags');
}

assertKerr();

export function updateLiveDrag(state, dt) {
  const hole = state.drag
    ? state.bodies.find((body) => body.kind === 'blackhole' && body.kerrSpin > 0)
    : null;
  if (!hole) {
    liveDrag.enabled = false;
    liveDrag.ready = false;
    return;
  }
  const spin = Math.max(0, Math.min(0.999, hole.kerrSpin));
  const factor = kerrHorizonOverRs(spin);
  liveDrag.enabled = true;
  liveDrag.cx = hole.x;
  liveDrag.cz = hole.z;
  liveDrag.spin = spin;
  liveDrag.rHorizon = Math.max(hole.displayHorizon, 0.08);
  liveDrag.rRef = liveDrag.rHorizon / Math.max(factor, 0.05);
  if (!liveDrag.ready) {
    liveDrag.phase = 1.15;
    liveDrag.ready = true;
  }
  if (!state.paused && state.timeScale > 0 && dt > 0) {
    liveDrag.phase += dt * state.timeScale * VISUAL_RATE;
  }
}

export function dragMetrics(bodies, metersPerUnit) {
  if (!liveDrag.enabled) return null;
  const hole = bodies.find((body) => body.kind === 'blackhole' && body.kerrSpin > 0);
  if (!hole) return null;
  const spin = Math.max(0, Math.min(0.999, hole.kerrSpin));
  const rs = schwarzschildRadius(hole.massKg);
  if (!(rs > 0)) return null;
  const horizonM = kerrHorizonOverRs(spin) * rs;
  const iscoM = iscoProgradeOverRs(spin) * rs;
  let partner = null;
  let best = -1;
  for (let i = 0; i < bodies.length; i += 1) {
    const other = bodies[i];
    if (other.id === hole.id) continue;
    const sim = Math.hypot(other.x - hole.x, other.z - hole.z);
    const pull = other.massKg / (sim * sim + 1e-6);
    if (pull > best) {
      best = pull;
      partner = other;
    }
  }
  const separation = partner
    ? Math.max(Math.hypot(hole.x - partner.x, hole.z - partner.z) * metersPerUnit, horizonM * 1.02)
    : STAR_OVER_RS * rs;
  if (!(separation > horizonM)) return null;
  const omega = zamoOmega(hole.massKg, spin, separation);
  const weak = weakZamoOmega(hole.massKg, spin, separation);
  const spinRate = horizonOmega(hole.massKg, spin);
  if (!(omega > 0) || !Number.isFinite(weak) || !(spinRate > 0)) return null;
  return {
    spin,
    rs,
    horizonM,
    ergoM: rs,
    iscoM,
    separation,
    partnerName: partner ? partner.name : null,
    omega,
    weak,
    period: (2 * Math.PI) / omega,
    weakPeriod: (2 * Math.PI) / weak,
    horizonPeriod: (2 * Math.PI) / spinRate,
  };
}
