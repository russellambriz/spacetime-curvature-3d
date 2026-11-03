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
import { coneMetrics } from './cones.js';
import { tideMetrics } from './tides.js';
import { dragMetrics } from './drag.js';
import { lensMetrics } from './lens.js';
import { precessMetrics } from './precess.js';
import { WAVE_OBSERVER_MPC, waveMetrics } from './waves.js';

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
  if (body.kind === 'neutron') return 'Neutron star';
  if (body.kind === 'star') return 'Star';
  return 'Planet';
}

function formatFrequency(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return '—';
  if (hz >= 1000) return `${(hz / 1000).toFixed(2)} kHz`;
  if (hz >= 10) return `${hz.toFixed(1)} Hz`;
  return `${hz.toFixed(3)} Hz`;
}

function formatAngle(radians) {
  if (!Number.isFinite(radians)) return '—';
  const arcsec = Math.abs(radians) * (180 / Math.PI) * 3600;
  if (arcsec < 180) {
    const places = arcsec >= 20 ? 1 : 2;
    return `${arcsec.toFixed(places)}″`;
  }
  const deg = Math.abs(radians) * (180 / Math.PI);
  if (deg < 10) return `${deg.toFixed(2)}°`;
  return `${deg.toFixed(1)}°`;
}

function formatArcsec(radians) {
  if (!Number.isFinite(radians)) return '—';
  const arcsec = Math.abs(radians) * (180 / Math.PI) * 3600;
  const sign = radians < 0 ? '−' : '';
  if (arcsec >= 100) return `${sign}${arcsec.toFixed(0)}″`;
  if (arcsec >= 1) return `${sign}${arcsec.toFixed(2)}″`;
  return `${sign}${arcsec.toFixed(3)}″`;
}

function formatMicroarcsec(radians) {
  if (!Number.isFinite(radians)) return '—';
  const uas = Math.abs(radians) * (180 / Math.PI) * 3600 * 1e6;
  if (uas >= 1000) return `${(uas / 1000).toFixed(2)} mas`;
  if (uas >= 100) return `${Math.round(uas)} μas`;
  if (uas >= 10) return `${uas.toFixed(1)} μas`;
  return `${uas.toFixed(2)} μas`;
}

function dragFormulas(drag) {
  const where = drag.partnerName ? `at ${drag.partnerName}` : 'at 2.55 Schwarzschild radii';
  const weak = formatDuration(drag.weakPeriod);
  return [
    {
      key: 'drag-spin',
      title: 'Spin',
      tex: '\\hat{a} = \\dfrac{J c}{G M^{2}}',
      value: drag.spin.toFixed(2),
      note: 'Zero is a Schwarzschild hole. One is the fastest Kerr spin. 0.90 is a high spin of the kind discussed for M87*. The mass here is about 6.5 billion suns, M87*’s.',
    },
    {
      key: 'drag-horizon',
      title: 'Kerr horizon',
      tex: 'r_{+} = \\dfrac{r_{s}}{2}\\left(1 + \\sqrt{1 - \\hat{a}^{2}}\\right)',
      value: formatLength(drag.horizonM),
      note: `Inside the Schwarzschild radius ${formatLength(drag.rs)}. Spin pulls the horizon in. The closest stable prograde orbit moves in too, from 3 rₛ at zero spin to ${formatLength(drag.iscoM)} here. The star orbits outside that.`,
    },
    {
      key: 'drag-ergo',
      title: 'Ergosphere, equator',
      tex: 'r_{E} = \\dfrac{r_{s}}{2}\\left(1 + \\sqrt{1 - \\hat{a}^{2}\\cos^{2}\\theta}\\right)',
      value: formatLength(drag.ergoM),
      note: 'On the equator the square root is 1, so the static limit is exactly one Schwarzschild radius. That is the amber ring. Inside it, nothing can hover relative to the distant stars. At the poles it meets the horizon.',
    },
    {
      key: 'drag-omega',
      title: `Frame dragging ${where}`,
      tex: '\\Omega = \\dfrac{2 M a r}{(r^{2}+a^{2})^{2} - \\Delta a^{2}}',
      value: formatDuration(drag.period),
      note: `One turn of a local inertial frame ${where}. Δ = r² − 2Mr + a², and a = â GM/c². Far away this is 2GJ/(c²r³), which gives ${weak} here. At the horizon the drag period is ${formatDuration(drag.horizonPeriod)}.`,
    },
  ];
}

