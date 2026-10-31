/**
 * Embedding height of the sheet at a horizontal coordinate.
 * Stars and planets use a softened potential well. A black hole uses Flamm's
 * paraboloid (the isometric embedding of a Schwarzschild spatial slice),
 * continued below the horizon as a narrow throat.
 * The GW ripples preset adds sampleWave(), a quadrupole diagram locked to the orbit.
 * Frame dragging does not change this height. The sheet shader shears the grid
 * lines around a Kerr hole; that shear is a diagram, not more curvature.
 * The vertex shader in world.js must implement the same functions.
 * throatDepth 0 keeps the original shallow continuation (the lens preset).
 * A positive throatDepth, used by the black-hole preset, plunges inside the
 * horizon and narrows. THROAT_* is shared with that shader and the throat mesh.
 */
import { sampleWave } from './waves.js';

export const THROAT_NARROW = 1.7;
export const THROAT_SHAPE = 0.4;
export const THROAT_FADE_START = 0.04;
export const THROAT_FADE_END = 0.34;

export function flammHeight(r, rs, depthScale, throatDepth = 0) {
  const R0 = rs * 14;
  const mouth = rs * 1.03;
  const rOut = Math.max(r, mouth);
  const w = 2 * Math.sqrt(Math.max(rs * (rOut - rs), 0));
  const w0 = 2 * Math.sqrt(Math.max(rs * (R0 - rs), 0));
  let h = (w - w0) * depthScale;
  if (r < mouth) {
    if (!(throatDepth > 0)) {
      const t = (mouth - r) / Math.max(rs, 1e-4);
      h -= w0 * depthScale * (t * 0.55 + t * t * 0.35);
    } else {
      const u = Math.max(0, Math.min(1, (mouth - r) / mouth));
      h -= throatDepth * (u + THROAT_SHAPE * u * u);
    }
  }
  return h;
}

export function contribution(x, z, body) {
  const dx = x - body.x;
  const dz = z - body.z;
  const r = Math.hypot(dx, dz);
  if (body.kind === 'blackhole') {
    const rs = Math.max(body.displayHorizon, 1e-3);
    return flammHeight(r, rs, body.visualStrength || 1, body.throatDepth || 0);
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
