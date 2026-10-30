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
import { updateLiveLens } from './lens.js';
import { updateLiveWave } from './waves.js';

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
let gesture = null;
const pointers = new Set();
let last = performance.now();
let shown = false;
const LONG_PRESS_MS = 460;
const TAP_PX = 14;

function preventPageZoom(event) {
  if (event.ctrlKey) event.preventDefault();
}
window.addEventListener('wheel', preventPageZoom, { passive: false });
document.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (event) => event.preventDefault(), { passive: false });

function rememberCamera() {
  return {
    position: world.camera.position.clone(),
    target: world.controls.target.clone(),
  };
}

function restoreCamera(shot) {
  if (!shot) return;
  world.camera.position.copy(shot.position);
  world.controls.target.copy(shot.target);
  if (world.controls._sphericalDelta) world.controls._sphericalDelta.set(0, 0, 0);
  if (world.controls._panOffset) world.controls._panOffset.set(0, 0, 0);
  world.controls._scale = 1;
}

function beginMouseDrag(event, body) {
  event.preventDefault();
  event.stopPropagation();
  drag = {
    id: body.id,
    moved: false,
    x: event.clientX,
    y: event.clientY,
  };
  pending = null;
  gesture = null;
  state.selectedId = body.id;
  ui.refreshSelection();
  world.setControls(false);
  world.intro = null;
  canvas.classList.add('dragging');
  canvas.setPointerCapture(event.pointerId);
}

function hideLoader() {
  if (shown) return;
  shown = true;
  loader.classList.add('hide');
}

function moveDraggedBody(event) {
  if (!drag) return;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) drag.moved = true;
  if (!drag.moved) return;
  const hit = world.pickSheet(event.clientX, event.clientY);
  if (!hit) return;
  const body = state.bodies.find((candidate) => candidate.id === drag.id);
  if (!body) return;
  setDraggedPosition(body, hit.x, hit.z, 1 / 60);
  const view = world.views.find((item) => item.id === body.id);
  if (view) view.trail.reset();
}

function finishDrag() {
  if (!drag) return false;
  const removedByHold = gesture?.long && gesture?.body && !drag.moved;
  world.setControls(true);
  canvas.classList.remove('dragging');
  if (removedByHold) {
    const result = removeBody(state, drag.id);
    if (!result.ok) ui.toast(result.reason);
    else ui.refreshSelection();
  } else if (drag.moved) {
    computeAccelerations(state.bodies);
  }
  drag = null;
  pending = null;
  return true;
}

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  pointers.add(event.pointerId);
  const body = world.pickBody(event.clientX, event.clientY);
  if (pointers.size > 1) {
    if (gesture?.timer) window.clearTimeout(gesture.timer);
    if (gesture) gesture.moved = true;
    return;
  }
  if (body && event.pointerType !== 'touch') {
    beginMouseDrag(event, body);
    return;
  }
  gesture = {
    pointerId: event.pointerId,
    type: event.pointerType,
    x: event.clientX,
    y: event.clientY,
    t: performance.now(),
    body,
    moved: false,
    long: false,
    camera: event.pointerType === 'touch' ? rememberCamera() : null,
    timer: null,
  };
  pending = { x: event.clientX, y: event.clientY, t: gesture.t };
  if (body && event.pointerType === 'touch') {
    gesture.timer = window.setTimeout(() => {
      if (!gesture || gesture.moved || pointers.size > 1) return;
      gesture.long = true;
      restoreCamera(gesture.camera);
      world.setControls(false);
      world.intro = null;
      drag = { id: body.id, moved: false, x: gesture.x, y: gesture.y };
      state.selectedId = body.id;
      ui.refreshSelection();
      ui.toast('Drag to move. Release without moving to remove.');
      canvas.classList.add('dragging');
    }, LONG_PRESS_MS);
  }
}, true);

