import {
  C,
  G,
  formatDuration,
  formatForce,
  formatLength,
  formatMass,
  formatSpeed,
  schwarzschildRadius,
  sci,
} from './constants.js';

function partnerOf(body, bodies) {
  let best = null;
  let bestPull = -1;
  for (let i = 0; i < bodies.length; i += 1) {
    const other = bodies[i];
    if (other.id === body.id) continue;
    const r = Math.hypot(other.x - body.x, other.z - body.z);
    const pull = other.massKg / (r * r + 1e-6);
    if (pull > bestPull) {
      bestPull = pull;
      best = other;
    }
  }
  return best;
}

function isCentral(body, partner) {
  if (!partner) return true;
  if (body.massKg > partner.massKg * 1.001) return true;
  if (partner.massKg > body.massKg * 1.001) return false;
  return body.kind === 'blackhole' || body.kind === 'star';
}

function separationMeters(body, partner, metersPerUnit) {
  const sim = Math.hypot(body.x - partner.x, body.z - partner.z);
  return Math.max(sim * metersPerUnit, 1);
}

function dilation(rs, r) {
  if (!(r > 0) || !(rs > 0)) return { factor: NaN, inside: false };
  if (r <= rs * 1.0005) return { factor: 0, inside: true };
  return { factor: Math.sqrt(1 - rs / r), inside: false };
}

function dilationValue(rs, r) {
  const result = dilation(rs, r);
  if (result.inside) return '0 at the horizon';
  if (!Number.isFinite(result.factor)) return '—';
  const deficit = 1 - result.factor;
  if (deficit < 1e-4) return `1 − ${sci(deficit, 3)}`;
  return result.factor.toFixed(6);
}

function dilationNote(rs, r, subject) {
  const result = dilation(rs, r);
  if (result.inside) {
    return 'A distant observer never sees a clock cross the horizon. The Newtonian picture has already failed here.';
  }
  if (!Number.isFinite(result.factor)) return '';
  const deficit = 1 - result.factor;
  if (deficit < 1e-4) {
    return `Clocks ${subject} tick slower than clocks at infinity by a fraction ${sci(deficit, 3)}.`;
  }
  return `A clock ${subject} runs at this fraction of a clock far away.`;
}

function circularRatio(body, partner) {
  if (!partner) return null;
  const r = Math.hypot(body.x - partner.x, body.z - partner.z);
  if (r < 1e-3) return null;
  const vCirc = Math.sqrt((partner.simMass * partner.simMass) / (r * (body.simMass + partner.simMass)));
  if (vCirc < 1e-8) return null;
  return Math.hypot(body.vx, body.vz) / vCirc;
}

function kindLabel(body) {
  if (body.kind === 'blackhole') return 'Black hole';
  if (body.kind === 'star') return 'Star';
  return 'Planet';
}

