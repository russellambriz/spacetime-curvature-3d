import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  choosePixelRatio,
  GRID_SEGMENTS_DESKTOP,
  GRID_SEGMENTS_MOBILE,
  GRID_SEGMENTS_TABLET,
  GRID_SIZE,
  MAX_BODIES,
} from './constants.js';
import { heightAt } from './height.js';

const GRID_CELL = 2.15;
const STYLE_ID = { generic: 0, mercury: 1, venus: 2, earth: 3, mars: 4 };

const NOISE = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.02 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return v;
}
`;

const SHEET_VERT = /* glsl */ `
uniform vec4 uBody[${MAX_BODIES}];
uniform vec4 uExtra[${MAX_BODIES}];
varying vec2 vGrid;
varying float vHeight;
varying float vBh;
varying vec3 vWorld;

float flammHeight(float r, float rs, float depthScale) {
  float R0 = rs * 14.0;
  float mouth = rs * 1.03;
  float rOut = max(r, mouth);
  float w = 2.0 * sqrt(max(rs * (rOut - rs), 0.0));
  float w0 = 2.0 * sqrt(max(rs * (R0 - rs), 0.0));
  float h = (w - w0) * depthScale;
  if (r < mouth) {
    float t = (mouth - r) / max(rs, 0.0001);
    h -= w0 * depthScale * (t * 0.55 + t * t * 0.35);
  }
  return h;
}

float sheetHeight(vec2 p) {
  float h = 0.0;
  float bh = 0.0;
  for (int i = 0; i < ${MAX_BODIES}; i++) {
    vec4 b = uBody[i];
    vec4 e = uExtra[i];
    vec2 d = p - b.xy;
    float r = length(d);
    if (e.x > 0.5) {
      float rs = max(e.y, 0.0001);
      h += flammHeight(r, rs, b.z);
      bh = max(bh, 1.0 - smoothstep(rs * 1.15, rs * 6.5, r));
    } else {
      h += -b.z / sqrt(r * r + b.w * b.w);
    }
  }
  vBh = bh;
  return h;
}

void main() {
  vec3 pos = position;
  vGrid = pos.xz;
  float h = sheetHeight(pos.xz);
  vHeight = h;
  pos.y = h;
  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorld = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const SHEET_FRAG = /* glsl */ `
varying vec2 vGrid;
varying float vHeight;
varying float vBh;
varying vec3 vWorld;
uniform float uHalf;
uniform float uCell;

void main() {
  vec2 fw = max(fwidth(vGrid), vec2(0.0001));
  float density = max(fw.x, fw.y) / uCell;
  vec2 coord = vGrid / uCell;
  vec2 g = abs(fract(coord - 0.5) - 0.5);
  float wx = min(max(fw.x / uCell, 0.0015) * 1.2, 0.048);
  float wy = min(max(fw.y / uCell, 0.0015) * 1.2, 0.048);
  float minor = max(1.0 - smoothstep(0.0, wx, g.x), 1.0 - smoothstep(0.0, wy, g.y));
  vec2 gm = abs(fract(coord / 5.0 - 0.5) - 0.5);
  float mx = max(wx * 0.85, 0.004);
  float my = max(wy * 0.85, 0.004);
  float major = max(1.0 - smoothstep(0.0, max(mx, 0.001), gm.x), 1.0 - smoothstep(0.0, max(my, 0.001), gm.y));
  float alias = 1.0 - smoothstep(0.2, 0.46, density);
  float aliasMajor = 1.0 - smoothstep(0.42, 0.82, density);
  float line = minor * 0.72 * alias + major * aliasMajor;
  float radial = 1.0 - smoothstep(uHalf * 0.38, uHalf * 0.97, length(vGrid));
  float distFade = 1.0 - smoothstep(70.0, 250.0, length(vWorld - cameraPosition));
  float fade = radial * distFade;
  float slope = clamp(-vHeight / 24.0, 0.0, 1.0);
  vec3 green = vec3(0.14, 1.08, 0.36);
  vec3 magenta = vec3(1.15, 0.3, 0.88);
  vec3 col = mix(green, magenta, clamp(vBh, 0.0, 1.0));
  col *= line * fade * (0.7 + slope * 0.65);
  if (line * fade < 0.028) discard;
  gl_FragColor = vec4(col, 1.0);
}
`;

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.72)');
  gradient.addColorStop(0.42, 'rgba(255,255,255,0.16)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function warpAxis(t) {
  const sign = Math.sign(t) || 1;
  return sign * Math.abs(t) ** 1.7;
}

function gridSegmentsForViewport() {
  const width = window.innerWidth;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (width < 760) return GRID_SEGMENTS_MOBILE;
  if (coarse || width < 1280) return GRID_SEGMENTS_TABLET;
  return GRID_SEGMENTS_DESKTOP;
}

