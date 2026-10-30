import { M_EARTH, R_EARTH, MAX_BODIES, schwarzschildRadius } from './constants.js';
import { getPreset } from './presets.js';
import { updateLiveLens } from './lens.js';
import { updateLiveWave } from './waves.js';

const GRAVITY_SOFT = 0.55;
const GRAVITY_SOFT2 = GRAVITY_SOFT * GRAVITY_SOFT;
const MAX_SPEED = 90;
const FIXED_DT = 1 / 120;
const MAX_STEPS = 24;

const ADDED_LOOKS = [
  { style: 'earth', glow: '#8ec8ff', trail: [0.55, 0.85, 1.4] },
  { style: 'mars', glow: '#ff8d6a', trail: [1.45, 0.42, 0.16] },
  { style: 'mercury', glow: '#e6d3ae', trail: [0.95, 0.8, 0.5] },
  { style: 'venus', glow: '#ffe1a6', trail: [1.2, 0.85, 0.4] },
];

let nextId = 1;

function makeId() {
  nextId += 1;
  return `b${nextId}`;
}

export function createBody(spec) {
  const massKg = spec.massKg;
  return {
    id: spec.id ?? makeId(),
    name: spec.name,
    kind: spec.kind ?? 'planet',
    massKg,
    baseMassKg: spec.baseMassKg ?? massKg,
    radiusM: spec.radiusM,
    baseRadiusM: spec.baseRadiusM ?? spec.radiusM,
    simMass: spec.simMass,
    baseSimMass: spec.baseSimMass ?? spec.simMass,
    visualStrength: spec.visualStrength,
    baseVisual: spec.baseVisual ?? spec.visualStrength,
    softening: spec.softening,
    baseSoftening: spec.baseSoftening ?? spec.softening,
    radius: spec.radius,
    baseRadius: spec.baseRadius ?? spec.radius,
    displayHorizon: spec.displayHorizon ?? 0,
    baseHorizon: spec.baseHorizon ?? spec.displayHorizon ?? 0,
    x: spec.x,
    z: spec.z,
    vx: spec.vx ?? 0,
    vz: spec.vz ?? 0,
    ax: 0,
    az: 0,
    spin: 0,
    spinRate: spec.spin ?? 0.2,
    tilt: spec.tilt ?? 0,
    trail: spec.trail !== false,
    trailWidth: spec.trailWidth ?? 0.1,
    trailColor: spec.trailColor ?? [1.4, 0.4, 0.1],
    style: spec.style ?? 'generic',
    core: spec.core ?? [1, 1, 1],
    limb: spec.limb ?? [1, 0.5, 0.2],
    albedo: spec.albedo ?? [0.45, 0.62, 0.95],
    atmosphere: spec.atmosphere ?? [0.45, 0.7, 1],
    glow: spec.glow ?? '#9ad7ff',
    glowScale: spec.glowScale ?? 2,
    added: spec.added ?? false,
  };
}

export function createState(presetId = 'sun-earth') {
  return {
    presetId,
    bodies: [],
    metersPerUnit: 1,
    camera: { position: [18, 12, 20], target: [0, -2, 0] },
    timeScale: 1,
    paused: false,
    showTrails: true,
    selectedId: null,
    addedCount: 0,
    accumulator: 0,
    tagline: '',
    wave: null,
    lens: false,
  };
}

export function loadPreset(state, presetId) {
  const preset = getPreset(presetId);
  state.presetId = preset.id;
  state.metersPerUnit = preset.metersPerUnit;
  state.camera = {
    position: [...preset.camera.position],
    target: [...preset.camera.target],
  };
  state.tagline = preset.tagline;
  state.wave = preset.wave
    ? { amp: preset.wave.amp, k: preset.wave.k, inner: preset.wave.inner }
    : null;
  state.lens = Boolean(preset.lens);
  state.bodies = preset.bodies.map((spec) => createBody(spec));
  state.addedCount = 0;
  state.accumulator = 0;
  const selected = state.bodies.find((body) => body.name === preset.select) ?? state.bodies[0];
  state.selectedId = selected.id;
  computeAccelerations(state.bodies);
  updateLiveWave(state);
  updateLiveLens(state);
  return state;
}

export function selectedBody(state) {
  return state.bodies.find((body) => body.id === state.selectedId) ?? state.bodies[0] ?? null;
}

export function applyMass(body, massKg) {
  const ratio = massKg / body.baseMassKg;
  body.massKg = massKg;
  body.simMass = body.baseSimMass * ratio;
  if (body.kind === 'blackhole') {
    body.displayHorizon = Math.max(0.08, body.baseHorizon * ratio);
    body.radius = body.displayHorizon * 0.92;
    body.radiusM = schwarzschildRadius(massKg);
    body.visualStrength = body.baseVisual;
    body.softening = 1;
    return;
  }
  const visualRatio = ratio ** 0.55;
  body.visualStrength = clamp(body.baseVisual * visualRatio, 0.12, 64);
  body.radius = body.baseRadius * ratio ** 0.33;
  body.radiusM = body.baseRadiusM * Math.cbrt(ratio);
  body.softening = Math.max(0.18, body.baseSoftening * (body.radius / body.baseRadius));
}

