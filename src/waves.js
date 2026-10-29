/**
 * Quadrupole wave drawn into the sheet for the GW ripples preset.
 * The height is a diagram of the outgoing wave, phase-locked to the orbit:
 * the pattern repeats twice per revolution and crests move outward.
 * sampleWave() must match the sampleWave() in the sheet vertex shader.
 */
import { C, G } from './constants.js';

export const WAVE_OBSERVER_MPC = 40;
const MPC_METERS = 3.0856775814913673e22;

export const liveWave = {
  enabled: false,
  cx: 0,
  cz: 0,
  angle: 0,
  amp: 0,
  k: 0.4,
  inner: 1,
};

function pair(bodies) {
  if (!bodies || bodies.length < 2) return null;
  let first = bodies[0];
  let second = bodies[1];
  if (second.simMass > first.simMass) {
    first = bodies[1];
    second = bodies[0];
  }
  for (let i = 2; i < bodies.length; i += 1) {
    const body = bodies[i];
    if (body.simMass > first.simMass) {
      second = first;
      first = body;
    } else if (body.simMass > second.simMass) {
      second = body;
    }
  }
  return [first, second];
}

export function updateLiveWave(state) {
  const cfg = state.wave;
  const sources = cfg ? pair(state.bodies) : null;
  if (!sources) {
    liveWave.enabled = false;
    return;
  }
  const [a, b] = sources;
  const mass = a.simMass + b.simMass;
  if (!(mass > 0)) {
    liveWave.enabled = false;
    return;
  }
  liveWave.enabled = true;
  liveWave.cx = (a.x * a.simMass + b.x * b.simMass) / mass;
  liveWave.cz = (a.z * a.simMass + b.z * b.simMass) / mass;
  liveWave.angle = Math.atan2(a.z - liveWave.cz, a.x - liveWave.cx);
  liveWave.amp = cfg.amp;
  liveWave.k = cfg.k;
  liveWave.inner = cfg.inner;
}

export function sampleWave(x, z) {
  if (!liveWave.enabled) return 0;
  const dx = x - liveWave.cx;
  const dz = z - liveWave.cz;
  const r = Math.hypot(dx, dz);
  const inner = liveWave.inner;
  if (r <= inner) return 0;
  const span = inner * 1.35;
  const t = Math.min(1, (r - inner) / span);
  const env = t * t * (3 - 2 * t);
  const psi = Math.atan2(dz, dx);
  const pattern = Math.cos(2 * (psi - liveWave.angle) + liveWave.k * r);
  const fall = liveWave.amp * (inner / r) ** 0.75;
  return env * fall * pattern;
}

export function waveMetrics(bodies, metersPerUnit) {
  if (!liveWave.enabled) return null;
  const sources = pair(bodies);
  if (!sources) return null;
  const [a, b] = sources;
  const separation = Math.hypot(a.x - b.x, a.z - b.z) * metersPerUnit;
  if (!(separation > 1)) return null;
  const total = a.massKg + b.massKg;
  if (!(total > 0) || !(a.massKg > 0) || !(b.massKg > 0)) return null;
  const fOrb = (1 / (2 * Math.PI)) * Math.sqrt((G * total) / separation ** 3);
  const fGw = 2 * fOrb;
  if (!Number.isFinite(fGw) || fGw <= 0) return null;
  const chirp = (a.massKg * b.massKg) ** 0.6 / total ** 0.2;
  const distance = WAVE_OBSERVER_MPC * MPC_METERS;
  const h = (4 / distance)
    * ((G * chirp) / (C * C)) ** (5 / 3)
    * ((Math.PI * fGw) / C) ** (2 / 3);
  const tau = (5 / 256) * (C ** 5) * (separation ** 4) / (G ** 3 * a.massKg * b.massKg * total);
  if (!Number.isFinite(h) || !Number.isFinite(tau)) return null;
  return {
    fGw,
    fOrb,
    lambda: C / fGw,
    chirp,
    h,
    tau,
    separation,
    distance,
    nameA: a.name,
    nameB: b.name,
  };
}