export function buildReadout(body, bodies, metersPerUnit) {
  if (!body) return null;
  const partner = partnerOf(body, bodies);
  const central = isCentral(body, partner);
  const rsSelf = schwarzschildRadius(body.massKg);
  const formulas = [];

  const stats = [
    { label: 'Mass', value: formatMass(body.massKg), detail: `${sci(body.massKg, 3)} kg` },
    { label: body.kind === 'blackhole' ? 'Horizon' : 'Radius', value: formatLength(body.kind === 'blackhole' ? rsSelf : body.radiusM) },
  ];

  if (partner) {
    const r = separationMeters(body, partner, metersPerUnit);
    const M = central ? body.massKg : partner.massKg;
    const m = central ? partner.massKg : body.massKg;
    const force = (G * M * m) / (r * r);
    const vCirc = Math.sqrt((G * M) / r);
    const period = 2 * Math.PI * Math.sqrt(r ** 3 / (G * (M + m)));
    const vEsc = Math.sqrt((2 * G * M) / r);
    const rsCentral = schwarzschildRadius(M);
    const who = central ? partner.name : body.name;
    const host = central ? body.name : partner.name;

    stats.push(
      { label: `Distance to ${partner.name}`, value: formatLength(r) },
      { label: 'Partner', value: partner.name },
    );

    formulas.push({
      key: 'force',
      title: 'Newtonian gravity',
      tex: 'F = \\dfrac{GMm}{r^{2}}',
      value: formatForce(force),
      note: `M = ${formatMass(M)}, m = ${formatMass(m)}, r = ${formatLength(r)}.`,
    });

    formulas.push({
      key: 'vorbit',
      title: central ? `Orbital velocity of ${who}` : 'Orbital velocity',
      tex: 'v = \\sqrt{\\dfrac{GM}{r}}',
      value: formatSpeed(vCirc),
      note: central
        ? `Circular speed of ${who} about ${host} at the current separation.`
        : `Circular speed about ${host}. M = ${formatMass(M)}.`,
    });

    formulas.push({
      key: 'kepler',
      title: "Kepler's third law",
      tex: 'T^{2} = \\dfrac{4\\pi^{2}}{G(M+m)}\\, a^{3}',
      value: formatDuration(period),
      note: 'The current separation is used as the semi-major axis, which is exact for a circular orbit.',
    });

    if (central) {
      const surfaceR = body.kind === 'blackhole' ? rsSelf : Math.max(body.radiusM, rsSelf * 1.0001);
      const vSurface = Math.sqrt((2 * G * body.massKg) / surfaceR);
      formulas.push({
        key: 'rs',
        title: 'Schwarzschild radius',
        tex: 'r_{s} = \\dfrac{2GM}{c^{2}}',
        value: formatLength(rsSelf),
        note: body.kind === 'blackhole'
          ? 'The event horizon of an uncharged, non-spinning black hole.'
          : `The horizon this mass would have if it were compressed inside ${formatLength(rsSelf)}.`,
      });
      formulas.push({
        key: 'dilation',
        title: 'Gravitational time dilation',
        tex: '\\dfrac{\\Delta\\tau}{\\Delta t} = \\sqrt{1 - \\dfrac{r_{s}}{r}}',
        value: dilationValue(rsSelf, surfaceR),
        note: dilationNote(rsSelf, surfaceR, body.kind === 'blackhole' ? 'at the horizon' : 'on the surface'),
      });
      formulas.push({
        key: 'escape',
        title: body.kind === 'blackhole' ? 'Escape velocity at the horizon' : 'Surface escape velocity',
        tex: 'v_{\\mathrm{esc}} = \\sqrt{\\dfrac{2GM}{r}}',
        value: formatSpeed(vSurface),
        note: body.kind === 'blackhole'
          ? 'Newtonian escape speed at r = rₛ is exactly c. Light on the horizon is marginally bound.'
          : `Escape speed from the surface of ${body.name}. At the companion's distance it is ${formatSpeed(vEsc)}.`,
      });
    } else {
      formulas.push({
        key: 'rs',
        title: `Schwarzschild radius of ${body.name}`,
        tex: 'r_{s} = \\dfrac{2GM}{c^{2}}',
        value: formatLength(rsSelf),
        note: `Computed from ${body.name}'s own mass, not the central mass.`,
      });
      formulas.push({
        key: 'dilation',
        title: `Time dilation in ${host}'s gravity`,
        tex: '\\dfrac{\\Delta\\tau}{\\Delta t} = \\sqrt{1 - \\dfrac{r_{s}}{r}}',
        value: dilationValue(rsCentral, r),
        note: dilationNote(rsCentral, r, `at this distance from ${host}`),
      });
      formulas.push({
        key: 'escape',
        title: `Escape velocity from ${host}`,
        tex: 'v_{\\mathrm{esc}} = \\sqrt{\\dfrac{2GM}{r}}',
        value: formatSpeed(vEsc),
        note: vEsc >= C
          ? 'Above c: a Newtonian rocket cannot leave, and the Schwarzschild picture matters.'
          : `Speed to coast from this distance to infinity, ignoring ${body.name}'s own gravity.`,
      });
    }
  } else {
    const surfaceR = Math.max(body.radiusM, rsSelf * 1.0001);
    const vSurface = Math.sqrt((2 * G * body.massKg) / body.radiusM);
    stats.push({ label: 'Separation', value: '—' }, { label: 'Partner', value: '—' });
    formulas.push(
      {
        key: 'rs',
        title: 'Schwarzschild radius',
        tex: 'r_{s} = \\dfrac{2GM}{c^{2}}',
        value: formatLength(rsSelf),
        note: '',
      },
      {
        key: 'dilation',
        title: 'Gravitational time dilation',
        tex: '\\dfrac{\\Delta\\tau}{\\Delta t} = \\sqrt{1 - \\dfrac{r_{s}}{r}}',
        value: dilationValue(rsSelf, surfaceR),
        note: dilationNote(rsSelf, surfaceR, 'on the surface'),
      },
      {
        key: 'escape',
        title: 'Escape velocity',
        tex: 'v_{\\mathrm{esc}} = \\sqrt{\\dfrac{2GM}{r}}',
        value: formatSpeed(vSurface),
        note: 'From the surface, to infinity.',
      },
    );
  }

  let motion = null;
  if (partner && !central) {
    const ratio = circularRatio(body, partner);
    if (ratio !== null) {
      motion = `Moving at ${ratio.toFixed(2)}× the Newtonian circular speed for this separation.`;
    }
  } else if (partner && central) {
    motion = `${body.name} is the central mass. Orbital numbers above describe ${partner.name}.`;
  }

  return {
    kind: kindLabel(body),
    name: body.name,
    subtitle: partner
      ? central
        ? `Central mass · companion ${partner.name}`
        : `Orbiting ${partner.name}`
      : 'Alone on the sheet',
    stats,
    formulas,
    motion,
    signature: formulas.map((formula) => formula.key + formula.title).join('|'),
  };
}

export const CONSTANTS_NOTE = `G = ${sci(G, 5)} m³ kg⁻¹ s⁻² · c = ${sci(C, 6)} m/s. Distances follow the live separation. Planetary wells are drawn deeper than their true mass ratio so the dimples stay visible.`;
