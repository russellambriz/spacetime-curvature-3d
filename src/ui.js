import katex from 'katex';
import { PRESETS } from './presets.js';
import { CONSTANTS_NOTE, buildReadout } from './readout.js';
import { applyMass, massRatio, selectedBody } from './sim.js';
import { formatMass } from './constants.js';

const MASS_MIN = Math.log(0.1);
const MASS_MAX = Math.log(8);

function sliderToRatio(value) {
  const t = Number(value) / 1000;
  return Math.exp(MASS_MIN + t * (MASS_MAX - MASS_MIN));
}

function ratioToSlider(ratio) {
  const clamped = Math.max(0.1, Math.min(8, ratio));
  const t = (Math.log(clamped) - MASS_MIN) / (MASS_MAX - MASS_MIN);
  return String(Math.round(t * 1000));
}

function tex(el, expression, display = false) {
  katex.render(expression, el, {
    throwOnError: false,
    displayMode: display,
    output: 'html',
  });
}

export class UI {
  constructor(state, handlers) {
    this.state = state;
    this.handlers = handlers;
    this.lock = false;
    this.lastSignature = '';
    this.lastId = null;
    this.lastTick = 0;
    this.toastTimer = 0;

    this.tagline = document.getElementById('tagline');
    this.presets = document.getElementById('presets');
    this.explain = document.getElementById('explain');
    this.math = document.getElementById('math');
    this.bodyKind = document.getElementById('body-kind');
    this.bodyName = document.getElementById('body-name');
    this.bodySub = document.getElementById('body-sub');
    this.stats = document.getElementById('body-stats');
    this.formulas = document.getElementById('formulas');
    this.motion = document.getElementById('motion');
    this.constants = document.getElementById('constants-note');
    this.time = document.getElementById('time');
    this.timeRead = document.getElementById('time-read');
    this.mass = document.getElementById('mass');
    this.massRead = document.getElementById('mass-read');
    this.massName = document.getElementById('mass-name');
    this.trails = document.getElementById('trails');
    this.pause = document.getElementById('pause');
    this.toast = document.getElementById('toast');
    this.label = document.getElementById('float-label');
    this.btnMath = document.getElementById('btn-math');
    this.btnWhy = document.getElementById('btn-why');
    this.uiToggle = document.getElementById('ui-toggle');
    this.brand = document.getElementById('brand');
    this.brandToggle = document.getElementById('brand-toggle');
    this.controlsPanel = document.getElementById('controls');
    this.controlsToggle = document.getElementById('controls-toggle');

    this.constants.textContent = CONSTANTS_NOTE;
    this.renderExplain();
    this.renderPresets();
    this.bind();
    this.syncTimeLabel();
    const roomy = window.matchMedia('(min-width: 1280px) and (min-height: 780px)').matches;
    if (roomy) {
      this.math.classList.add('open');
      this.explain.classList.add('open');
    }
    this.btnMath.setAttribute('aria-expanded', this.math.classList.contains('open') ? 'true' : 'false');
    this.btnWhy.setAttribute('aria-expanded', this.explain.classList.contains('open') ? 'true' : 'false');
    if (window.matchMedia('(pointer: coarse)').matches) {
      const hint = document.getElementById('hint');
      hint.textContent = 'Tap to inspect or add · hold to drag or remove · pinch to zoom · double-tap empty space hides the interface';
    }
    this.restoreHud();
  }

  restoreHud() {
    let hidden = false;
    try {
      hidden = localStorage.getItem('spacetime-hud') === 'hidden';
    } catch {
      hidden = false;
    }
    this.setHudHidden(hidden, false);
  }

  toggleHud() {
    this.setHudHidden(!document.documentElement.classList.contains('hud-hidden'));
  }

  setHudHidden(hidden, persist = true) {
    document.documentElement.classList.toggle('hud-hidden', hidden);
    document.body.classList.toggle('hud-hidden', hidden);
    this.uiToggle.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    this.uiToggle.setAttribute('aria-label', hidden ? 'Show interface' : 'Hide interface');
    if (!persist) return;
    try {
      localStorage.setItem('spacetime-hud', hidden ? 'hidden' : 'shown');
    } catch {
      /* private mode */
    }
  }

