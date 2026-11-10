// Sky dome, sun/moon lighting, haze, sea surface and the day/night palette.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './util.js';

const col = (h) => new THREE.Color(h);
// keyed on sun height (sin of elevation)
const KEYS = [
  { s: -0.30, zen: col('#070b16'), hor: col('#141b2b'), sun: col('#8ea4cc'), si: 0.42, hemiS: col('#3a4a6b'), hemiG: col('#12151c'), hi: 0.42 },
  { s: -0.08, zen: col('#1c2947'), hor: col('#4b4a63'), sun: col('#8ea4cc'), si: 0.25, hemiS: col('#57628a'), hemiG: col('#1c1d24'), hi: 0.6 },
  { s: 0.02, zen: col('#3f5683'), hor: col('#d79a78'), sun: col('#ff9d5c'), si: 0.9, hemiS: col('#9a93a8'), hemiG: col('#3a332d'), hi: 0.85 },
  { s: 0.14, zen: col('#5a7cab'), hor: col('#e6c6a3'), sun: col('#ffc890'), si: 2.3, hemiS: col('#c0c6d2'), hemiG: col('#5a5245'), hi: 1.0 },
  { s: 0.40, zen: col('#6a8fbd'), hor: col('#cdd5d8'), sun: col('#fff1dc'), si: 3.1, hemiS: col('#d3dde8'), hemiG: col('#746d5d'), hi: 1.15 },
  { s: 1.00, zen: col('#6c93c4'), hor: col('#c6d1d8'), sun: col('#fff6e8'), si: 3.3, hemiS: col('#d6e0ec'), hemiG: col('#7a7362'), hi: 1.2 },
];

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    this.sunDir = new THREE.Vector3(0, 1, 0); this.lightDir = new THREE.Vector3(0, 1, 0);
    this.zen = new THREE.Color(); this.hor = new THREE.Color(); this.night = 0; this.sunH = 1;
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x777777, 1); scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xc6d1d8, 0.00004);

    this.skyU = { uZen: { value: this.zen }, uHor: { value: this.hor }, uSun: { value: this.sunDir }, uSunCol: { value: new THREE.Color() }, uNight: { value: 0 } };
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }',
      fragmentShader: `varying vec3 vD; uniform vec3 uZen, uHor, uSun, uSunCol; uniform float uNight;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
          vec3 d = normalize(vD); float up = max(d.y, 0.0);
          vec3 c = mix(uHor, uZen, pow(up, 0.42));
          c = mix(c, uHor * 0.9, smoothstep(0.0, -0.08, d.y));
          float sd = max(dot(d, uSun), 0.0);
          c += uSunCol * (pow(sd, 900.0) * 6.0 + pow(sd, 24.0) * 0.22 * (1.0 - uNight)) * step(-0.02, uSun.y + 0.06);
          vec2 sp = vec2(atan(d.z, d.x) * 180.0, asin(clamp(d.y, -1.0, 1.0)) * 180.0);
          float st = step(0.9985, h(floor(sp))) * smoothstep(0.02, 0.2, d.y) * (0.5 + 0.5 * h(floor(sp) + 3.0));
          c += vec3(0.9, 0.95, 1.0) * st * uNight * 1.4;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    dome.frustumCulled = false; dome.renderOrder = -1000; scene.add(dome);

    this.waterU = { uTime: { value: 0 }, uZen: { value: this.zen }, uHor: { value: this.hor }, uSun: { value: this.lightDir }, uSunCol: { value: new THREE.Color() },
      uFogD: { value: 0.00004 }, uNight: { value: 0 } };
    const water = new THREE.Mesh(new THREE.PlaneGeometry(160000, 160000), new THREE.ShaderMaterial({
      uniforms: this.waterU, transparent: true, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `varying vec3 vW; uniform float uTime, uFogD, uNight; uniform vec3 uZen, uHor, uSun, uSunCol;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        float wave(vec2 p){ return n(p * 0.045 + uTime * vec2(0.05, 0.03)) + 0.5 * n(p * 0.13 - uTime * vec2(0.07, 0.04)) + 0.25 * n(p * 0.41 + uTime * 0.11); }
        void main(){
          vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
          float amp = 1.0 / (1.0 + dist * 0.0009);
          float e = 1.5; float w0 = wave(vW.xz);
          vec3 N = normalize(vec3((w0 - wave(vW.xz + vec2(e, 0.0))) * amp * 0.55, 1.0, (w0 - wave(vW.xz + vec2(0.0, e))) * amp * 0.55));
          float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 R = reflect(-V, N);
          vec3 sky = mix(uHor, uZen, pow(max(R.y, 0.0), 0.42));
          vec3 body = mix(vec3(0.045, 0.085, 0.10), vec3(0.10, 0.16, 0.18), 0.5 + 0.5 * (w0 - 0.9)) * (0.25 + 0.75 * (1.0 - uNight));
          vec3 c = mix(body, sky, clamp(fres, 0.0, 1.0) * 0.85);
          c += uSunCol * pow(max(dot(R, uSun), 0.0), 220.0) * 1.6 * amp;
          float fog = 1.0 - exp(-uFogD * uFogD * dist * dist);
          c = mix(c, uHor, fog);
          gl_FragColor = vec4(c, mix(0.86, 1.0, clamp(fres + fog, 0.0, 1.0)));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    water.rotation.x = -Math.PI / 2; water.renderOrder = 5; scene.add(water);
    this.water = water;
  }

  // hour: 0..24
  setTime(hour) {
    const a = ((hour - 6) / 12) * Math.PI, lat = 0.66;
    this.sunDir.set(Math.cos(a), Math.sin(a) * Math.cos(lat), Math.sin(a) * Math.sin(lat)).normalize();
    const s = this.sunDir.y; this.sunH = s;
    let k = 0; while (k < KEYS.length - 2 && s > KEYS[k + 1].s) k++;
    const A = KEYS[k], B = KEYS[k + 1], t = clamp((s - A.s) / (B.s - A.s), 0, 1);
    this.zen.lerpColors(A.zen, B.zen, t); this.hor.lerpColors(A.hor, B.hor, t);
    this.sun.color.lerpColors(A.sun, B.sun, t); this.sun.intensity = lerp(A.si, B.si, t);
    this.hemi.color.lerpColors(A.hemiS, B.hemiS, t); this.hemi.groundColor.lerpColors(A.hemiG, B.hemiG, t); this.hemi.intensity = lerp(A.hi, B.hi, t);
    this.night = 1 - smoothstep(-0.12, 0.1, s);
    // below the horizon the moon takes over as the key light
    if (s > -0.03) this.lightDir.copy(this.sunDir); else this.lightDir.set(-this.sunDir.x * 0.6, 0.55 + 0.3 * -s, -this.sunDir.z * 0.6 - 0.3).normalize();
    if (this.lightDir.y < 0.09) { this.lightDir.y = 0.09; this.lightDir.normalize(); }
    this.scene.fog.color.copy(this.hor);
    this.skyU.uSunCol.value.copy(this.sun.color).multiplyScalar(s > -0.03 ? 1 : 0);
    this.skyU.uNight.value = this.night; this.waterU.uNight.value = this.night;
    this.waterU.uSunCol.value.copy(this.sun.color).multiplyScalar(this.sun.intensity * 0.35);
  }

  // Keep the shadow frustum centred on what the camera looks at.
  update(camera, target, dist, time) {
    const fogD = Math.min(0.000042, 0.42 / Math.max(dist, 1));
    this.scene.fog.density = fogD; this.waterU.uFogD.value = fogD; this.waterU.uTime.value = time;
    const S = clamp(dist * 0.85, 220, 4200), cam = this.sun.shadow.camera;
    if (cam.right !== S) { cam.left = -S; cam.right = S; cam.top = S; cam.bottom = -S; cam.near = 10; cam.far = S * 8 + 2500; cam.updateProjectionMatrix(); }
    const texel = (2 * S) / this.sun.shadow.mapSize.x;
    const tx = Math.round(target.x / texel) * texel, tz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(tx, target.y, tz);
    this.sun.position.set(tx, target.y, tz).addScaledVector(this.lightDir, S * 4 + 1200);
    this.sun.target.updateMatrixWorld();
  }
}