function lensFormulas(lens) {
  const kpc = (lens.distancePc / 1000).toFixed(2);
  return [
    {
      key: 'lens-photon',
      title: 'Photon sphere',
      tex: 'r_{\\gamma} = \\dfrac{3GM}{c^{2}}',
      value: formatLength(lens.photonM),
      note: '1.5 Schwarzschild radii. The bright ring on the sheet is this orbit. It is unstable: nudge a ray and it falls in or escapes.',
    },
    {
      key: 'lens-bcrit',
      title: 'Critical impact parameter',
      tex: 'b_{c} = \\dfrac{3\\sqrt{3}}{2}\\, r_{s}',
      value: formatLength(lens.bCritM),
      note: '2.598 horizons. A ray aimed closer than this falls through the horizon. The tight spirals are just inside and just outside that aim.',
    },
    {
      key: 'lens-alpha',
      title: `Deflection at ${lens.featureB} rₛ`,
      tex: '\\alpha = \\dfrac{4GM}{c^{2} b}',
      value: formatAngle(lens.deflection),
      note: `Turn of the outer drawn ray, from the integrated geodesic. The weak-field formula gives ${formatAngle(lens.weak)} here. A ray that grazes the Sun, where that formula is enough, deflects by ${formatAngle(lens.solar)}.`,
    },
    {
      key: 'lens-shadow',
      title: 'Shadow angular diameter',
      tex: '\\theta = \\dfrac{3\\sqrt{3}\\, r_{s}}{D}',
      value: formatMicroarcsec(lens.shadow),
      note: `At ${kpc} kpc, about the distance to the Galactic center. The Event Horizon Telescope measured about 52 μas for Sagittarius A*.`,
    },
  ];
}

function precessFormulas(pre) {
  const screenDeg = Math.abs(pre.screenRad) * (180 / Math.PI);
  const screenText = screenDeg >= 30 ? `${screenDeg.toFixed(0)}°` : `${screenDeg.toFixed(1)}°`;
  const gain = sci(pre.gain, 3);
  const centuryNote = pre.nearMercury
    ? `P = ${formatDuration(pre.period)} from Kepler’s law. A Julian century is 36525 days, so Mercury makes a few hundred trips. The result is the famous residual, about 43″ a century, left after the other planets’ Newtonian pull (about 532″ a century) is subtracted.`
    : `P = ${formatDuration(pre.period)} for the orbit on the sheet right now. Distances use this preset’s scale. Drag Mercury or change the Sun and the number follows. At Mercury’s real orbit the same formula gives about 43″ a century.`;
  const shapeNote = pre.bound
    ? `a = ${formatLength(pre.aMeters)}, e = ${pre.e.toFixed(3)}. One sun, and Mercury treated as a test mass. The other planets are not in this scene; they cause a separate Newtonian drift.`
    : 'The path is no longer a bound ellipse, so this formula does not apply. Reset restores Mercury’s orbit.';
  return [
    {
      key: 'pre-orbit',
      title: 'Perihelion advance per orbit',
      tex: '\\Delta\\varphi = \\dfrac{6\\pi GM}{c^{2} a(1-e^{2})}',
      value: pre.bound ? formatArcsec(pre.perOrbit) : '—',
      note: shapeNote,
    },
    {
      key: 'pre-century',
      title: 'Advance per century',
      tex: '\\Delta\\varphi_{\\mathrm{cen}} = \\Delta\\varphi \\times \\dfrac{36525\\,\\mathrm{d}}{P}',
      value: pre.bound ? formatArcsec(pre.perCentury) : '—',
      note: centuryNote,
    },
    {
      key: 'pre-sheet',
      title: 'Advance drawn on the sheet',
      tex: '\\dfrac{d^{2}u}{d\\varphi^{2}} + u = \\dfrac{GM}{h^{2}} + \\dfrac{3GM}{c^{2}} u^{2}',
      value: pre.bound ? `${screenText} per orbit` : '—',
      note: `u = 1/r. Newton is the first term on the right, and that orbit is the closed ellipse. The second term opens the rosette. On the sheet it is multiplied by ${gain}, so the perihelion walks about ${screenText} per revolution instead of ${pre.bound ? formatArcsec(pre.perOrbit) : 'a fraction of an arcsecond'}. The orange trail is that sped-up path. It falls a little short of the ellipse at the far end, because a term this large is no longer a tiny correction. The real advance does not change the shape you could see. The clock along the path is the simulation clock, not proper time. A ball rolling in the well would stay on the ellipse.`,
    },
  ];
}

