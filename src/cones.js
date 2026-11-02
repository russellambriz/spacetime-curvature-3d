/**
 * Light cones of a Schwarzschild hole, in Painlevé–Gullstrand coordinates.
 * The grid is one moment. Up is later. Space falls inward at the river speed
 * β = √(rₛ/r), which is the Newtonian escape speed, and here it is exact.
 * Light still moves at c relative to that river, so the future cone shears:
 *   dr/dt = c (1 − β)   outward
 *   dr/dt = −c (1 + β)  inward
 * On the horizon β = 1 and the outward ray stands still. Inside, both rays
 * lose radius. Lengths below are in units of the horizon, and c = 1, so an
 * unsheared cone would open at 45°. sample at module load; the world scales
 * by the live horizon. The sheet height is not involved.
 */
export const CONE_RS = 1.72;

export const STATIONS = [
  {
    id: 'inside',
    name: 'Inside',
    ratio: 0.68,
    rise: 0.42,
    past: 0.3,
    note: 'Inside the horizon. The future cone does not contain a vertical line, so nothing can hover here, and nothing can climb out.',
  },
  {
    id: 'horizon',
    name: 'Horizon',
    ratio: 1,
    rise: 0.5,
    past: 0.34,
    note: 'The event horizon. The outward edge stands vertical: light aimed straight out stays at this radius, as seen from far away.',
  },
  {
    id: 'photon',
    name: 'Photon sphere',
    ratio: 1.5,
    rise: 0.56,
    past: 0.36,
    note: '1.5 rₛ is the photon sphere, where light can circle. This cone is radial light, aimed straight out or straight in.',
  },
  {
    id: 'isco',
    name: 'Innermost orbit',
    ratio: 3,
    rise: 0.9,
    past: 0.5,
    note: '3 rₛ is the innermost stable circular orbit of a non-spinning hole. The cone here is still radial light, not that orbit.',
  },
  {
    id: 'outer',
    name: 'Outer',
    ratio: 4.6,
    rise: 0.84,
    past: 0.48,
    note: 'Still well short of 45°. An upright cone is the limit at infinity, not a few horizons out.',
  },
];

const PHI = 24;
const ROWS = 8;
const MERIDIANS = 12;

const RAYS = [
  { id: 'in', kind: 'in', ratio0: 2.25, tauMax: 1.28, uMin: 0.28, uMax: 6, color: [0.72, 1.42, 1.12], photons: 3 },
  { id: 'out', kind: 'out', ratio0: 1.9, tauMax: 1.15, uMin: 0.3, uMax: 5.4, color: [0.42, 1.58, 0.78], photons: 2 },
  { id: 'crawl', kind: 'out', ratio0: 1.13, tauMax: 1.42, uMin: 0.3, uMax: 6, color: [1.62, 1.08, 0.32], photons: 2 },
  { id: 'trapped', kind: 'out', ratio0: 0.76, tauMax: 1.05, uMin: 0.26, uMax: 6, color: [1.7, 0.28, 0.92], photons: 2 },
  { id: 'fall', kind: 'rain', ratio0: 1.48, tauMax: 1.22, uMin: 0.32, uMax: 6, color: [1.78, 0.5, 0.12], photons: 2 },
  { id: 'freeze', kind: 'hover', ratio0: 1, tauMax: 1.36, uMin: 0.2, uMax: 6, color: [1.55, 0.78, 1.32], photons: 2 },
];

export const liveCones = {
  enabled: false,
  cx: 0,
  cz: 0,
  rs: CONE_RS,
  station: 1,
};

export function lightSlopes(ratio) {
  const beta = Math.sqrt(1 / ratio);
  return {
    beta,
    outgoing: 1 - beta,
    ingoing: -1 - beta,
    rain: -beta,
  };
}

function slopeOf(kind, u) {
  if (kind === 'hover') return 0;
  const beta = Math.sqrt(1 / Math.max(u, 1e-4));
  if (kind === 'out') return 1 - beta;
  if (kind === 'in') return -1 - beta;
  return -beta;
}

