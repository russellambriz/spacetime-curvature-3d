/**
 * A Morris–Thorne wormhole: the simplest traversable tunnel.
 * Redshift function Φ = 0, so clocks agree everywhere and light is not shifted.
 * Shape b(r) = b₀²/r, so the circumferential radius is r = √(b₀² + l²).
 * The equatorial slice embeds isometrically as a catenoid,
 * z = b₀ arcsinh(l/b₀). The throat is the waist. It flares outward,
 * and Einstein's equation then requires a negative energy density.
 * Lengths in the mesh are r/b₀. The panel converts with the real throat.
 * WORM_STRETCH lengthens the drawing along the tunnel so both mouths fit.
 * Radii are not stretched. The ship moves at constant proper speed.
 */
import { AU, C, G } from './constants.js';

/** Screen throat radius at the slider's neutral setting. */
export const WORM_B0 = 2.2;
/** Mouths sit at ± this many throat radii of proper distance. */
export const WORM_L = 2;
/** Drawing-only stretch along the tunnel. The panel names this factor. */
export const WORM_STRETCH = 2.4;
/** Ship speed as a fraction of c. The crossing time in the panel uses it. */
export const WORM_BETA = 0.2;
/** Meridian the ship follows, toward the camera's side of the throat. */
export const WORM_PHI = 1.12;
const HOLD = 0.18;
const LOOP_SECONDS = 16;
const NUCLEAR_DENSITY = 2.3e17;

export const liveWorm = {
  enabled: false,
  b0: WORM_B0,
  throatM: AU,
  cx: 0,
  cz: 0,
  phase: 0.23,
  s: 0.6,
};

export function circumferential(s) {
  return Math.sqrt(1 + s * s);
}

/** Isometric embedding height, in units of b₀. The mesh multiplies by WORM_STRETCH. */
export function embedHeight(s) {
  return Math.asinh(s);
}

export function embedLocal(s, phi) {
  const r = circumferential(s);
  const y = WORM_STRETCH * embedHeight(s);
  return {
    x: r * Math.cos(phi),
    y,
    z: r * Math.sin(phi),
  };
}

/** A point lifted off the sheet, radially outward, so a bead clears the lines. */
export function embedLifted(s, phi, lift) {
  const r = circumferential(s);
  const dr = s / r;
  const dy = WORM_STRETCH / r;
  const len = Math.hypot(dr, dy) || 1;
  const nr = dy / len;
  const ny = -dr / len;
  const p = embedLocal(s, phi);
  return {
    x: p.x + nr * lift * Math.cos(phi),
    y: p.y + ny * lift,
    z: p.z + nr * lift * Math.sin(phi),
  };
}

/** ρ at radius r for shape b = b₀²/r and Φ = 0. Negative wherever the tunnel flares. */
export function energyDensity(b0Meters, rMeters) {
  return -(C * C * b0Meters * b0Meters) / (8 * Math.PI * G * rMeters ** 4);
}

export function throatDensity(b0Meters) {
  return energyDensity(b0Meters, b0Meters);
}

/** d²r/dl² at the throat. Positive means the tunnel opens instead of pinching. */
export function flareAtThroat(b0Meters) {
  return 1 / b0Meters;
}

export function shipCoordinate(phase) {
  const p = ((phase % 1) + 1) % 1;
  const descending = p < 0.5;
  const leg = descending ? p * 2 : (p - 0.5) * 2;
  let u = 0;
  if (leg > HOLD) u = (leg - HOLD) / (1 - HOLD);
  const from = descending ? WORM_L : -WORM_L;
  return from + (-from - from) * u;
}

/** Trail behind the ship, in units of b₀. Zero length while it waits at a mouth. */
export function cometSpan(phase) {
  const p = ((phase % 1) + 1) % 1;
  const s = shipCoordinate(p);
  const descending = p < 0.5;
  const leg = descending ? p * 2 : (p - 0.5) * 2;
  if (leg <= HOLD) return { s, tail: s };
  const reach = 1.2;
  const tail = descending ? Math.min(WORM_L, s + reach) : Math.max(-WORM_L, s - reach);
  return { s, tail };
}

export function buildWormMesh() {
  const segL = 160;
  const segP = 104;
  const nL = segL + 1;
  const nP = segP + 1;
  const positions = new Float32Array(nL * nP * 3);
  const coord = new Float32Array(nL * nP * 2);
  let v = 0;
  for (let i = 0; i <= segL; i += 1) {
    const s = -WORM_L + (2 * WORM_L * i) / segL;
    for (let j = 0; j <= segP; j += 1) {
      const phi = (Math.PI * 2 * j) / segP;
      const p = embedLocal(s, phi);
      positions[v * 3] = p.x;
      positions[v * 3 + 1] = p.y;
      positions[v * 3 + 2] = p.z;
      coord[v * 2] = s;
      coord[v * 2 + 1] = phi;
      v += 1;
    }
  }
  const indices = new Uint32Array(segL * segP * 6);
  let t = 0;
  for (let i = 0; i < segL; i += 1) {
    for (let j = 0; j < segP; j += 1) {
      const a = i * nP + j;
      const b = a + nP;
      const c = a + 1;
      const d = b + 1;
      indices[t] = a;
      indices[t + 1] = b;
      indices[t + 2] = c;
      indices[t + 3] = c;
      indices[t + 4] = b;
      indices[t + 5] = d;
      t += 6;
    }
  }
  return { positions, coord, indices };
}

