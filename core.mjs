/* Renderer, camera, controls and post-processing. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { st, T, $ } from './state.mjs';

export const QUALITY = {
  low: { dpr: 1, shadow: 1024, soft: false, post: false, bloom: false, ao: false, grass: 0, water: 0, trees: 0.7, aa: true },
  medium: { dpr: 1.25, shadow: 2048, soft: false, post: true, bloom: true, ao: false, grass: 28000, water: 256, trees: 1, aa: true },
  high: { dpr: 1.5, shadow: 2048, soft: true, post: true, bloom: true, ao: false, grass: 70000, water: 512, trees: 1, aa: true },
  ultra: { dpr: 2, shadow: 4096, soft: true, post: true, bloom: true, ao: true, grass: 110000, water: 1024, trees: 1, aa: true },
};
export function detectQuality() {
  if (st.opts.quality && QUALITY[st.opts.quality]) return st.opts.quality;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 600;
  let soft = false;
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    soft = /SwiftShader|llvmpipe|Software|Basic Render/i.test(name);
  } catch (e) { /* ignore */ }
  if (soft) return 'low';
  return mobile ? 'medium' : 'high';
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.32 }, uGrain: { value: 0.035 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5; float v = 1.0 - dot(d, d) * uVignette * 2.2;
      c.rgb *= clamp(v, 0.0, 1.0);
      float g = h(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 91.0) - 0.5;
      c.rgb += g * uGrain;
      gl_FragColor = c;
    }`,
};

export function initCore(qname) {
  const Q = QUALITY[qname];
  T.q = Q; T.qname = qname;
  const canvas = $('#view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.aa, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.dpr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xbcd0dc, 0.0014);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.2, 3000);
  camera.position.set(0, 120, 220);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.zoomToCursor = true;
  controls.screenSpacePanning = false;
  controls.minDistance = 1.2;
  controls.maxDistance = 650;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.zoomSpeed = 1.1;
  controls.panSpeed = 1.0;
  controls.rotateSpeed = 0.75;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  Object.assign(T, { THREE, renderer, scene, camera, controls });
  if (Q.post) {
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    if (Q.ao) {
      const ao = new GTAOPass(scene, camera, 1, 1);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1, samples: 12 });
      composer.addPass(ao);
      T.ao = ao;
    }
    if (Q.bloom) { const b = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.28, 0.5, 0.92); composer.addPass(b); T.bloom = b; }
    composer.addPass(new OutputPass());
    const grade = new ShaderPass(GradeShader);
    composer.addPass(grade);
    T.grade = grade;
    T.composer = composer;
  }
  window.addEventListener('resize', resize);
  resize();
}
export function resize() {
  const { renderer, camera, composer } = T;
  const c = renderer.domElement, w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
}
export function render(time) {
  if (T.composer) { if (T.grade) T.grade.uniforms.uTime.value = time; T.composer.render(); }
  else T.renderer.render(T.scene, T.camera);
}
