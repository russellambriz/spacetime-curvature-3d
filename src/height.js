/**
 * Embedding height of the sheet at a horizontal coordinate.
 * Stars and planets use a softened potential well. A black hole uses Flamm's
 * paraboloid (the isometric embedding of a Schwarzschild spatial slice),
 * continued below the horizon as a narrow throat.
 * The GW ripples preset adds sampleWave(), a quadrupole diagram locked to the orbit.
 * The vertex shader in world.js must implement the same functions.
 */
import { sampleWave } from './waves.js';

export function flammHeight(r, rs, depthScale) {
  const R0 = rs * 14;
  const mouth = rs * 1.03;
  const rOut = Math.max(r, mouth);
  const w = 2 * Math.sqrt(rs * (rOut - rs));
  const w0 = 2 * Math.sqrt(rs * (R0 - rs));
  let h = (w - w0) * depthScale;
  if (r < mouth) {
    const t = (mouth - r) / rs;
    h -= w0 * depthScale * (t * 0.55 + t * t * 0.35);
  }
  return h;
}

export function contribution(x, z, body) {
  const dx = x - body.x;
  const dz = z - body.z;
  const r = Math.hypot(dx, dz);
  if (body.kind === 'blackhole') {
    const rs = Math.max(body.displayHorizon, 1e-3);
    return flammHeight(r, rs, body.visualStrength || 1);
  }
  const eps = Math.max(body.softening, 1e-3);
  return -body.visualStrength / Math.sqrt(r * r + eps * eps);
}

export function heightAt(x, z, bodies, skipId = null) {
  let h = 0;
  for (let i = 0; i < bodies.length; i += 1) {
    if (skipId !== null && bodies[i].id === skipId) continue;
    h += contribution(x, z, bodies[i]);
  }
  return h + sampleWave(x, z);
}