function formatConeSpeed(fraction) {
  const abs = Math.abs(fraction);
  if (abs < 0.0008) return 'at rest';
  const mag = abs >= 0.01 ? `${abs.toFixed(3)} c` : `${abs.toFixed(4)} c`;
  return fraction > 0 ? `${mag} outward` : `${mag} inward`;
}

function formatTilt(radians) {
  const deg = radians * (180 / Math.PI);
  if (Math.abs(deg) < 0.05) return 'vertical';
  if (deg > 0) return `${deg.toFixed(1)}° from vertical, outward`;
  return `${Math.abs(deg).toFixed(1)}° inward of vertical`;
}

function outgoingNote(ratio) {
  if (ratio < 0.98) {
    return 'Aimed outward, and it still loses radius. Both edges of the future cone point inward. Nothing can climb out, and nothing can stay at this radius.';
  }
  if (ratio < 1.02) {
    return 'On the horizon an outward photon stays at this radius. From far away it appears to freeze on the magenta line. A nearby observer still measures that ray moving at c.';
  }
  return 'An outward photon gains radius at this coordinate speed. dr/dt is not what a nearby clock and ruler measure. Locally, light still moves at c. The difference is the river.';
}

function coneFormulas(cone, rsMeters) {
  const { station, slopes, ratio } = cone;
  const where = `${ratio.toFixed(2)} rₛ`;
  const radius = rsMeters * ratio;
  return [
    {
      key: 'cone-river',
      title: `River speed at ${station.name.toLowerCase()}`,
      tex: 'v = c\\sqrt{\\dfrac{r_{s}}{r}}',
      value: `${slopes.beta.toFixed(3)} c inward`,
      note: `Space falls toward the hole at the Newtonian escape speed, ${formatSpeed(slopes.beta * C)}. In Painlevé–Gullstrand coordinates that speed is exact, and the cones are sheared by it. Light still moves at c relative to the river. This cone is at ${where}, ${formatLength(radius)} from the center. ${station.note}`,
    },
    {
      key: 'cone-out',
      title: `Outgoing light at ${where}`,
      tex: '\\dfrac{dr}{dt} = c\\left(1 - \\sqrt{\\dfrac{r_{s}}{r}}\\right)',
      value: formatConeSpeed(slopes.outgoing),
      note: outgoingNote(ratio),
    },
    {
      key: 'cone-in',
      title: `Ingoing light at ${where}`,
      tex: '\\dfrac{dr}{dt} = -c\\left(1 + \\sqrt{\\dfrac{r_{s}}{r}}\\right)',
      value: formatConeSpeed(slopes.ingoing),
      note: 'Always inward, and faster than the river. On the horizon this coordinate speed is 2c. That is allowed: dr/dt is not a local speed. The photons that cross the horizon are this ray.',
    },
    {
      key: 'cone-tilt',
      title: `Outward tilt at ${where}`,
      tex: '\\theta_{+} = \\arctan\\left(1 - \\sqrt{\\dfrac{r_{s}}{r}}\\right)',
      value: formatTilt(cone.tilt),
      note: 'Angle between the outward ray and the time axis, which points straight up. At infinity the cone opens to 45°, because distance and time are drawn in the same units, with c = 1. The past cone hangs below the grid with the same tilt.',
    },
  ];
}

const GEE = 9.80665;