function integrate(spec) {
  const dTau = 0.008;
  const x = [spec.ratio0];
  const t = [0];
  let u = spec.ratio0;
  let tau = 0;
  for (let i = 0; i < 900 && tau < spec.tauMax - 1e-9; i += 1) {
    const s1 = slopeOf(spec.kind, u);
    const mid = spec.kind === 'hover' ? u : u + s1 * dTau * 0.5;
    const s2 = slopeOf(spec.kind, mid);
    u = spec.kind === 'hover' ? spec.ratio0 : u + s2 * dTau;
    tau += dTau;
    const stop = u < spec.uMin || u > spec.uMax;
    const clamped = Math.min(spec.uMax, Math.max(spec.uMin, u));
    if (i % 2 === 0 || stop || tau >= spec.tauMax - 1e-9) {
      x.push(clamped);
      t.push(Math.min(tau, spec.tauMax));
    }
    if (stop) break;
  }
  return {
    id: spec.id,
    color: spec.color,
    photons: spec.photons,
    x: Float64Array.from(x),
    t: Float64Array.from(t),
    count: x.length,
  };
}

export const CONE_PATHS = RAYS.map(integrate);

function tint(station, future, selected) {
  const horizon = Math.abs(station.ratio - 1) < 0.02;
  const inside = station.ratio < 0.98;
  let rgb;
  if (inside) rgb = [0.82, 0.18, 0.52];
  else if (horizon) rgb = [0.78, 0.48, 0.42];
  else rgb = [0.18, 0.66, 0.32];
  const dim = future ? 1 : 0.58;
  const hot = station === STATIONS[selected] ? 1.16 : 1;
  return [rgb[0] * dim * hot, rgb[1] * dim * hot, rgb[2] * dim * hot];
}

function conePoint(x0, beta, t, phi) {
  const rad = Math.abs(t);
  return [
    x0 - beta * t + rad * Math.cos(phi),
    t,
    rad * Math.sin(phi),
  ];
}

export function coneVertexCount() {
  return STATIONS.length * 2 * (ROWS + 1) * PHI;
}

export function coneTriangleCount() {
  return STATIONS.length * 2 * ROWS * PHI * 2;
}