  renderExplain() {
    const blocks = [
      ['p', 'Mass curves spacetime, and spacetime tells matter how to move. Einstein’s field equations set the exchange rate:'],
      ['tex', 'G_{\\mu\\nu} = \\dfrac{8\\pi G}{c^{4}} T_{\\mu\\nu}'],
      ['p', 'The left side is curvature. The right side is energy and momentum. Nothing in this scene is a force pulling on a fabric — the drop is a picture of geometry.'],
      ['p', 'One spherical mass embeds as a Flamm paraboloid. Several masses share a sheet of potential wells, and a black hole continues into a throat:'],
      ['tex', 'z(r) = 2\\sqrt{r_{s}(r - r_{s})}'],
      ['tex', 'z(\\mathbf{x}) = -\\sum_{i}\\dfrac{\\alpha M_{i}}{\\sqrt{\\lVert\\mathbf{x}-\\mathbf{x}_{i}\\rVert^{2}+\\epsilon_{i}^{2}}}'],
      ['p', 'Orbits are free-fall paths on that sheet. Deeper in a well, clocks run slow and escape speed climbs, until rₛ = 2GM/c² pinches off into a horizon. Planetary dimples are drawn deeper than their real mass ratio. The math panel uses SI constants and the true masses.'],
    ];
    const root = document.getElementById('explain-body');
    for (let i = 0; i < blocks.length; i += 1) {
      const [kind, content] = blocks[i];
      if (kind === 'tex') {
        const el = document.createElement('div');
        el.className = 'explain-tex';
        tex(el, content, true);
        root.appendChild(el);
      } else {
        const el = document.createElement('p');
        el.textContent = content;
        root.appendChild(el);
      }
    }
  }

  renderPresets() {
    for (let i = 0; i < PRESETS.length; i += 1) {
      const preset = PRESETS[i];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset';
      button.dataset.preset = preset.id;
      button.textContent = preset.name;
      button.setAttribute('aria-pressed', preset.id === this.state.presetId ? 'true' : 'false');
      button.addEventListener('click', () => this.handlers.onPreset(preset.id));
      this.presets.appendChild(button);
    }
  }