function formatGee(accel) {
  if (!Number.isFinite(accel)) return '—';
  const ratio = Math.abs(accel) / GEE;
  if (ratio >= 10000 || (ratio > 0 && ratio < 0.01)) return `${sci(ratio, 3)} g`;
  if (ratio >= 100) return `${Math.round(ratio)} g`;
  if (ratio >= 10) return `${ratio.toFixed(1)} g`;
  return `${ratio.toFixed(2)} g`;
}

function tideFormulas(tide) {
  const where = `${tide.u.toFixed(2)} rₛ`;
  const radius = tide.u * tide.rs;
  const shape = `${tide.sr.toFixed(2)} × ${tide.sp.toFixed(2)}`;
  const outside = tide.breakOverRs > 1.05;
  const horizons = tide.breakOverRs >= 10 ? tide.breakOverRs.toFixed(0) : tide.breakOverRs.toFixed(2);
  return [
    {
      key: 'tide-radial',
      title: 'Radial stretch across 2 m',
      tex: '\\Delta a_{\\parallel} = \\dfrac{2GM}{r^{3}}\\, L',
      value: formatGee(tide.radial),
      note: `L = 2 m at ${where}, ${formatLength(radius)} from this ${formatMass(tide.massKg)} hole. Feet and head, lined up with the fall, pull apart at this rate. It is the radial geodesic deviation, and it falls as 1/r³.`,
    },
    {
      key: 'tide-transverse',
      title: 'Transverse squeeze across 2 m',
      tex: '\\Delta a_{\\perp} = -\\dfrac{GM}{r^{3}}\\, L',
      value: formatGee(Math.abs(tide.transverse)),
      note: `Half the radial figure, and inward, in each sideways direction. The green arms are one of those. Released round at ${tide.releaseU.toFixed(2)} rₛ, the ring is now ${shape}, length times width. The arms draw those factors. The equation is the linear one, for a separation small beside r, so the ring is enlarged.`,
    },
    {
      key: 'tide-horizon',
      title: 'Stretch at this horizon',
      tex: '\\Delta a_{\\parallel}(r_{s}) = \\dfrac{c^{2} L}{r_{s}^{2}}',
      value: formatGee(tide.horizonRadial),
      note: `Across 2 m on the horizon of this hole. The tide stays finite there. It diverges at the center, not at the horizon. Sagittarius A*, 4.3 million suns, stretches the same 2 m by ${formatGee(tide.sgrHorizon)} at its own horizon.`,
    },
    {
      key: 'tide-break',
      title: 'Where 2 m feels one g',
      tex: 'r_{1g} = \\left(\\dfrac{2GML}{g}\\right)^{1/3}',
      value: `${horizons} rₛ`,
      note: outside
        ? `A head-to-toe difference of one g, ${formatLength(tide.breakR)} out. This horizon is ${formatLength(tide.rs)}, so the tear begins about ${horizons} horizons out.`
        : `A head-to-toe difference of one g, ${formatLength(tide.breakR)} out. That radius is inside this horizon, so a 2 m body can cross before the stretch reaches one g.`,
    },
  ];
}

function waveFormulas(wave) {
  return [
    {
      key: 'gw-f',
      title: 'Gravitational-wave frequency',
      tex: 'f_{\\mathrm{GW}} = \\dfrac{1}{\\pi}\\sqrt{\\dfrac{G(M+m)}{a^{3}}}',
      value: formatFrequency(wave.fGw),
      note: `Twice the orbital frequency. The mass pattern of ${wave.nameA} and ${wave.nameB} repeats every half orbit, so the wave does too.`,
    },
    {
      key: 'gw-lambda',
      title: 'Wavelength',
      tex: '\\lambda = \\dfrac{c}{f_{\\mathrm{GW}}}',
      value: formatLength(wave.lambda),
      note: 'Distance between crests in the real wave. On the grid the crests are drawn closer together, so several fit in view.',
    },
    {
      key: 'gw-strain',
      title: `Strain at ${WAVE_OBSERVER_MPC} Mpc`,
      tex: 'h = \\dfrac{4}{D}\\left(\\dfrac{G\\mathcal{M}_{c}}{c^{2}}\\right)^{5/3}\\left(\\dfrac{\\pi f_{\\mathrm{GW}}}{c}\\right)^{2/3}',
      value: sci(wave.h, 3),
      note: `Face-on amplitude. Chirp mass ${formatMass(wave.chirp)}. A detector at this distance, about as far as GW170817, measures strains of this size.`,
    },
    {
      key: 'gw-tau',
      title: 'Time to merger',
      tex: '\\tau = \\dfrac{5}{256}\\,\\dfrac{c^{5} a^{4}}{G^{3} M m (M+m)}',
      value: formatDuration(wave.tau),
      note: 'Peters’ formula for a circular orbit. The animation keeps that orbit steady so the wave can be watched. It does not play the inspiral.',
    },
  ];
}