export function massRatio(body) {
  return body.massKg / body.baseMassKg;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function computeAccelerations(bodies) {
  for (let i = 0; i < bodies.length; i += 1) {
    bodies[i].ax = 0;
    bodies[i].az = 0;
  }
  for (let i = 0; i < bodies.length; i += 1) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j += 1) {
      const b = bodies[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const r2 = dx * dx + dz * dz + GRAVITY_SOFT2;
      const inv = 1 / (r2 * Math.sqrt(r2));
      const ax = dx * inv;
      const az = dz * inv;
      a.ax += b.simMass * ax;
      a.az += b.simMass * az;
      b.ax -= a.simMass * ax;
      b.az -= a.simMass * az;
    }
  }
}

function limitSpeed(body) {
  const speed = Math.hypot(body.vx, body.vz);
  if (speed > MAX_SPEED) {
    const scale = MAX_SPEED / speed;
    body.vx *= scale;
    body.vz *= scale;
  }
}

export function verlet(bodies, dt, draggedId) {
  for (let i = 0; i < bodies.length; i += 1) {
    const body = bodies[i];
    if (body.id === draggedId) continue;
    body.vx += body.ax * dt * 0.5;
    body.vz += body.az * dt * 0.5;
    body.x += body.vx * dt;
    body.z += body.vz * dt;
    limitSpeed(body);
  }
  computeAccelerations(bodies);
  for (let i = 0; i < bodies.length; i += 1) {
    const body = bodies[i];
    if (body.id === draggedId) continue;
    body.vx += body.ax * dt * 0.5;
    body.vz += body.az * dt * 0.5;
    limitSpeed(body);
  }
}

export function advance(state, frameDt, draggedId) {
  if (state.paused || state.timeScale <= 0) return;
  state.accumulator += Math.min(frameDt, 0.05) * state.timeScale;
  let steps = 0;
  while (state.accumulator >= FIXED_DT && steps < MAX_STEPS) {
    verlet(state.bodies, FIXED_DT, draggedId);
    state.accumulator -= FIXED_DT;
    steps += 1;
  }
  if (steps >= MAX_STEPS) state.accumulator = 0;
}

export function heaviest(bodies) {
  let best = bodies[0];
  for (let i = 1; i < bodies.length; i += 1) {
    if (bodies[i].massKg > best.massKg) best = bodies[i];
  }
  return best;
}

export function addBody(state, x, z) {
  if (state.bodies.length >= MAX_BODIES) {
    return { ok: false, reason: 'The sheet is holding twelve masses.' };
  }
  const primary = heaviest(state.bodies);
  const dx = x - primary.x;
  const dz = z - primary.z;
  const r = Math.hypot(dx, dz);
  const minR = primary.radius + 1.35;
  if (r < minR) {
    return { ok: false, reason: 'That spot is inside another mass.' };
  }
  const look = ADDED_LOOKS[state.addedCount % ADDED_LOOKS.length];
  state.addedCount += 1;
  const massKg = M_EARTH;
  const simMass = primary.simMass * (massKg / primary.massKg);
  const speed = Math.sqrt(primary.simMass / r);
  const body = createBody({
    name: `Mass ${state.addedCount}`,
    kind: 'planet',
    massKg,
    radiusM: R_EARTH,
    simMass,
    visualStrength: 1.55,
    softening: 0.4,
    radius: 0.36,
    style: look.style,
    glow: look.glow,
    glowScale: 1.8,
    trail: true,
    trailWidth: 0.11,
    trailColor: look.trail,
    albedo: [0.42, 0.62, 0.9],
    added: true,
    x,
    z,
    vx: (-dz / r) * speed,
    vz: (dx / r) * speed,
  });
  state.bodies.push(body);
  state.selectedId = body.id;
  computeAccelerations(state.bodies);
  return { ok: true, body };
}

export function removeBody(state, id) {
  if (state.bodies.length <= 1) {
    return { ok: false, reason: 'Leave at least one mass on the sheet.' };
  }
  const index = state.bodies.findIndex((body) => body.id === id);
  if (index < 0) return { ok: false, reason: '' };
  state.bodies.splice(index, 1);
  if (state.selectedId === id) {
    state.selectedId = state.bodies[Math.max(0, index - 1)].id;
  }
  computeAccelerations(state.bodies);
  return { ok: true };
}

export function setDraggedPosition(body, x, z, dt) {
  const safeDt = Math.max(dt, 1 / 240);
  const vx = (x - body.x) / safeDt;
  const vz = (z - body.z) / safeDt;
  body.x = x;
  body.z = z;
  const speed = Math.hypot(vx, vz);
  if (speed > MAX_SPEED) {
    body.vx = (vx / speed) * MAX_SPEED;
    body.vz = (vz / speed) * MAX_SPEED;
  } else {
    body.vx = vx;
    body.vz = vz;
  }
  body.ax = 0;
  body.az = 0;
}