canvas.addEventListener('pointermove', (event) => {
  const hovered = event.pointerType !== 'touch' && world.pickBody(event.clientX, event.clientY);
  canvas.classList.toggle('hovering', Boolean(hovered) && !drag);
  if (gesture && event.pointerId === gesture.pointerId) {
    const dist = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y);
    if (dist > TAP_PX) {
      gesture.moved = true;
      if (gesture.timer && !gesture.long) {
        window.clearTimeout(gesture.timer);
        gesture.timer = null;
      }
    }
  }
  if (drag && (event.pointerId === drag.pointerId || event.pointerId === gesture?.pointerId || event.pointerType !== 'touch')) {
    moveDraggedBody(event);
  }
});

function endDrag(event) {
  if (event.pointerId !== undefined) pointers.delete(event.pointerId);
  if (drag && (gesture?.pointerId === event.pointerId || event.pointerType !== 'touch' || !gesture)) {
    finishDrag();
    if (gesture?.timer) window.clearTimeout(gesture.timer);
    gesture = null;
    return;
  }
  if (!gesture || gesture.pointerId !== event.pointerId) {
    if (!pending || event.button !== 0) {
      pending = null;
      return;
    }
  }
  const source = gesture || pending;
  if (gesture?.timer) window.clearTimeout(gesture.timer);
  const fromGesture = gesture;
  gesture = null;
  pending = null;
  if (!source || event.button !== 0 || pointers.size > 0) return;
  if (fromGesture?.moved) return;
  if (fromGesture?.camera) restoreCamera(fromGesture.camera);
  const dist = Math.hypot(event.clientX - source.x, event.clientY - source.y);
  const elapsed = performance.now() - source.t;
  if (dist > TAP_PX || elapsed > 700) return;
  if (fromGesture?.body || world.pickBody(event.clientX, event.clientY)) {
    const body = fromGesture?.body || world.pickBody(event.clientX, event.clientY);
    if (!body) return;
    state.selectedId = body.id;
    ui.refreshSelection();
    return;
  }
  queueEmptyTap(event.clientX, event.clientY);
}

let lastEmptyTap = 0;
let emptyTapTimer = 0;

function queueEmptyTap(x, y) {
  const now = performance.now();
  if (now - lastEmptyTap < 320) {
    window.clearTimeout(emptyTapTimer);
    emptyTapTimer = 0;
    lastEmptyTap = 0;
    ui.toggleHud();
    return;
  }
  lastEmptyTap = now;
  emptyTapTimer = window.setTimeout(() => {
    emptyTapTimer = 0;
    const hit = world.pickSheet(x, y);
    if (!hit) return;
    const result = addBody(state, hit.x, hit.z);
    if (!result.ok) ui.toast(result.reason);
    else ui.refreshSelection();
  }, 280);
}

window.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', (event) => {
  if (event.pointerId !== undefined) pointers.delete(event.pointerId);
  if (gesture?.timer) window.clearTimeout(gesture.timer);
  gesture = null;
  pending = null;
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
  } else if (event.key === 'h' || event.key === 'H') {
    ui.toggleHud();
  } else if (event.key === 'r' || event.key === 'R') {
    document.getElementById('reset').click();
  } else if (event.key >= '1' && event.key <= '9') {
    const index = Number(event.key) - 1;
    const button = ui.presets.querySelectorAll('.preset')[index];
    if (button) button.click();
  }
});

window.addEventListener('resize', () => world.resize());
window.visualViewport?.addEventListener('resize', () => world.resize());

function frame(now) {
  if (document.hidden) {
    requestAnimationFrame(frame);
    return;
  }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const before = drag?.moved ? drag.id : null;
  advance(state, dt, before);
  updateLiveWave(state);
  updateLiveLens(state);
  world.sync(state, dt, before);
  world.updateCamera(dt);
  world.render();
  ui.sync(state);
  ui.setLabel(world.labelPosition(selectedBody(state)), selectedBody(state)?.name ?? '');
  hideLoader();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

window.__spacetime = {
  camera() {
    return {
      x: world.camera.position.x,
      y: world.camera.position.y,
      z: world.camera.position.z,
      tx: world.controls.target.x,
      ty: world.controls.target.y,
      tz: world.controls.target.z,
    };
  },
};