function writeConeGrid(positions, normals, colors, indices, cursor, station, future, selected, rs) {
  const beta = Math.sqrt(1 / station.ratio);
  const x0 = station.ratio * rs;
  const sign = future ? 1 : -1;
  const height = (future ? station.rise : station.past) * rs * sign;
  const rgb = tint(station, future, selected);
  const base = cursor.vertex;
  const rows = ROWS + 1;
  for (let row = 0; row < rows; row += 1) {
    const s = row / ROWS;
    const t = height * s;
    for (let k = 0; k < PHI; k += 1) {
      const phi = (k / PHI) * Math.PI * 2;
      const p = conePoint(x0, beta, t, phi);
      const o = (base + row * PHI + k) * 3;
      positions[o] = p[0];
      positions[o + 1] = p[1];
      positions[o + 2] = p[2];
      colors[o] = rgb[0];
      colors[o + 1] = rgb[1];
      colors[o + 2] = rgb[2];
      normals[o] = 0;
      normals[o + 1] = 0;
      normals[o + 2] = 0;
    }
  }
  let tri = cursor.tri;
  for (let row = 0; row < ROWS; row += 1) {
    for (let k = 0; k < PHI; k += 1) {
      const k2 = (k + 1) % PHI;
      const a = base + row * PHI + k;
      const b = base + row * PHI + k2;
      const c = base + (row + 1) * PHI + k;
      const d = base + (row + 1) * PHI + k2;
      indices[tri] = a;
      indices[tri + 1] = c;
      indices[tri + 2] = b;
      indices[tri + 3] = b;
      indices[tri + 4] = c;
      indices[tri + 5] = d;
      tri += 6;
      addNormal(positions, normals, a, c, b);
      addNormal(positions, normals, b, c, d);
    }
  }
  const count = rows * PHI;
  for (let i = 0; i < count; i += 1) {
    const o = (base + i) * 3;
    const row = Math.floor(i / PHI);
    const k = i % PHI;
    const t = height * (row / ROWS);
    const axisX = x0 - beta * t;
    let nx = normals[o];
    let ny = normals[o + 1];
    let nz = normals[o + 2];
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-8) {
      const phi = (k / PHI) * Math.PI * 2;
      nx = Math.cos(phi);
      ny = 0;
      nz = Math.sin(phi);
    } else {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    const vx = positions[o] - axisX;
    const vz = positions[o + 2];
    if (nx * vx + nz * vz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    normals[o] = nx;
    normals[o + 1] = ny;
    normals[o + 2] = nz;
  }
  cursor.vertex += count;
  cursor.tri = tri;
}

function addNormal(positions, normals, i, j, k) {
  const ax = positions[i * 3];
  const ay = positions[i * 3 + 1];
  const az = positions[i * 3 + 2];
  const bx = positions[j * 3] - ax;
  const by = positions[j * 3 + 1] - ay;
  const bz = positions[j * 3 + 2] - az;
  const cx = positions[k * 3] - ax;
  const cy = positions[k * 3 + 1] - ay;
  const cz = positions[k * 3 + 2] - az;
  const nx = by * cz - bz * cy;
  const ny = bz * cx - bx * cz;
  const nz = bx * cy - by * cx;
  for (const v of [i, j, k]) {
    normals[v * 3] += nx;
    normals[v * 3 + 1] += ny;
    normals[v * 3 + 2] += nz;
  }
}

export function buildConeSurface(rs, selected) {
  const positions = new Float32Array(coneVertexCount() * 3);
  const normals = new Float32Array(coneVertexCount() * 3);
  const colors = new Float32Array(coneVertexCount() * 3);
  const indices = new Uint16Array(coneTriangleCount() * 3);
  const cursor = { vertex: 0, tri: 0 };
  for (let i = 0; i < STATIONS.length; i += 1) {
    writeConeGrid(positions, normals, colors, indices, cursor, STATIONS[i], true, selected, rs);
    writeConeGrid(positions, normals, colors, indices, cursor, STATIONS[i], false, selected, rs);
  }
  return { positions, normals, colors, indices };
}

function pushSeg(positions, colors, cursor, ax, ay, az, bx, by, bz, rgb, fadeA, fadeB) {
  const o = cursor.n * 3;
  positions[o] = ax;
  positions[o + 1] = ay;
  positions[o + 2] = az;
  positions[o + 3] = bx;
  positions[o + 4] = by;
  positions[o + 5] = bz;
  colors[o] = rgb[0] * fadeA;
  colors[o + 1] = rgb[1] * fadeA;
  colors[o + 2] = rgb[2] * fadeA;
  colors[o + 3] = rgb[0] * fadeB;
  colors[o + 4] = rgb[1] * fadeB;
  colors[o + 5] = rgb[2] * fadeB;
  cursor.n += 2;
}

export function coneWireVertexCount() {
  const meridians = STATIONS.length * 2 * MERIDIANS * ROWS;
  const rings = STATIONS.length * 2 * 2 * PHI;
  const horizon = 80;
  return (meridians + rings + horizon) * 2;
}

export function buildConeWires(rs, selected) {
  const count = coneWireVertexCount();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const cursor = { n: 0 };
  for (let s = 0; s < STATIONS.length; s += 1) {
    const station = STATIONS[s];
    const beta = Math.sqrt(1 / station.ratio);
    const x0 = station.ratio * rs;
    for (const future of [true, false]) {
      const rgb = tint(station, future, selected).map((c) => c * 1.45);
      const sign = future ? 1 : -1;
      const height = (future ? station.rise : station.past) * rs * sign;
      for (let m = 0; m < MERIDIANS; m += 1) {
        const phi = (m / MERIDIANS) * Math.PI * 2;
        for (let row = 0; row < ROWS; row += 1) {
          const t0 = height * (row / ROWS);
          const t1 = height * ((row + 1) / ROWS);
          const a = conePoint(x0, beta, t0, phi);
          const b = conePoint(x0, beta, t1, phi);
          const fade0 = future ? 0.35 + 0.65 * (row / ROWS) : 0.45;
          const fade1 = future ? 0.35 + 0.65 * ((row + 1) / ROWS) : 0.2;
          pushSeg(positions, colors, cursor, a[0], a[1], a[2], b[0], b[1], b[2], rgb, fade0, fade1);
        }
      }
      for (const frac of [0.55, 1]) {
        const t = height * frac;
        const fade = future ? 0.55 + 0.45 * frac : 0.28;
        for (let k = 0; k < PHI; k += 1) {
          const p0 = (k / PHI) * Math.PI * 2;
          const p1 = ((k + 1) / PHI) * Math.PI * 2;
          const a = conePoint(x0, beta, t, p0);
          const b = conePoint(x0, beta, t, p1);
          pushSeg(positions, colors, cursor, a[0], a[1], a[2], b[0], b[1], b[2], rgb, fade, fade);
        }
      }
    }
  }
  const ring = [1.45, 0.28, 0.95];
  const y = 0.045 * rs;
  const n = 80;
  for (let k = 0; k < n; k += 1) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    pushSeg(
      positions,
      colors,
      cursor,
      Math.cos(a0) * rs,
      y,
      Math.sin(a0) * rs,
      Math.cos(a1) * rs,
      y,
      Math.sin(a1) * rs,
      ring,
      1,
      1,
    );
  }
  return { positions, colors, count: cursor.n };
}

