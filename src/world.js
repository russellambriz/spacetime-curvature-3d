import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GRID_SEGMENTS_DESKTOP, GRID_SEGMENTS_MOBILE, GRID_SIZE, MAX_BODIES } from './constants.js';
import { heightAt } from './height.js';

const GRID_CELL = 1.72;
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
`;

const SHEET_VERT = /* glsl */ `
uniform vec4 uBody[${MAX_BODIES}];
uniform vec4 uExtra[${MAX_BODIES}];
varying vec2 vGrid;
varying float vHeight;
varying float vBh;

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
  vec4 world = modelMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SHEET_FRAG = /* glsl */ `
varying vec2 vGrid;
varying float vHeight;
varying float vBh;
uniform float uHalf;
uniform float uCell;

void main() {
  vec2 coord = vGrid / uCell;
  vec2 fw = max(fwidth(coord), vec2(0.0001));
  vec2 g = abs(fract(coord - 0.5) - 0.5);
  float minor = max(1.0 - smoothstep(0.0, fw.x * 1.2, g.x), 1.0 - smoothstep(0.0, fw.y * 1.2, g.y));
  vec2 coordM = coord / 4.0;
  vec2 fwM = max(fwidth(coordM), vec2(0.0001));
  vec2 gm = abs(fract(coordM - 0.5) - 0.5);
  float major = max(1.0 - smoothstep(0.0, fwM.x * 1.05, gm.x), 1.0 - smoothstep(0.0, fwM.y * 1.05, gm.y));
  float line = clamp(minor * 0.62 + major * 0.95, 0.0, 1.35);
  float radial = 1.0 - smoothstep(uHalf * 0.58, uHalf * 0.98, length(vGrid));
  float slope = clamp(-vHeight / 26.0, 0.0, 1.15);
  vec3 green = vec3(0.16, 1.12, 0.36);
  vec3 magenta = vec3(1.15, 0.32, 0.9);
  vec3 col = mix(green, magenta, clamp(vBh, 0.0, 1.0));
  col *= line * radial * (0.78 + slope * 0.95);
  if (line * radial < 0.035) discard;
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

function sheetGeometry(size, segments) {
  const geo = new THREE.BufferGeometry();
  const n = segments + 1;
  const positions = new Float32Array(n * n * 3);
  let p = 0;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      positions[p] = -size / 2 + (i / segments) * size;
      positions[p + 1] = 0;
      positions[p + 2] = -size / 2 + (j / segments) * size;
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.08, 900);
    this.camera.position.set(24, 18, 28);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 95;
    this.controls.maxPolarAngle = Math.PI * 0.965;
    this.controls.minPolarAngle = 0.06;
    this.controls.zoomSpeed = 0.72;
    this.controls.rotateSpeed = 0.72;
    this.controls.mouseButtons.RIGHT = null;
    this.controls.target.set(0, -2, 0);
    this.controls.addEventListener('start', () => {
      this.intro = null;
    });

    this.glowTexture = makeGlowTexture();
    this.sphere = new THREE.SphereGeometry(1, 64, 48);
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
      samples: 2,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.36, 0.48, 0.26);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  _buildStars() {
    const count = 1800;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const radius = 170 + Math.random() * 360;
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
          gl_PointSize = aSize * vTw * (260.0 / max(1.0, -mv.z));
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
    const mobile = window.matchMedia('(max-width: 800px)').matches;
    const segments = mobile ? GRID_SEGMENTS_MOBILE : GRID_SEGMENTS_DESKTOP;
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
        varying vec2 vLocal;
        uniform float uTime;
        void main() {
          float r = length(vLocal);
          float ang = atan(vLocal.y, vLocal.x);
          float spin = ang - uTime * 1.25;
          float bands = 0.6 + 0.4 * sin(spin * 9.0 + r * 3.4);
          float radial = smoothstep(1.62, 1.92, r) * smoothstep(4.75, 3.15, r);
          vec3 hot = vec3(1.15, 0.42, 0.1);
          vec3 mag = vec3(0.95, 0.14, 0.62);
          vec3 col = mix(hot, mag, 0.5 + 0.5 * sin(spin * 2.0 + r)) * bands;
          col *= 0.55 + 0.6 * smoothstep(-0.15, 1.0, vLocal.x / max(r, 0.001));
          col += vec3(1.0, 0.45, 0.75) * (1.0 - smoothstep(1.85, 2.35, r)) * radial * 0.45;
          if (radial < 0.03) discard;
          gl_FragColor = vec4(col * radial, 1.0);
        }
      `,
    });
    this.disk = new THREE.Mesh(new THREE.RingGeometry(1.7, 4.65, 160, 8), this.diskMat);
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
          float fres = pow(1.0 - abs(dot(normalize(vN), V)), 1.15);
          vec3 col = vec3(1.15, 0.28, 0.95) * (0.4 + fres);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.photon = new THREE.Mesh(new THREE.TorusGeometry(1, 0.022, 12, 96), this.photonMat);
    this.photon.rotation.x = Math.PI / 2;
    this.photon.renderOrder = 2;
    this.photon.frustumCulled = false;
    this.photon.raycast = () => {};
    this.photon.visible = false;
    this.scene.add(this.photon);

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
          vec3 col = mix(uLimb, uCore, pow(ndv, 0.48));
          float n = noise(vObj * 4.6 + vec3(uTime * 0.11, uTime * 0.04, 0.2));
          col *= 0.86 + 0.22 * n;
          col += uCore * pow(n, 4.0) * 0.16;
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
        void main() {
          vec3 N = normalize(vNormal);
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 La = normalize(uLightA - vWorld);
          float ndl = clamp(dot(N, La), 0.0, 1.0);
          vec3 albedo = uAlbedo;
          float atmo = 0.8;
          if (uStyle > 0.5 && uStyle < 1.5) {
            float n = noise(vObj * 6.0);
            float crater = smoothstep(0.73, 0.88, noise(vObj * 15.0));
            albedo = vec3(0.48, 0.43, 0.36) * (0.72 + 0.45 * n) * (1.0 - 0.5 * crater);
            atmo = 0.0;
          } else if (uStyle > 1.5 && uStyle < 2.5) {
            float n = noise(vObj * 2.4 + 3.0);
            albedo = mix(vec3(0.72, 0.55, 0.28), vec3(0.98, 0.88, 0.62), n);
            atmo = 1.35;
          } else if (uStyle < 3.5) {
            float n = noise(vObj * 3.15);
            float n2 = noise(vObj * 8.0);
            float land = smoothstep(0.5, 0.64, n);
            vec3 ocean = mix(vec3(0.02, 0.12, 0.36), vec3(0.08, 0.4, 0.68), ndl);
            vec3 ground = mix(vec3(0.14, 0.4, 0.18), vec3(0.46, 0.38, 0.2), smoothstep(0.5, 0.82, n2));
            albedo = mix(ocean, ground, land);
            float pole = smoothstep(0.64, 0.9, abs(vObj.y));
            albedo = mix(albedo, vec3(0.86, 0.92, 0.97), pole);
            float cities = pow(noise(vObj * 22.0), 8.0) * land * (1.0 - smoothstep(0.0, 0.18, ndl));
            albedo += vec3(1.0, 0.78, 0.4) * cities * 0.7;
            atmo = 0.95;
          } else if (uStyle < 4.5) {
            float n = noise(vObj * 3.5);
            albedo = mix(vec3(0.45, 0.16, 0.08), vec3(0.75, 0.32, 0.16), n);
            float cap = smoothstep(0.74, 0.93, abs(vObj.y));
            albedo = mix(albedo, vec3(0.92, 0.94, 0.96), cap);
            atmo = 0.35;
          } else {
            albedo = uAlbedo * (0.8 + 0.32 * noise(vObj * 4.2));
          }
          vec3 col = albedo * (0.14 + 0.9 * ndl);
          if (uUseB > 0.5) {
            float d2 = clamp(dot(N, normalize(uLightB - vWorld)), 0.0, 1.0);
            col += albedo * d2 * 0.45;
          }
          float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.3);
          vec3 atmoColor = uAtmosphere;
          if (uStyle > 1.5 && uStyle < 2.5) atmoColor = vec3(1.05, 0.78, 0.38);
          else if (uStyle > 2.5 && uStyle < 3.5) atmoColor = vec3(0.35, 0.72, 1.2);
          else if (uStyle > 3.5 && uStyle < 4.5) atmoColor = vec3(0.9, 0.42, 0.24);
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
      view.pick.scale.setScalar(Math.max(body.radius * 2.5, 0.85));
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
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.setSize(Math.max(1, width * 0.7), Math.max(1, height * 0.7));
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
    for (let i = 0; i < 84; i += 1) {
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
        if (Math.abs(this._hit.x) > 56 || Math.abs(this._hit.z) > 56) return null;
        return { x: this._hit.x, z: this._hit.z };
      }
      prevSide = side;
      prevT = t;
      const step = Math.min(1.45, Math.max(0.12, Math.abs(side) * 0.36));
      t += step;
      if (t > 260) break;
    }
    if (this.raycaster.ray.intersectPlane(this.plane, this._planeHit)) {
      if (Math.abs(this._planeHit.x) < 50 && Math.abs(this._planeHit.z) < 50) {
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