export function buildReadout(body, bodies, metersPerUnit) {
  if (!body) return null;
  const partner = partnerOf(body, bodies);
  const central = isCentral(body, partner);
  const rsSelf = schwarzschildRadius(body.massKg);
  const drag = dragMetrics(bodies, metersPerUnit);
  const cones = coneMetrics(bodies);
  const tides = tideMetrics(bodies);
  const formulas = [];
  const spinningHole = Boolean(drag) && body.kind === 'blackhole' && body.kerrSpin > 0;

  const stats = [
    { label: 'Mass', value: formatMass(body.massKg), detail: `${sci(body.massKg, 3)} kg` },
    {
      label: body.kind === 'blackhole' ? 'Horizon' : 'Radius',
      value: formatLength(spinningHole ? drag.horizonM : body.kind === 'blackhole' ? rsSelf : body.radiusM),
      detail: spinningHole ? `spin ${drag.spin.toFixed(2)}` : '',
    },
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

    const orbitNote = central
      ? `Circular speed of ${who} about ${host} at the current separation.`
      : `Circular speed about ${host}. M = ${formatMass(M)}.`;
    formulas.push({
      key: 'vorbit',
      title: central ? `Orbital velocity of ${who}` : 'Orbital velocity',
      tex: 'v = \\sqrt{\\dfrac{GM}{r}}',
      value: formatSpeed(vCirc),
      note: drag
        ? `${orbitNote} This close in, that Newtonian speed is only a sketch of the Kerr orbit.`
        : orbitNote,
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
        note: spinningHole
          ? `The horizon at zero spin. With â = ${drag.spin.toFixed(2)} the horizon is smaller: ${formatLength(drag.horizonM)}.`
          : body.kind === 'blackhole'
            ? 'The event horizon of an uncharged, non-spinning black hole.'
            : `The horizon this mass would have if it were compressed inside ${formatLength(rsSelf)}.`,
      });
      formulas.push({
        key: 'dilation',
        title: 'Gravitational time dilation',
        tex: '\\dfrac{\\Delta\\tau}{\\Delta t} = \\sqrt{1 - \\dfrac{r_{s}}{r}}',
        value: dilationValue(rsSelf, spinningHole ? rsSelf * 1.01 : surfaceR),
        note: spinningHole
          ? 'Schwarzschild factor at 1.01 rₛ. This formula is not the Kerr redshift. The horizon above is inward of rₛ, and a hovering clock still slows without bound as it approaches r₊.'
          : dilationNote(rsSelf, surfaceR, body.kind === 'blackhole' ? 'at the horizon' : 'on the surface'),
      });
      formulas.push({
        key: 'escape',
        title: body.kind === 'blackhole' ? 'Escape velocity at the horizon' : 'Surface escape velocity',
        tex: 'v_{\\mathrm{esc}} = \\sqrt{\\dfrac{2GM}{r}}',
        value: formatSpeed(vSurface),
        note: spinningHole
          ? 'Newtonian escape speed at r = rₛ is c. The spinning horizon is smaller, and inside the ergosphere light is dragged even while it is still outside that horizon.'
          : body.kind === 'blackhole'
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
    const hole = body.kind === 'blackhole';
    const surfaceR = hole ? rsSelf : Math.max(body.radiusM, rsSelf * 1.0001);
    const vSurface = Math.sqrt((2 * G * body.massKg) / (hole ? rsSelf : body.radiusM));
    stats.push({ label: 'Separation', value: '—' }, { label: 'Partner', value: '—' });
    formulas.push(
      {
        key: 'rs',
        title: 'Schwarzschild radius',
        tex: 'r_{s} = \\dfrac{2GM}{c^{2}}',
        value: formatLength(rsSelf),
        note: spinningHole
          ? `The horizon at zero spin. With â = ${drag.spin.toFixed(2)} the horizon is smaller: ${formatLength(drag.horizonM)}.`
          : hole
            ? 'The event horizon of an uncharged, non-spinning black hole.'
            : '',
      },
      {
        key: 'dilation',
        title: 'Gravitational time dilation',
        tex: '\\dfrac{\\Delta\\tau}{\\Delta t} = \\sqrt{1 - \\dfrac{r_{s}}{r}}',
        value: dilationValue(rsSelf, surfaceR),
        note: dilationNote(rsSelf, surfaceR, hole ? 'at the horizon' : 'on the surface'),
      },
      {
        key: 'escape',
        title: hole ? 'Escape velocity at the horizon' : 'Escape velocity',
        tex: 'v_{\\mathrm{esc}} = \\sqrt{\\dfrac{2GM}{r}}',
        value: formatSpeed(vSurface),
        note: spinningHole
          ? 'Newtonian escape speed at r = rₛ is c. The spinning horizon is smaller, and inside the ergosphere light is dragged even while it is still outside that horizon.'
          : hole
            ? 'Newtonian escape speed at r = rₛ is exactly c. Light on the horizon is marginally bound.'
            : 'From the surface, to infinity.',
      },
    );
  }

  const pre = precessMetrics(bodies, metersPerUnit);
  if (pre) {
    stats.push(
      { label: 'Eccentricity', value: pre.bound ? pre.e.toFixed(3) : '—', detail: pre.nearMercury ? 'Mercury’s real e' : pre.bound ? 'this orbit' : 'not a closed orbit' },
      { label: 'Advance / century', value: pre.bound ? formatArcsec(pre.perCentury) : '—', detail: 'general relativity' },
    );
    formulas.unshift(...precessFormulas(pre));
  }

  const lens = lensMetrics(bodies);
  if (lens && !partner) {
    stats.pop();
    stats.pop();
    stats.push(
      { label: 'Photon orbit', value: formatLength(lens.photonM), detail: '1.5 horizons' },
      { label: `Shadow at ${(lens.distancePc / 1000).toFixed(2)} kpc`, value: formatMicroarcsec(lens.shadow), detail: 'angular diameter' },
    );
  } else if (lens) {
    stats.push(
      { label: 'Photon orbit', value: formatLength(lens.photonM), detail: '1.5 horizons' },
      { label: `Shadow at ${(lens.distancePc / 1000).toFixed(2)} kpc`, value: formatMicroarcsec(lens.shadow), detail: 'angular diameter' },
    );
  }

  const wave = waveMetrics(bodies, metersPerUnit);
  if (wave) {
    stats.push(
      { label: 'GW frequency', value: formatFrequency(wave.fGw), detail: 'twice per orbit' },
      { label: 'Merges in', value: formatDuration(wave.tau), detail: 'if the orbit stays circular' },
    );
    formulas.unshift(...waveFormulas(wave));
  }
  if (lens) formulas.unshift(...lensFormulas(lens));
  if (tides) formulas.unshift(...tideFormulas(tides));
  if (drag) {
    stats.push(
      { label: 'Spin â', value: drag.spin.toFixed(2), detail: 'Kerr parameter' },
      { label: 'Frame drag', value: formatDuration(drag.period), detail: drag.partnerName ? `one turn at ${drag.partnerName}` : 'one turn' },
    );
    formulas.unshift(...dragFormulas(drag));
  }
  if (tides && !partner) {
    stats.pop();
    stats.pop();
    stats.push(
      { label: 'Probe', value: `${tides.u.toFixed(2)} rₛ`, detail: `released at ${tides.releaseU.toFixed(2)} rₛ` },
      { label: 'Length × width', value: `${tides.sr.toFixed(2)} × ${tides.sp.toFixed(2)}`, detail: 'started at 1 × 1' },
      { label: 'Proper time', value: tides.tau < 1e-6 ? '0 ms' : formatDuration(tides.tau), detail: `of ${formatDuration(tides.tauTotal)}, slowed on screen` },
    );
  } else if (tides) {
    stats.push(
      { label: 'Probe', value: `${tides.u.toFixed(2)} rₛ`, detail: 'falling from rest' },
      { label: 'Length × width', value: `${tides.sr.toFixed(2)} × ${tides.sp.toFixed(2)}`, detail: 'started at 1 × 1' },
    );
  }

  if (cones) {
    const rsMeters = schwarzschildRadius(cones.massKg);
    stats.push(
      { label: 'This cone', value: `${cones.ratio.toFixed(2)} rₛ`, detail: cones.station.name },
      { label: 'Outgoing light', value: formatConeSpeed(cones.slopes.outgoing), detail: 'coordinate speed' },
    );
    formulas.unshift(...coneFormulas(cones, rsMeters));
    const escape = formulas.find((formula) => formula.key === 'escape');
    if (escape) {
      escape.note = 'Newtonian escape speed at the horizon is c. That is the river speed on the cones. At the horizon the outward cone stands vertical, and inside it points only inward.';
    }
  }

  let motion = null;
  if (tides) {
    motion = 'Orange stretches and green squeezes. The pale ring is the shape at release. Marks on the far side are the tide at that radius: radial arrows are twice the transverse ones, and both fall as 1/r³. The ring steps inward evenly in radius. Proper time in the panel passes faster near the hole, which is why a real drop lingers, then plunges. That runaway stretch is spaghettification.';
  }
  if (cones) {
    motion = 'Up is later. The grid is one moment, and the magenta ring is the horizon. Green cones are outside it, magenta cones inside. Orange is a stone falling through. Tap a cone, or press the arrow keys, to read the tilt there.';
  }
  if (lens) {
    motion = 'The filaments are light, traced by photons. Aimed inside the critical impact parameter, a ray falls in. Aimed wider, it bends and escapes. The ring at one and a half horizons is the photon sphere.';
  }
  if (drag) {
    const line = 'The ticks are local inertial frames, and closer ones are dragged ahead. The grid holds a readable spiral of that same whirl. The amber ring is the ergosphere. The magenta ring inside it is the horizon.';
    motion = motion ? `${motion} ${line}` : line;
  }
  if (wave) {
    motion = 'The spiral on the grid is that wave: it turns with the stars and the crests move outward. The height is a diagram of a stretch that, in the real wave, happens in the plane.';
  }
  if (pre) {
    const line = 'The closed ellipse is Newton’s orbit. The orange trail is the relativistic one, and the green spoke is perihelion.';
    motion = motion ? `${line} ${motion}` : line;
  }
  if (partner && !central) {
    const ratio = circularRatio(body, partner);
    if (ratio !== null) {
      const line = `Moving at ${ratio.toFixed(2)}× the Newtonian circular speed for this separation.`;
      motion = motion ? `${motion} ${line}` : line;
    }
  } else if (partner && central) {
    const line = `${body.name} is the central mass. Orbital numbers above describe ${partner.name}.`;
    motion = motion ? `${motion} ${line}` : line;
  }

  return {
    kind: kindLabel(body),
    name: body.name,
    subtitle: partner
      ? central
        ? spinningHole
          ? `Spin â = ${drag.spin.toFixed(2)} · companion ${partner.name}`
          : `Central mass · companion ${partner.name}`
        : `Orbiting ${partner.name}`
      : spinningHole
        ? `Spinning at â = ${drag.spin.toFixed(2)}`
        : cones
          ? `${cones.station.name} at ${cones.ratio.toFixed(2)} horizons`
          : lens
            ? 'Lensing the rays drawn around it'
            : tides
              ? 'Tides on a body falling from rest'
              : 'Alone on the sheet',
    stats,
    formulas,
    motion,
    signature: formulas.map((formula) => formula.key + formula.title).join('|'),
  };
}

export const CONSTANTS_NOTE = `G = ${sci(G, 5)} m³ kg⁻¹ s⁻² · c = ${sci(C, 6)} m/s. Distances follow the live separation. Planetary wells are drawn deeper than their true mass ratio so the dimples stay visible.`;
