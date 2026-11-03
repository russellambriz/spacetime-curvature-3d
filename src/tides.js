/**
 * Geodesic deviation for a body falling into a Schwarzschild hole.
 * Released from rest, a small separation ξ obeys
 *   d²ξ∥ / dτ² = +(2GM / r³) ξ∥
 *   d²ξ⊥ / dτ² = −(GM / r³) ξ⊥
 * along the radial fall. Lengths below are in units of the horizon and
 * proper time is in units of rₛ/c, so the shape versus r/rₛ does not
 * depend on the mass. The accelerations reported for a person use SI.
 * The ring on the sheet is this solution, drawn large enough to see.
 * Arrow marks on the far side are the same tide, sampled at fixed radii:
 * radial arrows are twice the transverse ones, and both fall as 1/r³.
 */
import { C, G, M_SUN, schwarzschildRadius } from './constants.js';

export const TIDE_RS = 1.55;
export const TIDE_SOLAR = 10;
export const PERSON_M = 2;
export const SGR_SOLAR = 4.3e6;
export const RELEASE_U = 6.15;
/** Screen direction of the fall, toward the open part of the view. */
export const FALL_ANGLE = Math.PI + 0.62;
/** Visual half-axis of the ring at release, in horizons. */
export const RING_OVER_RS = 0.42;

const END_U = 1.42;
const GEE = 9.80665;
const LOOP_SECONDS = 12;
const HOLD = 0.08;
const TRAVEL_END = 0.88;
const FADE_AT = 0.965;

const STATIONS = [4.2, 3.3, 2.65, 2.2];

export const liveTides = {
  enabled: false,
  cx: 0,
  cz: 0,
  rs: TIDE_RS,
  massKg: 0,
  u: RELEASE_U,
  sr: 1,
  sp: 1,
  tauUnits: 0,
  tauTotal: 1,
  fade: 1,
  phase: 0,
};

function derive(st) {
  const radius = Math.max(st[0], 1.02);
  const inv = 1 / (radius * radius * radius);
  return [
    st[1],
    -1 / (2 * radius * radius),
    st[3],
    st[2] * inv,
    st[5],
    -0.5 * st[4] * inv,
  ];
}

function integrate() {
  const u = [RELEASE_U];
  const vu = [0];
  const sr = [1];
  const sp = [1];
  const tau = [0];
  let state = [RELEASE_U, 0, 1, 0, 1, 0];
  let T = 0;
  const dT = 0.008;
  for (let n = 0; n < 20000 && state[0] > END_U; n += 1) {
    const s = state;
    const k1 = derive(s);
    const s2 = s.map((v, i) => v + 0.5 * dT * k1[i]);
    const k2 = derive(s2);
    const s3 = s.map((v, i) => v + 0.5 * dT * k2[i]);
    const k3 = derive(s3);
    const s4 = s.map((v, i) => v + dT * k3[i]);
    const k4 = derive(s4);
    state = s.map((v, i) => v + (dT / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + 2 * k4[i]));
    T += dT;
    if (!(state[0] < s[0])) break;
    u.push(state[0]);
    vu.push(state[1]);
    sr.push(state[2]);
    sp.push(state[4]);
    tau.push(T);
  }
  return { u, vu, sr, sp, tau };
}

const PATH = integrate();

