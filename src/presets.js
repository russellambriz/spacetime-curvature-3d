import {
  AU,
  M_EARTH,
  M_MARS,
  M_MERCURY,
  M_SUN,
  M_VENUS,
  R_EARTH,
  R_MARS,
  R_MERCURY,
  R_SUN,
  R_VENUS,
  schwarzschildRadius,
} from './constants.js';

function orbit(distance, angle, centralMass) {
  const x = Math.cos(angle) * distance;
  const z = Math.sin(angle) * distance;
  const speed = Math.sqrt(centralMass / distance);
  return {
    x,
    z,
    vx: -Math.sin(angle) * speed,
    vz: Math.cos(angle) * speed,
  };
}

const SUN_EARTH_R = 15;
const SUN_EARTH_M = 275;

const INNER_EARTH_R = 11;
const INNER_SUN_M = 130;

const BH_ORBIT = 15;
const BH_RS_FACTOR = 7;
const BH_SOLAR = 4.3e6;
const BH_HORIZON = BH_ORBIT / BH_RS_FACTOR;
const BH_MASS = BH_SOLAR * M_SUN;
const BH_SIM = 520;

const BINARY_A = 9;
const BINARY_M1 = 88.2;
const BINARY_M2 = 58.8;
const BINARY_SEP_AU = 0.4;

function binaryPair(m1, m2, separation) {
  const total = m1 + m2;
  const r1 = (separation * m2) / total;
  const r2 = (separation * m1) / total;
  const omega = Math.sqrt(total / separation ** 3);
  return {
    a: { x: r1, z: 0, vx: 0, vz: omega * r1 },
    b: { x: -r2, z: 0, vx: 0, vz: -omega * r2 },
  };
}

const binary = binaryPair(BINARY_M1, BINARY_M2, BINARY_A);

const planet = (partial) => ({
  kind: 'planet',
  trail: true,
  trailWidth: 0.09,
  spin: 0.35,
  ...partial,
});

