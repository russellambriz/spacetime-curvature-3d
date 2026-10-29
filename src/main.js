import 'katex/dist/katex.min.css';
import './style.css';
import { World } from './world.js';
import { UI } from './ui.js';
import {
  addBody,
  advance,
  computeAccelerations,
  createState,
  loadPreset,
  removeBody,
  selectedBody,
  setDraggedPosition,
} from './sim.js';

const canvas = document.getElementById('scene');
const loader = document.getElementById('loader');
const state = createState('sun-earth');
loadPreset(state, 'sun-earth');

const params = new URLSearchParams(window.location.search);
if (params.get('preset')) loadPreset(state, params.get('preset'));

const world = new World(canvas, state);
if (!world.ok) {
  loader.textContent = 'WebGL is unavailable in this browser.';
  throw new Error('WebGL unavailable');
}

const ui = new UI(state, {
  onPreset: (id) => {
    loadPreset(state, id);
    world.frameCamera(state, true);
    ui.setPresetActive(id);
    ui.refreshSelection();
  },
  onTime: (scale) => {
    state.timeScale = scale;
  },
  onMass: () => {
    computeAccelerations(state.bodies);
  },
  onTrails: () => {
    state.showTrails = !state.showTrails;
  },
  onPause: () => {
    state.paused = !state.paused;
  },
  onReset: () => {
    const scale = state.timeScale;
    const trails = state.showTrails;
    loadPreset(state, state.presetId);
    state.timeScale = scale;
    state.showTrails = trails;
    state.paused = false;
    world.frameCamera(state, true);
    ui.pause.setAttribute('aria-pressed', 'false');
    ui.pause.textContent = 'Pause';
    ui.setPresetActive(state.presetId);
    ui.refreshSelection();
  },
});

ui.setPresetActive(state.presetId);
ui.refreshSelection();
world.frameCamera(state, true);

let drag = null;
let pending = null;
let last = performance.now();
let shown = false;

function hideLoader() {
  if (shown) return;
  shown = true;
  loader.classList.add('hide');
}

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const body = world.pickBody(event.clientX, event.clientY);
  if (body) {
    event.preventDefault();
    event.stopPropagation();
    drag = {
      id: body.id,
      moved: false,
      x: event.clientX,
      y: event.clientY,
    };
    pending = null;
    state.selectedId = body.id;
    ui.refreshSelection();
    world.setControls(false);
    world.intro = null;
    canvas.classList.add('dragging');
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  pending = { x: event.clientX, y: event.clientY, t: performance.now() };
}, true);

canvas.addEventListener('pointermove', (event) => {
  const hovered = world.pickBody(event.clientX, event.clientY);
  canvas.classList.toggle('hovering', Boolean(hovered) && !drag);
  if (!drag) return;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.moved = true;
  if (!drag.moved) return;
  const hit = world.pickSheet(event.clientX, event.clientY);
  if (!hit) return;
  const body = state.bodies.find((candidate) => candidate.id === drag.id);
  if (!body) return;
  setDraggedPosition(body, hit.x, hit.z, 1 / 60);
  const view = world.views.find((item) => item.id === body.id);
  if (view) view.trail.reset();
});

function endDrag(event) {
  if (drag) {
    world.setControls(true);
    canvas.classList.remove('dragging');
    if (drag.moved) computeAccelerations(state.bodies);
    drag = null;
    pending = null;
    return;
  }
  if (!pending || event.button !== 0) {
    pending = null;
    return;
  }
  const dist = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
  const elapsed = performance.now() - pending.t;
  pending = null;
  if (dist > 6 || elapsed > 450) return;
  if (world.pickBody(event.clientX, event.clientY)) return;
  const hit = world.pickSheet(event.clientX, event.clientY);
  if (!hit) return;
  const result = addBody(state, hit.x, hit.z);
  if (!result.ok) ui.toast(result.reason);
  else ui.refreshSelection();
}

window.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => {
  if (!drag) return;
  world.setControls(true);
  canvas.classList.remove('dragging');
  drag = null;
});

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  const body = world.pickBody(event.clientX, event.clientY);
  if (!body) return;
  const result = removeBody(state, body.id);
  if (!result.ok) ui.toast(result.reason);
  else ui.refreshSelection();
});

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === 'Space') {
    event.preventDefault();
    state.paused = !state.paused;
    ui.pause.setAttribute('aria-pressed', state.paused ? 'true' : 'false');
    ui.pause.textContent = state.paused ? 'Resume' : 'Pause';
  } else if (event.key === 't' || event.key === 'T') {
    state.showTrails = !state.showTrails;
    ui.trails.setAttribute('aria-pressed', state.showTrails ? 'true' : 'false');
  } else if (event.key === 'r' || event.key === 'R') {
    document.getElementById('reset').click();
  } else if (event.key >= '1' && event.key <= '4') {
    const index = Number(event.key) - 1;
    const button = ui.presets.querySelectorAll('.preset')[index];
    if (button) button.click();
  }
});

window.addEventListener('resize', () => world.resize());

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const before = drag?.moved ? drag.id : null;
  advance(state, dt, before);
  world.sync(state, dt, before);
  world.updateCamera(dt);
  world.render();
  ui.sync(state);
  ui.setLabel(world.labelPosition(selectedBody(state)), selectedBody(state)?.name ?? '');
  hideLoader();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
