// Final image: bloom for lights, then a light colour grade. Skipped on Low graphics.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uLift: { value: new THREE.Vector3(0, 0, 0) }, uSat: { value: 1 }, uVig: { value: 0.2 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 uTint, uLift; uniform float uSat, uVig; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat) * uTint + uLift * (1.0 - smoothstep(0.0, 0.5, l));   // tint, and a colour cast in the shadows only
      vec2 d = vUv - 0.5; c *= 1.0 - uVig * smoothstep(0.25, 0.95, dot(d, d) * 2.0);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export function makePost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.6, 0.9); composer.addPass(bloom);
  const grade = new ShaderPass(GRADE); composer.addPass(grade);
  composer.addPass(new OutputPass());
  const DAY = new THREE.Vector3(1.035, 1.0, 0.95), NIGHT_REAL = new THREE.Vector3(0.98, 1.0, 1.05), NIGHT_NEON = new THREE.Vector3(0.96, 0.98, 1.1), ZERO = new THREE.Vector3(0, 0, 0), LIFT_NEON = new THREE.Vector3(0.012, 0.0, 0.028), LIFT_REAL = new THREE.Vector3(0.004, 0.003, 0.008);
  return {
    enabled: true,
    setSize(w, h, pr) { composer.setPixelRatio(pr); composer.setSize(w, h); },
    // night: 0..1, golden: 0..1 (low sun), neon: stylized night mode
    update(night, golden, neon) {
      bloom.strength = neon ? 0.12 + 0.62 * night : 0.1 + 0.3 * night; bloom.radius = neon ? 0.72 : 0.5;
      bloom.threshold = neon ? 0.95 - 0.13 * night : 0.95 - 0.1 * night;
      const u = grade.uniforms; u.uTint.value.copy(DAY).lerp(neon ? NIGHT_NEON : NIGHT_REAL, night); u.uTint.value.x += 0.03 * golden; u.uTint.value.z -= 0.03 * golden;
      u.uLift.value.copy(ZERO).lerp(neon ? LIFT_NEON : LIFT_REAL, night); u.uSat.value = 1.06 + 0.06 * golden + (neon ? 0.16 : 0.02) * night; u.uVig.value = 0.16 + 0.14 * night;
    },
    render() { composer.render(); },
  };
}
