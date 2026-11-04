/**
 * The last stable circular orbit of a Schwarzschild black hole.
 * Timelike circles exist from just outside the photon sphere out to infinity.
 * Only those with r > 6GM/c² are stable. That radius is the ISCO, at 3 rₛ.
 * A particle given the ISCO's energy and angular momentum and released just
 * inside it has nowhere to sit: the effective potential falls away, and the
 * geodesic peels off and crosses the horizon.
 * Lengths below are r/rₛ. Proper time σ and distant-clock time t are in
 * units of rₛ/c, so the shape does not depend on the mass. The periods in
 * the panel are the same geodesics in SI. The beads step evenly in radius
 * so the spiral can be watched; the clocks in the panel are not sped up.
 */
import { C, M_SUN, schwarzschildRadius } from './constants.js';

export const ISCO_U = 3;
export const STABLE_U = 5;
export const PLUNGE_U0 = 2.85;
export const PLUNGE_U1 = 1.12;
/** Screen horizon. The orbits are this many times larger. */
export const ISCO_RS = 1.72;
export const ISCO_SOLAR = 10;
export const SGR_SOLAR = 4.3e6;
/** Where the plunge spiral opens, so it does not hide behind the camera. */
export const PLUNGE_ANGLE = 0.72;

const ISCO_ENERGY = Math.sqrt(8 / 9);
const ISCO_LAMBDA = Math.sqrt(3);
const LOOP_SECONDS = 13;
const HOLD = 0.05;
const TRAVEL_END = 0.9;
const FADE_AT = 0.945;
const ISCO_REV_SECONDS = 8.6;
const STABLE_PERIOD_RATIO = (STABLE_U / ISCO_U) ** 1.5;
const SAMPLE_COUNT = 220;

export const liveIsco = {
  enabled: false,
  cx: 0,
  cz: 0,
  rs: ISCO_RS,
  massKg: 0,
  plungeU: PLUNGE_U0,
  plungePhi: 0,
  plungeSigma: 0,
  plungeCoord: 0,
  along: 0,
  fade: 1,
  iscoPhi: 0.62,
  stablePhi: 2.45,
  phase: 0.04,
};

function potential(u, lambda) {
  const inv = 1 / u;
  return (1 - inv) * (1 + lambda * lambda * inv * inv);
}

export function specificEnergy(u) {
  return (1 - 1 / u) / Math.sqrt(1 - 1.5 / u);
}

export function specificAngularMomentum(u) {
  return Math.sqrt((u / 2) / (1 - 1.5 / u));
}

/** Orbital speed measured by a hovering observer, as a fraction of c. */
export function localSpeedFraction(u) {
  const energy = specificEnergy(u);
  const lambda = specificAngularMomentum(u);
  return (lambda * Math.sqrt(1 - 1 / u)) / (energy * u);
}

/** Distant-clock period of a circular geodesic. Ω = √(GM/r³) still. */
export function orbitPeriod(massKg, u) {
  const rs = schwarzschildRadius(massKg);
  return (2 * Math.PI * Math.sqrt(2 * u * u * u) * rs) / C;
}

function deriv(u, energy, lambda) {
  const radial = energy * energy - potential(u, lambda);
  return [
    -Math.sqrt(Math.max(radial, 0)),
    lambda / (u * u),
    energy / (1 - 1 / u),
  ];
}

function stepGeodesic(u, energy, lambda, dS) {
  const k1 = deriv(u, energy, lambda);
  const k2 = deriv(Math.max(u + 0.5 * dS * k1[0], 1.01), energy, lambda);
  const k3 = deriv(Math.max(u + 0.5 * dS * k2[0], 1.01), energy, lambda);
  const k4 = deriv(Math.max(u + dS * k3[0], 1.01), energy, lambda);
  const mix = (i) => (dS / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  return [u + mix(0), mix(1), mix(2)];
}

function integratePlunge() {
  const energy = ISCO_ENERGY;
  const lambda = ISCO_LAMBDA;
  let u = PLUNGE_U0;
  let phi = 0;
  let sigma = 0;
  let coord = 0;
  const raw = [{ u, phi, sigma, coord }];
  for (let n = 0; n < 80000 && u > PLUNGE_U1; n += 1) {
    const speed = Math.max(Math.abs(deriv(u, energy, lambda)[0]), 1e-6);
    const dS = Math.min(0.03, 0.006 / speed);
    const next = stepGeodesic(u, energy, lambda, dS);
    if (!(next[0] < u)) break;
    u = next[0];
    phi += next[1];
    sigma += dS;
    coord += next[2];
    raw.push({ u, phi, sigma, coord });
  }
  return raw;
}

function resample(raw) {
  const u0 = raw[0].u;
  const u1 = raw[raw.length - 1].u;
  const out = [];
  let j = 0;
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const target = u0 + ((u1 - u0) * i) / (SAMPLE_COUNT - 1);
    while (j < raw.length - 2 && raw[j + 1].u > target) j += 1;
    const a = raw[j];
    const b = raw[Math.min(j + 1, raw.length - 1)];
    const span = a.u - b.u;
    const f = span === 0 ? 0 : Math.max(0, Math.min(1, (a.u - target) / span));
    out.push({
      u: a.u * (1 - f) + b.u * f,
      phi: a.phi * (1 - f) + b.phi * f,
      sigma: a.sigma * (1 - f) + b.sigma * f,
      coord: a.coord * (1 - f) + b.coord * f,
    });
  }
  return out;
}