export const PRESETS = [
  {
    id: 'sun-earth',
    name: 'Sun + Earth',
    tagline: 'A star and a planet on a shared curved sheet.',
    metersPerUnit: AU / SUN_EARTH_R,
    camera: { position: [14, 19, 32], target: [1.5, -4.5, 5] },
    select: 'Earth',
    bodies: [
      {
        name: 'Sun',
        kind: 'star',
        massKg: M_SUN,
        radiusM: R_SUN,
        simMass: SUN_EARTH_M,
        visualStrength: 17.5,
        softening: 1.48,
        radius: 1.32,
        spin: 0.08,
        trail: false,
        style: 'sun',
        core: [1.35, 1.05, 0.72],
        limb: [1.15, 0.38, 0.05],
        glow: '#ffb15a',
        glowScale: 7.2,
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
      },
      planet({
        name: 'Earth',
        massKg: M_EARTH,
        radiusM: R_EARTH,
        simMass: SUN_EARTH_M * (M_EARTH / M_SUN),
        visualStrength: 2.8,
        softening: 0.55,
        radius: 0.64,
        spin: 0.7,
        tilt: 0.41,
        style: 'earth',
        glow: '#7ec8ff',
        glowScale: 2.6,
        trailColor: [1.7, 0.34, 0.06],
        trailWidth: 0.22,
        ...orbit(SUN_EARTH_R, 1.15, SUN_EARTH_M),
      }),
    ],
  },
  {
    id: 'inner',
    name: 'Inner planets',
    tagline: 'Mercury, Venus, Earth, and Mars in one solar well.',
    metersPerUnit: AU / INNER_EARTH_R,
    camera: { position: [8, 24, 38], target: [0, -3.2, 0] },
    select: 'Earth',
    bodies: [
      {
        name: 'Sun',
        kind: 'star',
        massKg: M_SUN,
        radiusM: R_SUN,
        simMass: INNER_SUN_M,
        visualStrength: 16.5,
        softening: 1.42,
        radius: 1.22,
        spin: 0.08,
        trail: false,
        style: 'sun',
        core: [1.35, 1.05, 0.72],
        limb: [1.15, 0.38, 0.05],
        glow: '#ffb15a',
        glowScale: 6.6,
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
      },
      planet({
        name: 'Mercury',
        massKg: M_MERCURY,
        radiusM: R_MERCURY,
        simMass: INNER_SUN_M * (M_MERCURY / M_SUN),
        visualStrength: 0.85,
        softening: 0.32,
        radius: 0.34,
        style: 'mercury',
        glow: '#d9c7a4',
        glowScale: 1.15,
        trailColor: [0.85, 0.72, 0.48],
        trailWidth: 0.07,
        ...orbit(INNER_EARTH_R * 0.387098, 0.35, INNER_SUN_M),
      }),
      planet({
        name: 'Venus',
        massKg: M_VENUS,
        radiusM: R_VENUS,
        simMass: INNER_SUN_M * (M_VENUS / M_SUN),
        visualStrength: 1.25,
        softening: 0.38,
        radius: 0.5,
        style: 'venus',
        glow: '#ffe2a8',
        glowScale: 1.7,
        trailColor: [1.05, 0.82, 0.42],
        trailWidth: 0.08,
        ...orbit(INNER_EARTH_R * 0.723332, 2.15, INNER_SUN_M),
      }),
      planet({
        name: 'Earth',
        massKg: M_EARTH,
        radiusM: R_EARTH,
        simMass: INNER_SUN_M * (M_EARTH / M_SUN),
        visualStrength: 1.45,
        softening: 0.42,
        radius: 0.52,
        spin: 0.7,
        tilt: 0.41,
        style: 'earth',
        glow: '#7ec8ff',
        glowScale: 2.2,
        trailColor: [1.7, 0.34, 0.06],
        trailWidth: 0.18,
        ...orbit(INNER_EARTH_R, 4.05, INNER_SUN_M),
      }),
      planet({
        name: 'Mars',
        massKg: M_MARS,
        radiusM: R_MARS,
        simMass: INNER_SUN_M * (M_MARS / M_SUN),
        visualStrength: 1.05,
        softening: 0.34,
        radius: 0.4,
        style: 'mars',
        glow: '#ff8a62',
        glowScale: 1.45,
        trailColor: [1.2, 0.42, 0.22],
        trailWidth: 0.08,
        ...orbit(INNER_EARTH_R * 1.523679, 1.15, INNER_SUN_M),
      }),
    ],
  },
  {
    id: 'blackhole',
    name: 'Black hole',
    tagline: 'A supermassive horizon. The star orbits at seven Schwarzschild radii.',
    metersPerUnit: schwarzschildRadius(BH_MASS) / BH_HORIZON,
    camera: { position: [16, 18, 32], target: [2.5, -8, 1.2] },
    select: 'Black hole',
    bodies: [
      {
        name: 'Black hole',
        kind: 'blackhole',
        massKg: BH_MASS,
        radiusM: schwarzschildRadius(BH_MASS),
        simMass: BH_SIM,
        visualStrength: 1,
        softening: 1,
        radius: BH_HORIZON * 0.92,
        displayHorizon: BH_HORIZON,
        spin: 0.02,
        trail: false,
        style: 'blackhole',
        glow: '#ff3ec8',
        glowScale: 5.5,
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
      },
      {
        name: 'Star',
        kind: 'star',
        massKg: M_SUN,
        radiusM: R_SUN,
        simMass: BH_SIM * (M_SUN / BH_MASS),
        visualStrength: 1.35,
        softening: 0.48,
        radius: 0.72,
        spin: 0.25,
        trail: true,
        trailWidth: 0.16,
        trailColor: [1.6, 0.42, 0.1],
        style: 'sun',
        core: [1.25, 0.95, 0.7],
        limb: [1.05, 0.32, 0.08],
        glow: '#ffb15a',
        glowScale: 3.4,
        ...orbit(BH_ORBIT, 0.4, BH_SIM),
      },
    ],
  },
  {
    id: 'binary',
    name: 'Binary stars',
    tagline: 'Two stars orbiting the well they dig together.',
    metersPerUnit: (BINARY_SEP_AU * AU) / BINARY_A,
    camera: { position: [6, 16, 24], target: [0, -3.4, 0] },
    select: 'Star A',
    bodies: [
      {
        name: 'Star A',
        kind: 'star',
        massKg: 1.5 * M_SUN,
        radiusM: 1.6 * R_SUN,
        simMass: BINARY_M1,
        visualStrength: 10.4,
        softening: 1.18,
        radius: 1.12,
        spin: 0.18,
        trail: true,
        trailWidth: 0.12,
        trailColor: [1.35, 0.78, 0.28],
        style: 'sun',
        core: [1.4, 1.12, 0.78],
        limb: [1.2, 0.55, 0.08],
        glow: '#ffc56a',
        glowScale: 5.4,
        ...binary.a,
      },
      {
        name: 'Star B',
        kind: 'star',
        massKg: M_SUN,
        radiusM: R_SUN,
        simMass: BINARY_M2,
        visualStrength: 8.2,
        softening: 1.05,
        radius: 0.92,
        spin: 0.22,
        trail: true,
        trailWidth: 0.14,
        trailColor: [1.6, 0.36, 0.08],
        style: 'sun',
        core: [1.3, 0.78, 0.55],
        limb: [1.15, 0.28, 0.06],
        glow: '#ff7a4a',
        glowScale: 4.6,
        ...binary.b,
      },
    ],
  },
];

export function getPreset(id) {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[0];
}