export function throatRing(count = 160) {
  const positions = new Float32Array(count * 3);
  const radius = 1.045;
  for (let i = 0; i < count; i += 1) {
    const phi = (i / (count - 1)) * Math.PI * 2;
    positions[i * 3] = radius * Math.cos(phi);
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = radius * Math.sin(phi);
  }
  return positions;
}

function checkWorm() {
  const expectRho = -(C * C) / (8 * Math.PI * G * AU * AU);
  const rho = throatDensity(AU);
  if (!(rho < 0)) throw new Error('the throat density must be negative');
  if (Math.abs(rho - expectRho) > 1e-6 * Math.abs(expectRho)) {
    throw new Error(`throat density ${rho} != ${expectRho}`);
  }
  if (!(Math.abs(rho) > 2000 && Math.abs(rho) < 2800)) {
    throw new Error(`an AU throat should be rock-like, got ${rho}`);
  }
  if (Math.abs(energyDensity(AU, AU) - throatDensity(AU)) > 1) {
    throw new Error('density at r = b₀ should match the throat formula');
  }
  const b0 = 2500;
  const h = b0 * 1e-3;
  const rad = (l) => Math.sqrt(b0 * b0 + l * l);
  const second = (rad(h) - 2 * rad(0) + rad(-h)) / (h * h);
  if (Math.abs(second - flareAtThroat(b0)) > 1e-8) {
    throw new Error(`flare-out ${second} != ${flareAtThroat(b0)}`);
  }
  for (const s of [0, 0.4, 1.2, WORM_L]) {
    const drdl = s / Math.sqrt(1 + s * s);
    const dzdl = 1 / Math.sqrt(1 + s * s);
    const sum = drdl * drdl + dzdl * dzdl;
    if (Math.abs(sum - 1) > 1e-12) throw new Error(`embedding slipped at ${s}`);
  }
  const mouth = embedLocal(WORM_L, 0);
  if (Math.abs(mouth.x - Math.sqrt(1 + WORM_L * WORM_L)) > 1e-9) {
    throw new Error('mouth radius lost');
  }
  if (Math.abs(shipCoordinate(0) - WORM_L) > 1e-9) throw new Error('ship should start at the upper mouth');
  if (Math.abs(shipCoordinate(0.09) - WORM_L) > 1e-9) throw new Error('ship should wait at the mouth');
  if (Math.abs(shipCoordinate(0.5) + WORM_L) > 1e-9) throw new Error('ship should arrive at the lower mouth');
  let prev = shipCoordinate(0.12);
  for (let i = 1; i <= 24; i += 1) {
    const s = shipCoordinate(0.12 + (0.48 - 0.12) * (i / 24));
    if (!(s < prev - 1e-4)) throw new Error('ship should move at constant proper speed');
    prev = s;
  }
  const span = cometSpan(0.23);
  if (!(span.tail > span.s && span.tail <= WORM_L)) throw new Error('trail should sit behind the ship');
  const crossing = (2 * WORM_L * AU) / (WORM_BETA * C);
  const hours = crossing / 3600;
  if (Math.abs(hours - 2.772) > 0.002) throw new Error(`crossing time drifted: ${hours} h`);
  if (!(Math.abs(throatDensity(1)) / NUCLEAR_DENSITY > 1e8)) {
    throw new Error('a one-meter throat should be far past nuclear density');
  }
}

checkWorm();

export function resetLiveWorm() {
  liveWorm.phase = 0.23;
  liveWorm.s = shipCoordinate(liveWorm.phase);
}

export function updateLiveWorm(state, dt) {
  const throat = state.wormhole ? state.bodies.find((body) => body.kind === 'wormhole') : null;
  if (!throat) {
    liveWorm.enabled = false;
    return;
  }
  liveWorm.enabled = true;
  liveWorm.b0 = Math.max(throat.radius, 0.25);
  liveWorm.throatM = throat.radiusM;
  liveWorm.cx = throat.x;
  liveWorm.cz = throat.z;
  if (!state.paused && state.timeScale > 0 && dt > 0) {
    liveWorm.phase = (liveWorm.phase + (dt * state.timeScale) / LOOP_SECONDS) % 1;
  }
  liveWorm.s = shipCoordinate(liveWorm.phase);
}

export function wormMetrics(bodies) {
  if (!liveWorm.enabled) return null;
  const throat = bodies.find((body) => body.kind === 'wormhole');
  if (!throat) return null;
  const b0 = throat.radiusM;
  if (!(b0 > 0)) return null;
  const s = liveWorm.s;
  return {
    b0,
    lengthM: 2 * WORM_L * b0,
    density: throatDensity(b0),
    nuclearRatio: Math.abs(throatDensity(1)) / NUCLEAR_DENSITY,
    crossing: (2 * WORM_L * b0) / (WORM_BETA * C),
    beta: WORM_BETA,
    stretch: WORM_STRETCH,
    lMax: WORM_L,
    lOverB0: s,
    shipR: b0 * circumferential(s),
    flare: flareAtThroat(b0),
    redshift: 1,
  };
}