const RAW = integratePlunge();
export const PLUNGE = resample(RAW);
const PLUNGE_END = PLUNGE[PLUNGE.length - 1];

function nearly(actual, expected, tol, label) {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${label}: ${actual} is not within ${tol} of ${expected}`);
  }
}

function checkPlunge() {
  nearly(specificEnergy(ISCO_U), ISCO_ENERGY, 1e-12, 'ISCO energy');
  nearly(specificAngularMomentum(ISCO_U), ISCO_LAMBDA, 1e-12, 'ISCO angular momentum');
  nearly(localSpeedFraction(ISCO_U), 0.5, 1e-12, 'ISCO local speed');
  nearly(localSpeedFraction(STABLE_U), 1 / Math.sqrt(8), 1e-12, 'stable local speed');
  nearly(1 - ISCO_ENERGY, 1 - Math.sqrt(8 / 9), 1e-15, 'ISCO binding');
  const rs = schwarzschildRadius(ISCO_SOLAR * M_SUN);
  const period = orbitPeriod(ISCO_SOLAR * M_SUN, ISCO_U);
  nearly(period, (2 * Math.PI * Math.sqrt(54) * rs) / C, 1e-9, 'ISCO period');
  if (!(specificEnergy(STABLE_U) > ISCO_ENERGY)) {
    throw new Error('the outer circular orbit should be less bound than the ISCO');
  }
  for (const u of [4, 5, 8]) {
    const lambda = specificAngularMomentum(u);
    const energy = specificEnergy(u);
    const here = potential(u, lambda);
    const up = potential(u + 1e-4, lambda);
    const down = potential(u - 1e-4, lambda);
    if (Math.abs(here - energy * energy) > 1e-9) throw new Error(`circular energy missed at ${u}`);
    if (Math.abs(up - down) > 5e-6) throw new Error(`circular orbit is not at a potential extremum at ${u}`);
    if (!(up - 2 * here + down > 0)) throw new Error(`orbit at ${u} is not a potential minimum`);
  }
  const lambdaIn = specificAngularMomentum(2.5);
  const energyIn = specificEnergy(2.5);
  const mid = potential(2.5, lambdaIn);
  const side = potential(2.5 + 2e-3, lambdaIn) - 2 * mid + potential(2.5 - 2e-3, lambdaIn);
  if (!(Math.abs(mid - energyIn * energyIn) < 1e-9 && side < 0)) {
    throw new Error('the circular orbit inside the ISCO should be a potential maximum');
  }
  if (RAW.length < 40) throw new Error('plunge integration stopped too soon');
  if (!(RAW[RAW.length - 1].u <= PLUNGE_U1 + 0.02 && RAW[RAW.length - 1].u > 1.05)) {
    throw new Error('plunge did not end just outside the horizon');
  }
  let worstRadial = 0;
  let worstPhi = 0;
  for (let i = 1; i < RAW.length; i += 1) {
    const prev = RAW[i - 1];
    const sample = RAW[i];
    if (!(sample.u < prev.u && sample.sigma > prev.sigma && sample.coord > prev.coord && sample.phi > prev.phi)) {
      throw new Error('plunge radius, angle, or clock went backwards');
    }
    const dS = sample.sigma - prev.sigma;
    const mid = 0.5 * (sample.u + prev.u);
    const expectDu = -Math.sqrt(Math.max(ISCO_ENERGY ** 2 - potential(mid, ISCO_LAMBDA), 0));
    const expectDphi = ISCO_LAMBDA / (mid * mid);
    worstRadial = Math.max(worstRadial, Math.abs((sample.u - prev.u) / dS - expectDu));
    worstPhi = Math.max(worstPhi, Math.abs((sample.phi - prev.phi) / dS - expectDphi));
  }
  if (worstRadial > 5e-4) throw new Error(`plunge radial speed drifted by ${worstRadial}`);
  if (worstPhi > 5e-4) throw new Error(`plunge angular speed drifted by ${worstPhi}`);
  if (!(PLUNGE_END.phi > Math.PI * 2.4)) throw new Error('plunge should wind more than a turn');
  if (!(PLUNGE_END.coord > PLUNGE_END.sigma)) throw new Error('a distant clock should advance more than proper time');
  if (!(PLUNGE[0].u > 2.8 && PLUNGE[PLUNGE.length - 1].u < 1.2)) throw new Error('resampled plunge lost its ends');
  const release = potential(PLUNGE_U0, ISCO_LAMBDA);
  if (!(ISCO_ENERGY ** 2 - release > 0 && ISCO_ENERGY ** 2 - release < 1e-4)) {
    throw new Error('the plunge should start almost at rest, just inside the ISCO');
  }
}

checkPlunge();

export function samplePlunge(fraction) {
  const x = Math.max(0, Math.min(1, fraction)) * (PLUNGE.length - 1);
  const i = Math.min(PLUNGE.length - 2, Math.floor(x));
  const f = x - i;
  const a = PLUNGE[i];
  const b = PLUNGE[i + 1];
  return {
    u: a.u * (1 - f) + b.u * f,
    phi: a.phi * (1 - f) + b.phi * f,
    sigma: a.sigma * (1 - f) + b.sigma * f,
    coord: a.coord * (1 - f) + b.coord * f,
  };
}

export function resetLiveIsco() {
  liveIsco.phase = 0.04;
  liveIsco.fade = 1;
  liveIsco.along = 0;
  liveIsco.plungeU = PLUNGE_U0;
  liveIsco.plungePhi = 0;
  liveIsco.plungeSigma = 0;
  liveIsco.plungeCoord = 0;
  liveIsco.iscoPhi = 0.62;
  liveIsco.stablePhi = 2.45;
}

export function updateLiveIsco(state, dt) {
  const hole = state.isco ? state.bodies.find((body) => body.kind === 'blackhole') : null;
  if (!hole) {
    liveIsco.enabled = false;
    return;
  }
  liveIsco.enabled = true;
  liveIsco.cx = hole.x;
  liveIsco.cz = hole.z;
  liveIsco.rs = Math.max(hole.displayHorizon, 0.08);
  liveIsco.massKg = hole.massKg;
  if (!state.paused && state.timeScale > 0 && dt > 0) {
    const scaled = dt * state.timeScale;
    liveIsco.phase = (liveIsco.phase + scaled / LOOP_SECONDS) % 1;
    liveIsco.iscoPhi = (liveIsco.iscoPhi + (scaled * 2 * Math.PI) / ISCO_REV_SECONDS) % (Math.PI * 2);
    liveIsco.stablePhi = (liveIsco.stablePhi + (scaled * 2 * Math.PI) / (ISCO_REV_SECONDS * STABLE_PERIOD_RATIO)) % (Math.PI * 2);
  }
  const p = liveIsco.phase;
  let along = 0;
  if (p >= TRAVEL_END) along = 1;
  else if (p > HOLD) along = (p - HOLD) / (TRAVEL_END - HOLD);
  const probed = samplePlunge(along);
  liveIsco.along = along;
  liveIsco.plungeU = probed.u;
  liveIsco.plungePhi = probed.phi;
  liveIsco.plungeSigma = probed.sigma;
  liveIsco.plungeCoord = probed.coord;
  let fade = 1;
  if (p < 0.035) fade = p / 0.035;
  if (p > FADE_AT) fade = Math.min(fade, 1 - (p - FADE_AT) / (1 - FADE_AT));
  liveIsco.fade = Math.max(0, fade);
}

export function iscoMetrics(bodies) {
  if (!liveIsco.enabled) return null;
  const hole = bodies.find((body) => body.kind === 'blackhole');
  if (!hole) return null;
  const massKg = hole.massKg;
  const rs = schwarzschildRadius(massKg);
  const unit = rs / C;
  return {
    rs,
    massKg,
    iscoRadius: ISCO_U * rs,
    stableRadius: STABLE_U * rs,
    photonRadius: 1.5 * rs,
    period: orbitPeriod(massKg, ISCO_U),
    stablePeriod: orbitPeriod(massKg, STABLE_U),
    sgrPeriod: orbitPeriod(SGR_SOLAR * M_SUN, ISCO_U),
    energy: ISCO_ENERGY,
    binding: 1 - ISCO_ENERGY,
    stableBinding: 1 - specificEnergy(STABLE_U),
    localSpeed: localSpeedFraction(ISCO_U),
    stableSpeed: localSpeedFraction(STABLE_U),
    kappaRatio: Math.sqrt(1 - 3 / STABLE_U),
    plungeU: liveIsco.plungeU,
    plungeU0: PLUNGE_U0,
    plungeU1: PLUNGE_END.u,
    plungeTau: liveIsco.plungeSigma * unit,
    plungeCoord: liveIsco.plungeCoord * unit,
    plungeTauEnd: PLUNGE_END.sigma * unit,
    plungeCoordEnd: PLUNGE_END.coord * unit,
    turns: PLUNGE_END.phi / (2 * Math.PI),
    stableU: STABLE_U,
  };
}