function spineColor(station, selected) {
  const inside = station.ratio < 0.98;
  const hot = station === STATIONS[selected] ? 1.35 : 1;
  if (inside) return [1.65 * hot, 0.32 * hot, 0.95 * hot];
  if (Math.abs(station.ratio - 1) < 0.02) return [1.55 * hot, 0.42 * hot, 1.15 * hot];
  return [0.72 * hot, 1.35 * hot, 0.86 * hot];
}

export function buildConeSpines(rs, selected) {
  const lines = [];
  for (let i = 0; i < STATIONS.length; i += 1) {
    const station = STATIONS[i];
    if (Math.abs(station.ratio - 1) < 0.02) continue;
    const x = station.ratio * rs;
    const top = station.rise * rs * (station.ratio < 0.98 ? 1.18 : 1);
    lines.push({
      id: `spine-${station.id}`,
      color: spineColor(station, selected),
      positions: new Float32Array([x, 0, 0, x, top, 0]),
    });
  }
  const top = 1.42 * rs;
  const bot = -STATIONS[1].past * rs;
  lines.push({
    id: 'horizon-line',
    color: [1.72, 0.34, 1.12],
    positions: new Float32Array([rs, bot, 0, rs, top, 0]),
  });
  return lines;
}

export function writePath(path, rs, positions, colors) {
  const n = path.count;
  const span = path.t[n - 1] || 1;
  for (let i = 0; i < n; i += 1) {
    positions[i * 3] = path.x[i] * rs;
    positions[i * 3 + 1] = path.t[i] * rs;
    positions[i * 3 + 2] = 0;
    const u = path.t[i] / span;
    let fade = 1;
    if (u < 0.05) fade = u / 0.05;
    if (u > 0.92) fade = Math.min(fade, (1 - u) / 0.08);
    fade = Math.max(0, fade);
    colors[i * 3] = path.color[0] * fade;
    colors[i * 3 + 1] = path.color[1] * fade;
    colors[i * 3 + 2] = path.color[2] * fade;
  }
  return n;
}