function checkPath() {
  const last = PATH.u.length - 1;
  if (PATH.u.length < 40) throw new Error('tide path is too short');
  if (PATH.u[0] !== RELEASE_U || PATH.sr[0] !== 1 || PATH.sp[0] !== 1) {
    throw new Error('tide path must start round, at rest');
  }
  if (!(PATH.u[last] < 1.6 && PATH.u[last] > 1.2)) throw new Error('tide path must end near the horizon');
  if (!(PATH.sr[last] > 3.2)) throw new Error('radial tide did not stretch the body');
  if (!(PATH.sp[last] < 0.45 && PATH.sp[last] > 0.05)) throw new Error('transverse tide did not squeeze the body');
  if (!(PATH.sr[last] / PATH.sp[last] > 8)) throw new Error('tide aspect ratio stayed too round');
  let worst = 0;
  let worstAt = 0;
  for (let i = 0; i < PATH.u.length; i += 1) {
    const expect = -Math.sqrt(Math.max(1 / PATH.u[i] - 1 / RELEASE_U, 0));
    const err = Math.abs(PATH.vu[i] - expect);
    if (err > worst) {
      worst = err;
      worstAt = i;
    }
  }
  if (worst > 1e-4) {
    throw new Error(`radial fall drifted from the energy equation by ${worst} at u=${PATH.u[worstAt]}`);
  }
  const rs = schwarzschildRadius(TIDE_SOLAR * M_SUN);
  const atHorizon = radialAccel(TIDE_SOLAR * M_SUN, rs, PERSON_M);
  const fromFormula = (C * C * PERSON_M) / (rs * rs);
  if (Math.abs(atHorizon - fromFormula) / fromFormula > 1e-9) {
    throw new Error('horizon tide does not match c²L/rₛ²');
  }
}

checkPath();

function playableEnd() {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    const probed = sampleRadius(mid);
    const inner = probed.u - RING_OVER_RS * probed.sr;
    if (inner > 1.12) lo = mid;
    else hi = mid;
  }
  return lo;
}

function sampleRadius(fraction) {
  const last = PATH.u.length - 1;
  const target = RELEASE_U + (PATH.u[last] - RELEASE_U) * Math.max(0, Math.min(1, fraction));
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (PATH.u[mid] > target) lo = mid;
    else hi = mid;
  }
  const span = PATH.u[lo] - PATH.u[hi];
  const f = span === 0 ? 0 : (PATH.u[lo] - target) / span;
  const mix = (arr) => arr[lo] * (1 - f) + arr[hi] * f;
  return { u: mix(PATH.u), sr: mix(PATH.sr), sp: mix(PATH.sp), tau: mix(PATH.tau) };
}

const PLAY_END = playableEnd();
const PLAY_TAU = sampleRadius(PLAY_END).tau;

export function radialAccel(massKg, radiusM, lengthM) {
  return (2 * G * massKg * lengthM) / (radiusM * radiusM * radiusM);
}

export function oneGeeRadius(massKg, lengthM = PERSON_M) {
  return Math.cbrt((2 * G * massKg * lengthM) / GEE);
}

export function resetLiveTides() {
  liveTides.phase = 0.03;
  liveTides.fade = 1;
  liveTides.u = RELEASE_U;
  liveTides.sr = 1;
  liveTides.sp = 1;
  liveTides.tauUnits = 0;
}

export function updateLiveTides(state, dt) {
  const hole = state.tides ? state.bodies.find((body) => body.kind === 'blackhole') : null;
  if (!hole) {
    liveTides.enabled = false;
    return;
  }
  liveTides.enabled = true;
  liveTides.cx = hole.x;
  liveTides.cz = hole.z;
  liveTides.rs = Math.max(hole.displayHorizon, 0.08);
  liveTides.massKg = hole.massKg;
  liveTides.tauTotal = PLAY_TAU;
  if (!state.paused && state.timeScale > 0 && dt > 0) {
    liveTides.phase = (liveTides.phase + (dt * state.timeScale) / LOOP_SECONDS) % 1;
  }
  const p = liveTides.phase;
  let along = 0;
  if (p >= TRAVEL_END) along = 1;
  else if (p > HOLD) along = (p - HOLD) / (TRAVEL_END - HOLD);
  const probed = sampleRadius(along * PLAY_END);
  liveTides.u = probed.u;
  liveTides.sr = probed.sr;
  liveTides.sp = probed.sp;
  liveTides.tauUnits = probed.tau;
  let fade = 1;
  if (p < 0.03) fade = p / 0.03;
  if (p > FADE_AT) fade = Math.min(fade, 1 - (p - FADE_AT) / (1 - FADE_AT));
  liveTides.fade = Math.max(0, fade);
}

