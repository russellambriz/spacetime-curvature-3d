/** SI constants and canonical solar-system masses. Readout numbers use these directly. */
export const G = 6.6743e-11;
export const C = 299792458;
export const M_SUN = 1.988416e30;
export const M_EARTH = 5.972168e24;
export const M_MERCURY = 3.3011e23;
export const M_VENUS = 4.8675e24;
export const M_MARS = 6.4171e23;
export const R_SUN = 6.957e8;
export const R_EARTH = 6.371e6;
export const R_MERCURY = 2.4397e6;
export const R_VENUS = 6.0518e6;
export const R_MARS = 3.3895e6;
export const AU = 1.495978707e11;

export const MAX_BODIES = 12;
export const GRID_SIZE = 460;
export const GRID_SEGMENTS_DESKTOP = 240;
export const GRID_SEGMENTS_TABLET = 168;
export const GRID_SEGMENTS_MOBILE = 112;

export function choosePixelRatio() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const budget = 5.2e6;
  if (w * h * dpr * dpr <= budget) return dpr;
  return Math.max(1, Math.min(dpr, Math.sqrt(budget / (w * h))));
}

export function schwarzschildRadius(massKg) {
  return (2 * G * massKg) / (C * C);
}

export const SUPER = {
  '-': '⁻',
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
};

export function superscript(exp) {
  const sign = exp < 0 ? SUPER['-'] : '';
  return sign + String(Math.abs(exp)).replace(/\d/g, (d) => SUPER[d]);
}

export function sci(value, digits = 3) {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  const exp = Math.floor(Math.log10(abs));
  if (exp >= -2 && exp <= 4) {
    const decimals = Math.max(0, Math.min(4, digits - exp - (abs >= 1 ? 1 : 0)));
    const fixed = value.toFixed(Math.max(0, digits - 1 - Math.max(exp, 0)));
    if (abs >= 0.01 && abs < 10000) {
      const places = abs >= 100 ? 1 : abs >= 10 ? 2 : abs >= 1 ? 2 : 3;
      return value.toFixed(places);
    }
    return fixed;
  }
  const mant = value / 10 ** exp;
  return `${mant.toFixed(digits)} × 10${superscript(exp)}`;
}

export function formatMass(kg) {
  if (!Number.isFinite(kg)) return '—';
  const sun = kg / M_SUN;
  const earth = kg / M_EARTH;
  if (sun >= 0.01) {
    if (sun >= 10000 || (sun > 0 && sun < 0.01)) return `${sci(sun, 3)} M☉`;
    if (sun >= 100) return `${sun.toFixed(1)} M☉`;
    return `${sun.toFixed(sun >= 10 ? 2 : 2)} M☉`;
  }
  if (earth >= 0.01) {
    if (earth >= 100) return `${earth.toFixed(1)} M⊕`;
    return `${earth.toFixed(earth >= 10 ? 2 : 2)} M⊕`;
  }
  return `${sci(kg, 3)} kg`;
}

export function formatLength(meters) {
  if (!Number.isFinite(meters)) return '—';
  const abs = Math.abs(meters);
  const au = meters / AU;
  if (abs >= 0.02 * AU && abs < 800 * AU) {
    const places = Math.abs(au) >= 10 ? 2 : 3;
    return `${au.toFixed(places)} AU`;
  }
  if (abs >= 1000) return `${sci(meters / 1000, 3)} km`;
  if (abs >= 1) return `${sci(meters, 3)} m`;
  if (abs >= 1e-3) return `${(meters * 1000).toFixed(2)} mm`;
  return `${sci(meters, 3)} m`;
}

export function formatSpeed(mps) {
  if (!Number.isFinite(mps)) return '—';
  const frac = mps / C;
  if (frac >= 0.01) return `${sci(mps / 1000, 3)} km/s (${frac.toFixed(3)} c)`;
  if (mps >= 1000) return `${(mps / 1000).toFixed(2)} km/s`;
  return `${mps.toFixed(1)} m/s`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const minute = 60;
  const hour = 3600;
  const day = 86400;
  const year = 365.25 * day;
  if (seconds >= 0.8 * year) return `${(seconds / year).toFixed(3)} yr`;
  if (seconds >= 2 * day) return `${(seconds / day).toFixed(2)} days`;
  if (seconds >= 2 * hour) return `${(seconds / hour).toFixed(2)} h`;
  if (seconds >= 2 * minute) return `${(seconds / minute).toFixed(1)} min`;
  if (seconds < 0.1) return `${(seconds * 1000).toFixed(1)} ms`;
  return `${seconds.toFixed(2)} s`;
}

export function formatForce(newtons) {
  if (!Number.isFinite(newtons)) return '—';
  return `${sci(newtons, 3)} N`;
}