  bind() {
    this.time.addEventListener('input', () => {
      const scale = Number(this.time.value) / 100;
      this.handlers.onTime(scale);
      this.syncTimeLabel();
      this.paintRange(this.time);
    });
    this.mass.addEventListener('input', () => {
      if (this.lock) return;
      const body = selectedBody(this.state);
      if (!body) return;
      applyMass(body, body.baseMassKg * sliderToRatio(this.mass.value));
      this.massRead.textContent = formatMass(body.massKg);
      this.paintRange(this.mass);
      this.handlers.onMass();
      this.sync(this.state, true);
    });
    this.trails.addEventListener('click', () => {
      this.handlers.onTrails();
      this.trails.setAttribute('aria-pressed', this.state.showTrails ? 'true' : 'false');
    });
    this.pause.addEventListener('click', () => {
      this.handlers.onPause();
      this.pause.setAttribute('aria-pressed', this.state.paused ? 'true' : 'false');
      this.pause.textContent = this.state.paused ? 'Resume' : 'Pause';
    });
    document.getElementById('reset').addEventListener('click', () => this.handlers.onReset());
    this.uiToggle.addEventListener('click', () => this.toggleHud());
    this.brandToggle.addEventListener('click', () => {
      const collapsed = this.brand.classList.toggle('collapsed');
      this.brandToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
    this.controlsToggle.addEventListener('click', () => {
      const collapsed = this.controlsPanel.classList.toggle('collapsed');
      this.controlsToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
    this.btnMath.addEventListener('click', () => {
      this.math.classList.toggle('open');
      this.explain.classList.remove('open');
      this.btnMath.setAttribute('aria-expanded', this.math.classList.contains('open') ? 'true' : 'false');
      this.btnWhy.setAttribute('aria-expanded', 'false');
    });
    this.btnWhy.addEventListener('click', () => {
      this.explain.classList.toggle('open');
      this.math.classList.remove('open');
      this.btnWhy.setAttribute('aria-expanded', this.explain.classList.contains('open') ? 'true' : 'false');
      this.btnMath.setAttribute('aria-expanded', 'false');
    });
    this.paintRange(this.time);
    this.paintRange(this.mass);
  }

  paintRange(input) {
    const max = Number(input.max) || 1;
    const pct = (Number(input.value) / max) * 100;
    input.style.background = `linear-gradient(90deg, #3dff9a ${pct}%, rgba(61,255,154,0.18) ${pct}%) center / 100% 3px no-repeat`;
  }

  syncTimeLabel() {
    this.timeRead.textContent = `${this.state.timeScale.toFixed(2)}×`;
  }

  setPresetActive(id) {
    const buttons = this.presets.querySelectorAll('.preset');
    buttons.forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.preset === id ? 'true' : 'false');
    });
    this.tagline.textContent = this.state.tagline;
  }

  refreshSelection() {
    const body = selectedBody(this.state);
    if (!body) return;
    this.lock = true;
    this.mass.value = ratioToSlider(massRatio(body));
    this.lock = false;
    this.massName.textContent = `${body.name} mass`;
    this.massRead.textContent = formatMass(body.massKg);
    this.paintRange(this.mass);
    this.lastSignature = '';
    this.sync(this.state, true);
  }

  sync(state, force = false) {
    const body = selectedBody(state);
    if (!body) return;
    const now = performance.now();
    if (!force && body.id === this.lastId && now - this.lastTick < 140) return;
    this.lastTick = now;
    const readout = buildReadout(body, state.bodies, state.metersPerUnit);
    if (!readout) return;
    this.bodyKind.textContent = readout.kind;
    this.bodyName.textContent = readout.name;
    this.bodySub.textContent = readout.subtitle;
    if (readout.stats.length !== this.stats.childElementCount) {
      this.stats.replaceChildren();
      for (let i = 0; i < readout.stats.length; i += 1) {
        const stat = document.createElement('div');
        stat.className = 'stat';
        stat.innerHTML = '<span></span><strong></strong><em></em>';
        this.stats.appendChild(stat);
      }
    }
    const statNodes = this.stats.children;
    for (let i = 0; i < readout.stats.length; i += 1) {
      const stat = readout.stats[i];
      statNodes[i].children[0].textContent = stat.label;
      statNodes[i].children[1].textContent = stat.value;
      statNodes[i].children[2].textContent = stat.detail || '';
    }
    if (readout.signature !== this.lastSignature) {
      this.lastSignature = readout.signature;
      this.lastId = body.id;
      this.formulas.replaceChildren();
      for (let i = 0; i < readout.formulas.length; i += 1) {
        const formula = readout.formulas[i];
        const block = document.createElement('section');
        block.className = 'formula';
        const title = document.createElement('h3');
        title.textContent = formula.title;
        const math = document.createElement('div');
        math.className = 'formula-tex';
        tex(math, formula.tex, true);
        const value = document.createElement('p');
        value.className = 'formula-value';
        const note = document.createElement('p');
        note.className = 'formula-note';
        block.append(title, math, value, note);
        this.formulas.appendChild(block);
      }
    }
    const blocks = this.formulas.children;
    for (let i = 0; i < readout.formulas.length; i += 1) {
      blocks[i].querySelector('.formula-value').textContent = readout.formulas[i].value;
      blocks[i].querySelector('.formula-note').textContent = readout.formulas[i].note || '';
    }
    this.motion.textContent = readout.motion || '';
    if (body.id !== this.lastId) {
      this.lastId = body.id;
      this.refreshSelection();
    }
  }

  setLabel(position, name) {
    if (!position) {
      this.label.hidden = true;
      return;
    }
    this.label.hidden = false;
    this.label.style.left = `${position.x}px`;
    this.label.style.top = `${position.y}px`;
    this.label.textContent = name;
  }

  toast(message) {
    if (!message) return;
    this.toast.textContent = message;
    this.toast.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 2400);
  }
}