export function tideMetrics(bodies) {
  if (!liveTides.enabled) return null;
  const hole = bodies.find((body) => body.kind === 'blackhole');
  if (!hole) return null;
  const massKg = hole.massKg;
  const rs = schwarzschildRadius(massKg);
  const radius = Math.max(liveTides.u * rs, rs * 1.001);
  const sgrMass = SGR_SOLAR * M_SUN;
  const sgrRs = schwarzschildRadius(sgrMass);
  const breakR = oneGeeRadius(massKg, PERSON_M);
  return {
    u: liveTides.u,
    sr: liveTides.sr,
    sp: liveTides.sp,
    releaseU: RELEASE_U,
    radial: radialAccel(massKg, radius, PERSON_M),
    transverse: -radialAccel(massKg, radius, PERSON_M) / 2,
    horizonRadial: radialAccel(massKg, rs, PERSON_M),
    sgrHorizon: radialAccel(sgrMass, sgrRs, PERSON_M),
    breakR,
    breakOverRs: breakR / rs,
    rs,
    massKg,
    tau: liveTides.tauUnits * rs / C,
    tauTotal: liveTides.tauTotal * rs / C,
  };
}

function headPoints(tipx, tipz, dx, dz, size) {
  const px = -dz;
  const pz = dx;
  const wing = size * 0.48;
  const bx = tipx - dx * size;
  const bz = tipz - dz * size;
  return [
    [bx + px * wing, bz + pz * wing],
    [tipx, tipz],
    [bx - px * wing, bz - pz * wing],
  ];
}

/**
 * Static tide marks, off to the side of the falling ring. y is filled in
 * by the world so the marks sit on the sheet. Radial arrows point apart
 * and are twice as long as the inward transverse arrows. Length ∝ 1/r³,
 * scaled so the inner arrow stops short of the horizon.
 */
export function buildRoses(cx, cz, rs) {
  const roseR = 0.2 * rs;
  const innerU = STATIONS[STATIONS.length - 1];
  const room = (innerU - 1.28) * rs - roseR;
  const lInner = Math.max(0.22, Math.min(room, rs * 0.85));
  const ring = [];
  const radial = [];
  const squeeze = [];
  const angle = FALL_ANGLE + Math.PI * 0.62;
  const rx = Math.cos(angle);
  const rz = Math.sin(angle);
  const tx = -rz;
  const tz = rx;
  for (let s = 0; s < STATIONS.length; s += 1) {
    const u = STATIONS[s];
    const ox = cx + rx * u * rs;
    const oz = cz + rz * u * rs;
    const reach = lInner * (innerU / u) ** 3;
    const circle = [];
    for (let i = 0; i <= 36; i += 1) {
      const a = (i / 36) * Math.PI * 2;
      circle.push([ox + Math.cos(a) * roseR, oz + Math.sin(a) * roseR]);
    }
    ring.push(circle);
    const radialLen = reach;
    const sideLen = reach * 0.5;
    const headR = Math.min(0.22 * rs, Math.max(0.06, radialLen * 0.32));
    const headS = Math.min(0.16 * rs, Math.max(0.05, sideLen * 0.4));
    radial.push([
      [ox + rx * roseR, oz + rz * roseR],
      [ox + rx * (roseR + radialLen), oz + rz * (roseR + radialLen)],
    ]);
    radial.push(headPoints(ox + rx * (roseR + radialLen), oz + rz * (roseR + radialLen), rx, rz, headR));
    radial.push([
      [ox - rx * roseR, oz - rz * roseR],
      [ox - rx * (roseR + radialLen), oz - rz * (roseR + radialLen)],
    ]);
    radial.push(headPoints(ox - rx * (roseR + radialLen), oz - rz * (roseR + radialLen), -rx, -rz, headR));
    squeeze.push([
      [ox + tx * (roseR + sideLen), oz + tz * (roseR + sideLen)],
      [ox + tx * roseR, oz + tz * roseR],
    ]);
    squeeze.push(headPoints(ox + tx * roseR, oz + tz * roseR, -tx, -tz, headS));
    squeeze.push([
      [ox - tx * (roseR + sideLen), oz - tz * (roseR + sideLen)],
      [ox - tx * roseR, oz - tz * roseR],
    ]);
    squeeze.push(headPoints(ox - tx * roseR, oz - tz * roseR, tx, tz, headS));
  }
  return { ring, radial, squeeze };
}