export function samplePath(path, tau) {
  const n = path.count;
  const span = path.t[n - 1];
  if (!(span > 0)) return null;
  let u = tau % span;
  if (u < 0) u += span;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.t[mid] <= u) lo = mid;
    else hi = mid;
  }
  const t0 = path.t[lo];
  const t1 = path.t[hi];
  const f = t1 > t0 ? (u - t0) / (t1 - t0) : 0;
  const edge = Math.min(u / span, 1 - u / span);
  const fade = Math.max(0, Math.min(1, edge / 0.06));
  return {
    x: path.x[lo] + (path.x[hi] - path.x[lo]) * f,
    y: u,
    fade,
  };
}

export function updateLiveCones(state) {
  if (!state.cones) {
    liveCones.enabled = false;
    return;
  }
  const hole = state.bodies.find((body) => body.kind === 'blackhole');
  if (!hole) {
    liveCones.enabled = false;
    return;
  }
  liveCones.enabled = true;
  liveCones.cx = hole.x;
  liveCones.cz = hole.z;
  liveCones.rs = Math.max(hole.displayHorizon, 0.08);
  let index = state.coneStation;
  if (!Number.isInteger(index) || index < 0 || index >= STATIONS.length) index = 1;
  state.coneStation = index;
  liveCones.station = index;
}

export function coneMetrics(bodies) {
  if (!liveCones.enabled) return null;
  const hole = bodies.find((body) => body.kind === 'blackhole');
  if (!hole) return null;
  const station = STATIONS[liveCones.station] ?? STATIONS[1];
  const ratio = station.ratio;
  const slopes = lightSlopes(ratio);
  return {
    station,
    ratio,
    slopes,
    tilt: Math.atan(slopes.outgoing),
    massKg: hole.massKg,
    name: hole.name,
  };
}

export function assertConePhysics() {
  const horizon = lightSlopes(1);
  if (Math.abs(horizon.outgoing) > 1e-9) throw new Error('outgoing light should stand still on the horizon');
  if (Math.abs(horizon.ingoing + 2) > 1e-9) throw new Error('ingoing light on the horizon should be −2c');
  if (!(lightSlopes(0.68).outgoing < 0)) throw new Error('outgoing light inside should fall inward');
  for (let i = 0; i < STATIONS.length; i += 1) {
    const ratio = STATIONS[i].ratio;
    const q = lightSlopes(ratio);
    if (!(q.ingoing < q.rain && q.rain < q.outgoing)) {
      throw new Error(`raindrop left the cone at ${ratio} rₛ`);
    }
  }
  const rs = 1;
  const beta = lightSlopes(1.5).beta;
  const t = 0.4;
  const phi = 0.7;
  const p = conePoint(1.5 * rs, beta, t, phi);
  const cx = 1.5 - beta * t;
  const err = (p[0] - cx) ** 2 + p[2] ** 2 - t * t;
  if (Math.abs(err) > 1e-8) throw new Error('sheared cone is not a null circle');
  for (let i = 0; i < CONE_PATHS.length; i += 1) {
    const path = CONE_PATHS[i];
    if (path.count < 2) throw new Error(`${path.id} is empty`);
    if (path.id === 'trapped' && !(path.x[path.count - 1] < path.x[0])) {
      throw new Error('trapped ray should lose radius');
    }
    if (path.id === 'crawl' && !(path.x[path.count - 1] > path.x[0])) {
      throw new Error('crawling ray should gain radius');
    }
    if (path.id === 'freeze' && Math.abs(path.x[path.count - 1] - 1) > 1e-6) {
      throw new Error('horizon ray should stay on the horizon');
    }
  }
  const surface = buildConeSurface(CONE_RS, 1);
  if (surface.positions.length !== coneVertexCount() * 3) {
    throw new Error('surface vertex count drifted');
  }
  const wires = buildConeWires(CONE_RS, 1);
  if (wires.count !== coneWireVertexCount()) {
    throw new Error(`wire count ${wires.count} != ${coneWireVertexCount()}`);
  }
  return {
    paths: CONE_PATHS.map((path) => ({
      id: path.id,
      count: path.count,
      from: path.x[0],
      to: path.x[path.count - 1],
      tau: path.t[path.count - 1],
    })),
  };
}