function sheetGeometry(size, segments) {
  const geo = new THREE.BufferGeometry();
  const n = segments + 1;
  const positions = new Float32Array(n * n * 3);
  let p = 0;
  const half = size / 2;
  for (let j = 0; j < n; j += 1) {
    const z = warpAxis(-1 + (2 * j) / segments) * half;
    for (let i = 0; i < n; i += 1) {
      const x = warpAxis(-1 + (2 * i) / segments) * half;
      positions[p] = x;
      positions[p + 1] = 0;
      positions[p + 2] = z;
      p += 3;
    }
  }
  const index = [];
  for (let j = 0; j < segments; j += 1) {
    for (let i = 0; i < segments; i += 1) {
      const a = j * n + i;
      index.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

class Trail {
  constructor(color, width) {
    this.max = 640;
    this.width = width;
    this.color = color;
    this.samples = [];
    this.last = null;
    this.dirty = false;
    const positions = new Float32Array(this.max * 2 * 3);
    const colors = new Float32Array(this.max * 2 * 3);
    const indices = [];
    for (let i = 0; i < this.max - 1; i += 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geo.setIndex(indices);
    this.geo.setDrawRange(0, 0);
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.raycast = () => {};
  }

  reset() {
    this.samples.length = 0;
    this.last = null;
    this.geo.setDrawRange(0, 0);
  }

  push(x, y, z, visible) {
    if (this.last) {
      const dx = x - this.last[0];
      const dy = y - this.last[1];
      const dz = z - this.last[2];
      if (dx * dx + dy * dy + dz * dz < 0.006) return;
    }
    this.samples.push(x, y, z);
    this.last = [x, y, z];
    const cap = this.max * 3;
    if (this.samples.length > cap) this.samples.splice(0, this.samples.length - cap);
    this.dirty = true;
    if (visible) this.rebuild();
  }

  setVisible(visible) {
    const hasLine = this.samples.length >= 6;
    this.mesh.visible = visible && hasLine;
    if (visible && this.dirty) this.rebuild();
  }

  rebuild() {
    const n = this.samples.length / 3;
    this.dirty = false;
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      this.mesh.visible = false;
      return;
    }
    const pos = this.geo.attributes.position.array;
    const col = this.geo.attributes.color.array;
    const width = this.width;
    let prevPx = 0;
    let prevPz = 0;
    for (let i = 0; i < n; i += 1) {
      const x = this.samples[i * 3];
      const y = this.samples[i * 3 + 1];
      const z = this.samples[i * 3 + 2];
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      let dx = this.samples[i1 * 3] - this.samples[i0 * 3];
      let dz = this.samples[i1 * 3 + 2] - this.samples[i0 * 3 + 2];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      let px = -dz;
      let pz = dx;
      if (i > 0 && px * prevPx + pz * prevPz < 0) {
        px = -px;
        pz = -pz;
      }
      prevPx = px;
      prevPz = pz;
      const fade = (i / (n - 1)) ** 1.35;
      const r = this.color[0] * fade;
      const g = this.color[1] * fade;
      const b = this.color[2] * fade;
      const o = i * 6;
      pos[o] = x + px * width;
      pos[o + 1] = y + 0.07;
      pos[o + 2] = z + pz * width;
      pos[o + 3] = x - px * width;
      pos[o + 4] = y + 0.07;
      pos[o + 5] = z - pz * width;
      col[o] = r;
      col[o + 1] = g;
      col[o + 2] = b;
      col[o + 3] = r;
      col[o + 4] = g;
      col[o + 5] = b;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
  }
}

function buildTube() {
  const radial = 22;
  const rings = 14;
  const positions = [];
  const colors = [];
  const top = [0.35, 1.05, 0.62];
  const bot = [1.15, 0.28, 0.82];
  for (let i = 0; i < rings; i += 1) {
    const y = -i / (rings - 1);
    const t = i / (rings - 1);
    const col = [
      top[0] + (bot[0] - top[0]) * t,
      top[1] + (bot[1] - top[1]) * t,
      top[2] + (bot[2] - top[2]) * t,
    ];
    for (let j = 0; j < radial; j += 1) {
      const a0 = (j / radial) * Math.PI * 2;
      const a1 = ((j + 1) / radial) * Math.PI * 2;
      positions.push(Math.cos(a0), y, Math.sin(a0), Math.cos(a1), y, Math.sin(a1));
      colors.push(...col, ...col);
    }
  }
  for (let j = 0; j < radial; j += 1) {
    const a = (j / radial) * Math.PI * 2;
    const x = Math.cos(a);
    const z = Math.sin(a);
    positions.push(x, 0, z, x, -1, z);
    colors.push(...top, ...bot);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 1;
  lines.raycast = () => {};
  lines.visible = false;
  return lines;
}

export class World {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.state = state;
    this.ok = false;
    this.views = [];
    this.viewKey = '';
    this.intro = null;
    this.timeUniform = { value: 0 };
    this.lightA = { value: new THREE.Vector3(0, 8, 0) };
    this.lightB = { value: new THREE.Vector3(0, 8, 0) };
    this.useB = { value: 0 };
    this.bodyUniforms = Array.from({ length: MAX_BODIES }, () => new THREE.Vector4());
    this.extraUniforms = Array.from({ length: MAX_BODIES }, () => new THREE.Vector4());
    this._ndc = new THREE.Vector2();
    this._hit = new THREE.Vector3();
    this._planeHit = new THREE.Vector3();
    this._proj = new THREE.Vector3();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Mesh = { threshold: 0 };

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
        failIfMajorPerformanceCaveat: false,
      });
    } catch {
      return;
    }
    this.renderer = renderer;
    this.ok = true;
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setPixelRatio(choosePixelRatio());

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.08, 2800);
    this.camera.position.set(24, 18, 28);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 220;
    this.controls.maxPolarAngle = Math.PI * 0.965;
    this.controls.minPolarAngle = 0.08;
    this.controls.zoomSpeed = 0.85;
    this.controls.rotateSpeed = 0.7;
    this.controls.panSpeed = 0.85;
    this.controls.screenSpacePanning = true;
    this.controls.enablePan = true;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.controls.mouseButtons.RIGHT = null;
    this.controls.target.set(0, -2, 0);
    this.controls.addEventListener('start', () => {
      this.intro = null;
    });
    canvas.addEventListener('wheel', (event) => {
      if (!this.controls.enabled) return;
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.intro = null;
      this.controls._pan(event.deltaX * 0.9, event.deltaY * 0.9);
    }, { passive: false, capture: true });

    this.glowTexture = makeGlowTexture();
    this.sphere = new THREE.SphereGeometry(1, 72, 56);
    this._buildShellMaterials();
    this._buildStars();
    this._buildSheet();
    this._buildBlackHoleExtras();
    this._buildSelectionRing();
    this._buildComposer();
    this.resize();
  }

  _buildComposer() {
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 0,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.36, 0.48, 0.26);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  _buildShellMaterials() {
    const shellVert = /* glsl */ `
      varying vec3 vObj;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vObj = position;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `;
    this.coronaMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.FrontSide,
      vertexShader: shellVert,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          vec3 N = normalize(vNormal);
          vec3 V = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 1.55);
          vec3 col = vec3(1.0, 0.42, 0.08) * fres * 0.7 + vec3(1.0, 0.78, 0.4) * pow(fres, 4.0) * 0.45;
          if (fres < 0.04) discard;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.timeUniform,
        uLightA: this.lightA,
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
      vertexShader: shellVert,
      fragmentShader: /* glsl */ `
        ${NOISE}
        varying vec3 vObj;
        varying vec3 vWorld;
        varying vec3 vNormal;
        uniform float uTime;
        uniform vec3 uLightA;
        void main() {
          float n = fbm(vObj * 3.6 + vec3(uTime * 0.012, 0.2, uTime * 0.008));
          float cloud = smoothstep(0.42, 0.66, n);
          vec3 N = normalize(vNormal);
          vec3 L = normalize(uLightA - vWorld);
          float ndl = clamp(dot(N, L), 0.0, 1.0);
          vec3 col = vec3(0.82, 0.9, 0.98) * (0.22 + 0.95 * ndl);
          if (cloud < 0.05) discard;
          gl_FragColor = vec4(col, cloud * 0.88);
        }
      `,
    });
  }

  _buildStars() {
    const count = 1800;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const radius = 820 + Math.random() * 520;
      const theta = Math.acos(2 * Math.random() - 1);
      const phi = Math.random() * Math.PI * 2;
      positions[i * 3] = radius * Math.sin(theta) * Math.cos(phi);
      positions[i * 3 + 1] = radius * Math.cos(theta) * 0.72;
      positions[i * 3 + 2] = radius * Math.sin(theta) * Math.sin(phi);
      const tint = Math.random();
      if (tint > 0.92) {
        colors.set([0.75, 0.86, 1], i * 3);
      } else if (tint > 0.84) {
        colors.set([1, 0.86, 0.7], i * 3);
      } else {
        const v = 0.72 + Math.random() * 0.45;
        colors.set([v, v, v], i * 3);
      }
      sizes[i] = 1.5 + Math.random() * 3.1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.timeUniform },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute vec3 aColor;
        varying vec3 vColor;
        varying float vTw;
        uniform float uTime;
        void main() {
          vColor = aColor;
          vTw = 0.8 + 0.2 * sin(uTime * 0.65 + position.x * 0.11 + position.z * 0.05);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * vTw * (520.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vTw;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float alpha = smoothstep(0.5, 0.08, d);
          gl_FragColor = vec4(vColor * alpha * vTw * 1.45, 1.0);
        }
      `,
    });
    this.starfield = new THREE.Points(geo, mat);
    this.starfield.renderOrder = -2;
    this.starfield.frustumCulled = false;
    this.scene.add(this.starfield);
  }

  _buildSheet() {
    const segments = gridSegmentsForViewport();
    const geo = sheetGeometry(GRID_SIZE, segments);
    this.sheetMat = new THREE.ShaderMaterial({
      uniforms: {
        uBody: { value: this.bodyUniforms },
        uExtra: { value: this.extraUniforms },
        uHalf: { value: GRID_SIZE * 0.5 },
        uCell: { value: GRID_CELL },
      },
      vertexShader: SHEET_VERT,
      fragmentShader: SHEET_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      extensions: { derivatives: true },
    });
    this.sheet = new THREE.Mesh(geo, this.sheetMat);
    this.sheet.frustumCulled = false;
    this.sheet.renderOrder = 1;
    this.sheet.raycast = () => {};
    this.scene.add(this.sheet);
  }

  _buildBlackHoleExtras() {
    this.diskMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.timeUniform },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vLocal;
        void main() {
          vLocal = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${NOISE}
        varying vec2 vLocal;
        uniform float uTime;
        void main() {
          float r = length(vLocal);
          float ang = atan(vLocal.y, vLocal.x);
          float spin = ang * 2.4 - uTime * 1.5 - r * 0.65;
          float turb = fbm(vec3(cos(spin) * 1.4, sin(spin) * 1.4, r * 0.85 + uTime * 0.05));
          float radial = smoothstep(1.52, 1.82, r) * smoothstep(5.35, 3.15, r);
          float t = smoothstep(1.7, 4.8, r);
          vec3 hot = vec3(1.4, 0.78, 0.32);
          vec3 mid = vec3(1.05, 0.32, 0.08);
          vec3 mag = vec3(0.78, 0.1, 0.48);
          vec3 col = mix(hot, mix(mid, mag, smoothstep(0.35, 1.0, t)), t);
          col *= 0.55 + 0.85 * turb;
          float doppler = 0.5 + 0.95 * smoothstep(-1.0, 1.0, vLocal.x / max(r, 0.001));
          col *= doppler;
          float inner = exp(-pow((r - 1.72) * 1.55, 2.0));
          col += vec3(1.25, 0.92, 0.72) * inner * 1.35;
          if (radial < 0.025) discard;
          gl_FragColor = vec4(col * radial, 1.0);
        }
      `,
    });
    this.disk = new THREE.Mesh(new THREE.RingGeometry(1.55, 5.2, 192, 10), this.diskMat);
    this.disk.rotation.x = -Math.PI / 2 + 0.32;
    this.disk.renderOrder = 2;
    this.disk.frustumCulled = false;
    this.disk.raycast = () => {};
    this.disk.visible = false;
    this.scene.add(this.disk);

    this.photonMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vW;
        void main() {
          vec3 V = normalize(cameraPosition - vW);
          float rim = pow(1.0 - abs(dot(normalize(vN), V)), 2.4);
          vec3 col = vec3(1.45, 0.78, 1.15) * (0.35 + rim * 1.8);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.photon = new THREE.Mesh(new THREE.TorusGeometry(1, 0.011, 16, 128), this.photonMat);
    this.photon.rotation.x = Math.PI / 2;
    this.photon.renderOrder = 2;
    this.photon.frustumCulled = false;
    this.photon.raycast = () => {};
    this.photon.visible = false;
    this.scene.add(this.photon);

    this.sharpMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vLocal;
        void main() {
          vLocal = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vLocal;
        void main() {
          float r = length(vLocal);
          float line = exp(-pow((r - 1.0) * 36.0, 2.0));
          vec3 col = vec3(1.35, 0.9, 1.2) * line * 1.8;
          if (line < 0.04) discard;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sharpRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.12, 160), this.sharpMat);
    this.sharpRing.rotation.x = -Math.PI / 2;
    this.sharpRing.renderOrder = 3;
    this.sharpRing.frustumCulled = false;
    this.sharpRing.raycast = () => {};
    this.sharpRing.visible = false;
    this.scene.add(this.sharpRing);

    this.tube = buildTube();
    this.scene.add(this.tube);
  }

  _buildSelectionRing() {
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.014, 8, 80),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.55, 1.25, 0.82),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.renderOrder = 4;
    this.ring.frustumCulled = false;
    this.ring.raycast = () => {};
    this.scene.add(this.ring);
  }

  makeStarMaterial(body) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.timeUniform,
        uCore: { value: new THREE.Vector3(...body.core) },
        uLimb: { value: new THREE.Vector3(...body.limb) },
      },
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying vec3 vObj;
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          vObj = position;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        ${NOISE}
        varying vec3 vObj;
        varying vec3 vWorld;
        varying vec3 vNormal;
        uniform float uTime;
        uniform vec3 uCore;
        uniform vec3 uLimb;
        void main() {
          vec3 N = normalize(vNormal);
          vec3 V = normalize(cameraPosition - vWorld);
          float ndv = clamp(dot(N, V), 0.0, 1.0);
          float g1 = fbm(vObj * 3.3 + vec3(uTime * 0.04, uTime * 0.017, 0.4));
          float g2 = fbm(vObj * 8.2 - vec3(uTime * 0.06, 0.3, uTime * 0.025));
          float cells = smoothstep(0.3, 0.78, g1);
          vec3 col = mix(uLimb * 0.9, uCore, pow(ndv, 0.52));
          col *= 0.72 + 0.42 * cells;
          col += vec3(1.15, 0.62, 0.22) * pow(g2, 4.0) * 0.5;
          col += uLimb * pow(1.0 - ndv, 1.7) * 0.62;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
  }

  makePlanetMaterial(body) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uStyle: { value: STYLE_ID[body.style] ?? 0 },
        uAlbedo: { value: new THREE.Vector3(...(body.albedo ?? [0.45, 0.62, 0.9])) },
        uAtmosphere: { value: new THREE.Vector3(...(body.atmosphere ?? [0.45, 0.72, 1])) },
        uLightA: this.lightA,
        uLightB: this.lightB,
        uUseB: this.useB,
        uTime: this.timeUniform,
      },
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying vec3 vObj;
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          vObj = position;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        ${NOISE}
        varying vec3 vObj;
        varying vec3 vWorld;
        varying vec3 vNormal;
        uniform float uStyle;
        uniform vec3 uAlbedo;
        uniform vec3 uAtmosphere;
        uniform vec3 uLightA;
        uniform vec3 uLightB;
        uniform float uUseB;
        uniform float uTime;
        void main() {
          vec3 N = normalize(vNormal);
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 La = normalize(uLightA - vWorld);
          float ndl = clamp(dot(N, La), 0.0, 1.0);
          float wrap = clamp(dot(N, La) * 0.62 + 0.38, 0.0, 1.0);
          vec3 albedo = uAlbedo;
          float atmo = 0.8;
          float ocean = 0.0;
          if (uStyle > 0.5 && uStyle < 1.5) {
            float n = fbm(vObj * 5.2);
            float crater = smoothstep(0.6, 0.8, noise(vObj * 12.0));
            float rays = smoothstep(0.76, 0.93, noise(vObj * 19.0));
            albedo = vec3(0.58, 0.52, 0.46) * (0.62 + 0.55 * n);
            albedo *= 1.0 - 0.58 * crater;
            albedo += vec3(0.78, 0.72, 0.62) * rays * 0.4;
            atmo = 0.0;
          } else if (uStyle > 1.5 && uStyle < 2.5) {
            float bands = fbm(vec3(vObj.x * 1.4, vObj.y * 7.0, vObj.z * 1.4) + vec3(0.0, uTime * 0.02, 0.0));
            albedo = mix(vec3(0.68, 0.46, 0.18), vec3(0.98, 0.84, 0.48), bands);
            albedo *= 0.88 + 0.2 * noise(vObj * 9.0);
            atmo = 1.7;
          } else if (uStyle > 2.5 && uStyle < 3.5) {
            float n = fbm(vObj * 2.5);
            float n2 = fbm(vObj * 6.8);
            float land = smoothstep(0.46, 0.6, n);
            vec3 sea = mix(vec3(0.015, 0.09, 0.28), vec3(0.06, 0.36, 0.68), wrap);
            sea += vec3(0.2, 0.45, 0.5) * smoothstep(0.58, 0.82, n2) * 0.22;
            vec3 ground = mix(vec3(0.1, 0.36, 0.14), vec3(0.45, 0.36, 0.18), smoothstep(0.35, 0.8, n2));
            ground = mix(ground, vec3(0.22, 0.32, 0.16), smoothstep(0.62, 0.9, noise(vObj * 13.0)));
            albedo = mix(sea, ground, land);
            float pole = smoothstep(0.7, 0.92, abs(vObj.y));
            albedo = mix(albedo, vec3(0.92, 0.95, 0.98), pole * 0.92);
            float cities = pow(noise(vObj * 30.0), 12.0) * land * (1.0 - smoothstep(0.0, 0.22, ndl));
            albedo += vec3(1.0, 0.84, 0.48) * cities * 1.3;
            atmo = 1.15;
            ocean = 1.0 - land;
          } else if (uStyle > 3.5 && uStyle < 4.5) {
            float n = fbm(vObj * 3.1);
            float dark = smoothstep(0.52, 0.78, noise(vObj * 4.2 + 3.0));
            albedo = mix(vec3(0.55, 0.2, 0.08), vec3(0.8, 0.36, 0.16), n);
            albedo = mix(albedo, vec3(0.32, 0.12, 0.07), dark * 0.7);
            float cap = smoothstep(0.76, 0.94, abs(vObj.y));
            albedo = mix(albedo, vec3(0.95, 0.93, 0.9), cap);
            atmo = 0.32;
          } else {
            albedo = uAlbedo * (0.78 + 0.36 * fbm(vObj * 4.0));
          }
          vec3 col = albedo * (0.08 + 0.95 * wrap);
          if (uUseB > 0.5) {
            float d2 = clamp(dot(N, normalize(uLightB - vWorld)) * 0.6 + 0.4, 0.0, 1.0);
            col += albedo * d2 * 0.42;
          }
          vec3 H = normalize(La + V);
          float spec = pow(clamp(dot(N, H), 0.0, 1.0), 56.0) * ocean;
          col += vec3(0.75, 0.88, 1.0) * spec * ndl * 0.7;
          float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.15);
          vec3 atmoColor = uAtmosphere;
          if (uStyle > 1.5 && uStyle < 2.5) atmoColor = vec3(1.05, 0.78, 0.36);
          else if (uStyle > 2.5 && uStyle < 3.5) atmoColor = vec3(0.4, 0.74, 1.25);
          else if (uStyle > 3.5 && uStyle < 4.5) atmoColor = vec3(0.95, 0.48, 0.26);
          col += atmoColor * fres * atmo;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
  }

  makeBlackHoleMaterial() {
    if (this.bhMaterial) return this.bhMaterial;
    this.bhMaterial = new THREE.ShaderMaterial({
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          vec3 N = normalize(vNormal);
          vec3 V = normalize(cameraPosition - vWorld);
          float ndv = clamp(dot(N, V), 0.0, 1.0);
          float fres = pow(1.0 - ndv, 1.25);
          vec3 col = vec3(1.25, 0.1, 0.72) * fres * fres * 1.7;
          float ring = exp(-pow((fres - 0.62) * 3.4, 2.0));
          col += vec3(1.4, 0.62, 1.05) * ring * 0.55;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    return this.bhMaterial;
  }

  seedTrail(view, bodies) {
    const body = view.body;
    let cx = 0;
    let cz = 0;
    let mass = 0;
    for (let i = 0; i < bodies.length; i += 1) {
      cx += bodies[i].x * bodies[i].simMass;
      cz += bodies[i].z * bodies[i].simMass;
      mass += bodies[i].simMass;
    }
    if (mass <= 0) return;
    cx /= mass;
    cz /= mass;
    const dx = body.x - cx;
    const dz = body.z - cz;
    const radius = Math.hypot(dx, dz);
    const speed = Math.hypot(body.vx, body.vz);
    if (radius < 0.45 || speed < 0.02) return;
    const omega = (dx * body.vz - dz * body.vx) / (radius * radius);
    const direction = Math.sign(omega) || 1;
    const angle = Math.atan2(dz, dx);
    const span = 2.15;
    const steps = 96;
    const samples = [];
    for (let i = steps; i >= 1; i -= 1) {
      const a = angle - direction * span * (i / steps);
      const x = cx + Math.cos(a) * radius;
      const z = cz + Math.sin(a) * radius;
      samples.push(x, heightAt(x, z, bodies, body.id) + 0.16, z);
    }
    const headY = heightAt(body.x, body.z, bodies, body.id) + 0.16;
    samples.push(body.x, headY, body.z);
    view.trail.samples = samples;
    view.trail.last = [body.x, headY, body.z];
    view.trail.dirty = true;
    view.trail.rebuild();
    view.seeded = true;
  }

  rebuild(state) {
    for (let i = 0; i < this.views.length; i += 1) {
      const view = this.views[i];
      this.scene.remove(view.group);
      this.scene.remove(view.trail.mesh);
      view.trail.dispose();
      view.pick.material.dispose();
      view.glow.material.dispose();
      if (view.ownsMaterial) view.material.dispose();
    }
    this.views = [];
    for (let i = 0; i < state.bodies.length; i += 1) {
      const body = state.bodies[i];
      const group = new THREE.Group();
      let material;
      let ownsMaterial = true;
      if (body.kind === 'blackhole') {
        material = this.makeBlackHoleMaterial();
        ownsMaterial = false;
      } else if (body.kind === 'star') {
        material = this.makeStarMaterial(body);
      } else {
        material = this.makePlanetMaterial(body);
      }
      const mesh = new THREE.Mesh(this.sphere, material);
      mesh.renderOrder = 0;
      const pickMat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      });
      const pick = new THREE.Mesh(this.sphere, pickMat);
      pick.userData.body = body;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: new THREE.Color(body.glow),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        opacity: body.kind === 'star' ? 0.9 : 0.75,
      }));
      glow.renderOrder = 4;
      glow.raycast = () => {};
      let corona = null;
      let clouds = null;
      if (body.kind === 'star') {
        corona = new THREE.Mesh(this.sphere, this.coronaMat);
        corona.raycast = () => {};
        corona.renderOrder = 2;
        group.add(corona);
      }
      if (body.style === 'earth') {
        clouds = new THREE.Mesh(this.sphere, this.cloudMat);
        clouds.raycast = () => {};
        clouds.renderOrder = 2;
        group.add(clouds);
      }
      group.add(mesh);
      group.add(pick);
      group.add(glow);
      const trail = new Trail(body.trailColor, body.trailWidth);
      this.scene.add(group);
      this.scene.add(trail.mesh);
      this.views.push({
        id: body.id,
        body,
        group,
        mesh,
        pick,
        glow,
        corona,
        clouds,
        material,
        ownsMaterial,
        trail,
      });
    }
  }

  sync(state, dt, dragging) {
    const key = state.bodies.map((body) => body.id).join('|');
    if (key !== this.viewKey) {
      this.rebuild(state);
      this.viewKey = key;
    }
    this.timeUniform.value += dt;
    this.starfield.rotation.y += dt * 0.012;
    const stars = [];
    for (let i = 0; i < state.bodies.length; i += 1) {
      if (state.bodies[i].kind === 'star') stars.push(state.bodies[i]);
    }
    stars.sort((a, b) => b.massKg - a.massKg);
    if (stars[0]) {
      const y = heightAt(stars[0].x, stars[0].z, state.bodies);
      this.lightA.value.set(stars[0].x, y + stars[0].radius, stars[0].z);
    } else {
      this.lightA.value.set(0, 30, 0);
    }
    this.useB.value = stars[1] ? 1 : 0;
    if (stars[1]) {
      const y = heightAt(stars[1].x, stars[1].z, state.bodies);
      this.lightB.value.set(stars[1].x, y + stars[1].radius, stars[1].z);
    }

    let blackHole = null;
    for (let i = 0; i < this.views.length; i += 1) {
      const view = this.views[i];
      const body = state.bodies.find((candidate) => candidate.id === view.id);
      if (!body) continue;
      view.body = body;
      view.pick.userData.body = body;
      const y = body.kind === 'blackhole'
        ? heightAt(body.x + body.displayHorizon * 1.03, body.z, state.bodies)
        : heightAt(body.x, body.z, state.bodies) + body.radius * 0.2;
      body.displayY = y;
      view.group.position.set(body.x, y, body.z);
      view.mesh.scale.setScalar(Math.max(body.radius, 0.05));
      const touch = window.matchMedia('(pointer: coarse)').matches;
      view.pick.scale.setScalar(Math.max(body.radius * (touch ? 3.4 : 2.6), touch ? 1.2 : 0.9));
      if (view.corona) view.corona.scale.setScalar(Math.max(body.radius * 1.55, 0.2));
      if (view.clouds) {
        view.clouds.scale.setScalar(Math.max(body.radius * 1.055, 0.06));
        view.clouds.rotation.y = body.spin * 1.2;
      }
      const glowSize = Math.max(body.radius * body.glowScale, body.kind === 'blackhole' ? 3.2 : 1);
      view.glow.scale.set(glowSize, glowSize, 1);
      if (!state.paused) body.spin += dt * body.spinRate;
      view.mesh.rotation.y = body.spin;
      view.mesh.rotation.z = body.tilt || 0;
      if (body.trail) {
        if (!view.seeded && Math.hypot(body.vx, body.vz) > 0.02) {
          this.seedTrail(view, state.bodies);
        }
        const record = !state.paused || dragging === body.id;
        if (record) {
          const trailY = heightAt(body.x, body.z, state.bodies, body.id) + 0.16;
          view.trail.push(body.x, trailY, body.z, state.showTrails);
        }
        view.trail.setVisible(state.showTrails);
      } else {
        view.trail.setVisible(false);
      }
      if (body.kind === 'blackhole') blackHole = body;
    }

    const selected = state.bodies.find((body) => body.id === state.selectedId);
    if (selected && Number.isFinite(selected.displayY)) {
      const y = selected.displayY;
      this.ring.visible = true;
      this.ring.position.set(selected.x, y, selected.z);
      const s = Math.max(selected.radius * 1.85, 0.7);
      this.ring.scale.set(s, s, s);
    } else {
      this.ring.visible = false;
    }

    this.disk.visible = Boolean(blackHole);
    this.photon.visible = Boolean(blackHole);
    this.sharpRing.visible = Boolean(blackHole);
    this.tube.visible = Boolean(blackHole);
    if (blackHole) {
      const rs = Math.max(blackHole.displayHorizon, 0.08);
      const mouth = heightAt(blackHole.x + rs * 1.03, blackHole.z, state.bodies);
      const diskR = rs * 2.7;
      const diskY = heightAt(blackHole.x + diskR, blackHole.z, state.bodies);
      this.disk.position.set(blackHole.x, diskY + 0.05, blackHole.z);
      this.disk.scale.setScalar(rs);
      const photonR = rs * 1.5;
      const photonY = heightAt(blackHole.x + photonR, blackHole.z, state.bodies);
      this.photon.position.set(blackHole.x, photonY, blackHole.z);
      this.photon.scale.setScalar(photonR);
      this.sharpRing.position.set(blackHole.x, photonY + 0.02, blackHole.z);
      this.sharpRing.scale.setScalar(photonR);
      const length = Math.max(8, rs * 6.5);
      this.tube.scale.set(rs * 0.58, length, rs * 0.58);
      this.tube.position.set(blackHole.x, mouth - blackHole.radius * 0.15, blackHole.z);
    }

    for (let i = 0; i < MAX_BODIES; i += 1) {
      const body = state.bodies[i];
      if (!body) {
        this.bodyUniforms[i].set(0, 0, 0, 1);
        this.extraUniforms[i].set(0, 0, 0, 0);
      } else if (body.kind === 'blackhole') {
        this.bodyUniforms[i].set(body.x, body.z, body.visualStrength || 1, 1);
        this.extraUniforms[i].set(1, Math.max(body.displayHorizon, 0.08), 0, 0);
      } else {
        this.bodyUniforms[i].set(body.x, body.z, body.visualStrength, Math.max(body.softening, 0.05));
        this.extraUniforms[i].set(0, 0, 0, 0);
      }
    }
  }

  frameCamera(state, animate) {
    const toP = new THREE.Vector3(...state.camera.position);
    const toT = new THREE.Vector3(...state.camera.target);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduce) {
      this.camera.position.copy(toP);
      this.controls.target.copy(toT);
      this.intro = null;
      return;
    }
    const fromP = toP.clone().add(new THREE.Vector3(6.5, 7.5, 8));
    this.camera.position.copy(fromP);
    this.controls.target.copy(toT.clone().setY(toT.y + 2));
    this.intro = {
      fromP,
      toP,
      fromT: this.controls.target.clone(),
      toT,
      t: 0,
      dur: 1.45,
    };
  }

  updateCamera(dt) {
    this.controls.update();
    if (!this.intro) return;
    this.intro.t += dt / this.intro.dur;
    const k = this.intro.t >= 1 ? 1 : 1 - (1 - this.intro.t) ** 3;
    this.camera.position.lerpVectors(this.intro.fromP, this.intro.toP, k);
    this.controls.target.lerpVectors(this.intro.fromT, this.intro.toT, k);
    if (this.intro.t >= 1) this.intro = null;
  }

  render() {
    this.composer.render();
  }

  setControls(enabled) {
    this.controls.enabled = enabled;
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const pr = choosePixelRatio();
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(width, height);
    this.bloom.setSize(Math.max(1, Math.floor(width * pr * 0.5)), Math.max(1, Math.floor(height * pr * 0.5)));
  }

  clientToNdc(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    this._ndc.x = ((x - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((y - rect.top) / rect.height) * 2 + 1;
    return this._ndc;
  }

  pickBody(x, y) {
    this.clientToNdc(x, y);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    const picks = this.views.map((view) => view.pick);
    const hits = this.raycaster.intersectObjects(picks, false);
    if (!hits.length) return null;
    return hits[0].object.userData.body ?? null;
  }

  pickSheet(x, y) {
    this.clientToNdc(x, y);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    let t = 0.2;
    let prevSide = null;
    let prevT = t;
    for (let i = 0; i < 110; i += 1) {
      this._hit.copy(direction).multiplyScalar(t).add(origin);
      const h = heightAt(this._hit.x, this._hit.z, this.state.bodies);
      const side = this._hit.y - h;
      if (prevSide !== null && prevSide > 0 && side <= 0) {
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 10; k += 1) {
          const mid = (lo + hi) * 0.5;
          this._hit.copy(direction).multiplyScalar(mid).add(origin);
          const hm = heightAt(this._hit.x, this._hit.z, this.state.bodies);
          if (this._hit.y > hm) lo = mid;
          else hi = mid;
        }
        this._hit.copy(direction).multiplyScalar(hi).add(origin);
        if (Math.abs(this._hit.x) > 96 || Math.abs(this._hit.z) > 96) return null;
        return { x: this._hit.x, z: this._hit.z };
      }
      prevSide = side;
      prevT = t;
      const step = Math.min(2.4, Math.max(0.15, Math.abs(side) * 0.4));
      t += step;
      if (t > 640) break;
    }
    if (this.raycaster.ray.intersectPlane(this.plane, this._planeHit)) {
      if (Math.abs(this._planeHit.x) < 96 && Math.abs(this._planeHit.z) < 96) {
        return { x: this._planeHit.x, z: this._planeHit.z };
      }
    }
    return null;
  }

  labelPosition(body) {
    if (!body || !Number.isFinite(body.displayY)) return null;
    this._proj.set(body.x, body.displayY + Math.max(body.radius, 0.4) * 1.8, body.z);
    this._proj.project(this.camera);
    if (this._proj.z > 1) return null;
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    return {
      x: (this._proj.x * 0.5 + 0.5) * width,
      y: (-this._proj.y * 0.5 + 0.5) * height,
    };
  }
}
