// Small hand-built models for traffic, transit and people. Real sizes in metres, origin on the ground, +Z forward.
// Each vertex carries a colour and a tint flag: tinted parts take the instance colour (paint, clothes), the rest
// keep their own (glass, tyres, lamps, skin).
import * as THREE from 'three';

const lin = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const GLASS = lin('#1d252b'), TYRE = lin('#161616'), WHITE = [1, 1, 1], CHROME = lin('#b9bcc0'), HEAD = lin('#fff3d0'), TAIL = lin('#c0261c'), DARK = lin('#2b2d30');

class G {
  constructor() { this.p = []; this.n = []; this.c = []; this.t = []; this.s = []; this.swing = [0, 0]; }
  v(x, y, z, nx, ny, nz, col, tint) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); this.t.push(tint); this.s.push(this.swing[0], this.swing[1]); }
  quad(a, b, c, d, col, tint) { // counter-clockwise seen from outside
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const q of [a, b, c, a, c, d]) this.v(q[0], q[1], q[2], nx, ny, nz, col, tint);
  }
  box(x0, y0, z0, x1, y1, z1, col, tint = 0) {
    const P = (x, y, z) => [x, y, z];
    this.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), col, tint); this.quad(P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), col, tint);
    this.quad(P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), col, tint); this.quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), col, tint);
    this.quad(P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0), col, tint); this.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), col, tint);
  }
  // side profile [[z, y], ...] (clockwise seen from the +X side, starting low at the back), pushed out from x0 to x1
  prism(prof, x0, x1, col, tint = 0) {
    const n = prof.length;
    for (let i = 0; i < n; i++) { const a = prof[i], b = prof[(i + 1) % n]; this.quad([x0, a[1], a[0]], [x0, b[1], b[0]], [x1, b[1], b[0]], [x1, a[1], a[0]], col, tint); }
    for (let i = 1; i + 1 < n; i++) {
      for (const q of [prof[0], prof[i], prof[i + 1]]) this.v(x1, q[1], q[0], 1, 0, 0, col, tint);
      for (const q of [prof[0], prof[i + 1], prof[i]]) this.v(x0, q[1], q[0], -1, 0, 0, col, tint);
    }
  }
  wheel(x, y, z, r, w, col = TYRE) { // axle along X
    const N = 10;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2, y0 = y + Math.sin(a0) * r, z0 = z + Math.cos(a0) * r, y1 = y + Math.sin(a1) * r, z1 = z + Math.cos(a1) * r;
      this.quad([x - w, y0, z0], [x + w, y0, z0], [x + w, y1, z1], [x - w, y1, z1], col, 0);
      for (const sx of [-1, 1]) { const q = [[x + sx * w, y, z], [x + sx * w, y0, z0], [x + sx * w, y1, z1]]; if (sx > 0) q.reverse(); for (const k of q) this.v(k[0], k[1], k[2], sx, 0, 0, col, 0); }
    }
  }
  drum(cx, y0, cz, r, y1, col, tint = 0, r1 = r) { // upright cylinder
    const N = 10;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      this.quad([cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r], [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1], [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1], col, tint);
      for (const q of [[cx, y1, cz], [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1], [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1]]) this.v(q[0], q[1], q[2], 0, 1, 0, col, tint);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.t, 1)); g.setAttribute('aSwing', new THREE.Float32BufferAttribute(this.s, 2));
    g.computeBoundingSphere(); return g;
  }
}

// Lambert material where only flagged vertices take the instance colour. walk: uniform {value: seconds} to swing limbs.
export function tintMaterial(walk = null) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    if (walk) sh.uniforms.uWalk = walk;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\nattribute float aTint; attribute vec2 aSwing; ${walk ? 'uniform float uWalk;' : ''}`)
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\n vColor.rgb = mix(color.rgb, vColor.rgb, aTint);\n#endif')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${walk ? `#ifdef USE_INSTANCING
          float ph = uWalk * 8.5 + instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
          if (aSwing.x != 0.0) { float a = sin(ph) * 0.6 * aSwing.x, cy = transformed.y - aSwing.y; transformed.y = aSwing.y + cy * cos(a); transformed.z += -cy * sin(a); }
          transformed.y += abs(sin(ph)) * 0.035;
        #endif` : ''}`);
  };
  return m;
}

function wheels(g, hw, r, zs, w = 0.13) { for (const z of zs) for (const sx of [-1, 1]) g.wheel(sx * (hw - w), r, z, r, w); }
function lamps(g, hw, yF, zF, yR, zR) {
  for (const sx of [-1, 1]) { g.box(sx * hw * 0.72 - 0.2, yF - 0.07, zF - 0.02, sx * hw * 0.72 + 0.2, yF + 0.07, zF + 0.03, HEAD); g.box(sx * hw * 0.72 - 0.22, yR - 0.07, zR - 0.03, sx * hw * 0.72 + 0.22, yR + 0.07, zR + 0.02, TAIL); }
}
export function sedan() {
  const g = new G(), hw = 0.88;
  g.prism([[-2.22, 0.3], [-2.22, 0.82], [-1.75, 0.9], [-1.25, 0.92], [-0.82, 1.4], [0.42, 1.42], [1.02, 0.94], [2.0, 0.84], [2.22, 0.7], [2.22, 0.3]], -hw, hw, WHITE, 1);
  g.prism([[-1.18, 0.96], [-0.8, 1.36], [0.4, 1.38], [0.93, 0.97]], -hw - 0.012, hw + 0.012, GLASS);                       // side glass
  g.prism([[-1.31, 0.9], [-0.86, 1.4], [-0.8, 1.4], [-1.25, 0.9]], -hw + 0.12, hw - 0.12, GLASS); g.prism([[0.42, 1.43], [0.46, 1.43], [1.08, 0.94], [1.02, 0.94]], -hw + 0.12, hw - 0.12, GLASS); // rear glass, windscreen
  wheels(g, hw + 0.01, 0.32, [-1.38, 1.38]); lamps(g, hw, 0.72, 2.22, 0.74, -2.22); g.box(-hw + 0.1, 0.3, 2.2, hw - 0.1, 0.46, 2.27, DARK); g.box(-hw + 0.1, 0.3, -2.27, hw - 0.1, 0.46, -2.2, DARK);
  return g.build();
}
export function suv(dome = false) {
  const g = new G(), hw = 0.94;
  g.prism([[-2.28, 0.36], [-2.28, 1.0], [-2.1, 1.62], [0.5, 1.68], [1.12, 1.08], [2.1, 0.98], [2.3, 0.82], [2.3, 0.36]], -hw, hw, WHITE, 1);
  g.prism([[-2.02, 1.1], [-1.9, 1.56], [0.46, 1.62], [1.0, 1.12]], -hw - 0.012, hw + 0.012, GLASS);
  g.prism([[-2.3, 1.02], [-2.14, 1.6], [-2.08, 1.6], [-2.24, 1.02]], -hw + 0.12, hw - 0.12, GLASS); g.prism([[0.5, 1.69], [0.55, 1.69], [1.18, 1.08], [1.12, 1.08]], -hw + 0.12, hw - 0.12, GLASS);
  wheels(g, hw + 0.01, 0.37, [-1.42, 1.45], 0.15); lamps(g, hw, 0.86, 2.3, 0.95, -2.28); g.box(-hw + 0.1, 0.36, 2.28, hw - 0.1, 0.54, 2.35, DARK);
  if (dome) { // driverless: roof sensor dome and corner pods
    g.box(-0.42, 1.68, -0.5, 0.42, 1.76, 0.3, DARK); g.drum(0, 1.76, -0.1, 0.24, 2.0, DARK, 0, 0.2); g.drum(0, 2.0, -0.1, 0.2, 2.06, CHROME);
    for (const sx of [-1, 1]) for (const z of [-2.2, 2.2]) g.drum(sx * (hw - 0.02), 0.9, z, 0.09, 1.06, DARK);
  }
  return g.build();
}
export function van() {
  const g = new G(), hw = 1.0;
  g.prism([[-2.7, 0.4], [-2.7, 2.3], [0.9, 2.3], [1.2, 2.1], [1.75, 1.3], [2.7, 1.15], [2.7, 0.4]], -hw, hw, WHITE, 1);
  g.prism([[1.0, 1.36], [1.0, 2.0], [1.22, 2.0], [1.68, 1.36]], -hw - 0.012, hw + 0.012, GLASS); g.prism([[1.2, 2.11], [1.25, 2.11], [1.8, 1.3], [1.75, 1.3]], -hw + 0.12, hw - 0.12, GLASS);
  wheels(g, hw + 0.01, 0.4, [-1.7, 1.75], 0.16); lamps(g, hw, 0.95, 2.7, 0.9, -2.7); g.box(-hw + 0.1, 0.4, 2.68, hw - 0.1, 0.58, 2.76, DARK);
  return g.build();
}
export function pickup() {
  const g = new G(), hw = 0.96;
  g.prism([[-2.7, 0.42], [-2.7, 1.1], [-0.5, 1.1], [-0.42, 1.72], [0.75, 1.74], [1.28, 1.12], [2.5, 1.04], [2.7, 0.85], [2.7, 0.42]], -hw, hw, WHITE, 1);
  g.prism([[-0.32, 1.16], [-0.3, 1.66], [0.7, 1.68], [1.16, 1.16]], -hw - 0.012, hw + 0.012, GLASS); g.prism([[0.75, 1.75], [0.8, 1.75], [1.34, 1.12], [1.28, 1.12]], -hw + 0.12, hw - 0.12, GLASS);
  g.box(-hw + 0.1, 1.1, -2.6, hw - 0.1, 1.12, -0.6, DARK);
  wheels(g, hw + 0.01, 0.4, [-1.75, 1.7], 0.16); lamps(g, hw, 0.9, 2.7, 0.95, -2.7);
  return g.build();
}
// Transit: sized to the line type's [width, height, length]. The tinted band takes the line colour.
export function bus() { // 2.7 x 3.0 x 11.5
  const g = new G(), hw = 1.3, L = 5.75, silver = lin('#c9cbc8'), roof = lin('#e2e0d8');
  g.prism([[-L, 0.42], [-L, 2.9], [L - 0.5, 2.9], [L, 2.3], [L, 0.42]], -hw, hw, silver); g.box(-hw + 0.15, 2.9, -L + 0.6, hw - 0.15, 3.12, L - 2, roof);
  g.box(-hw - 0.012, 1.42, -L + 0.4, hw + 0.012, 2.34, L - 0.9, GLASS); g.box(-hw + 0.1, 1.3, L - 0.02, hw - 0.1, 2.3, L + 0.012, GLASS); g.box(-hw + 0.25, 1.5, -L - 0.012, hw - 0.25, 2.2, -L + 0.02, GLASS);
  g.box(-hw - 0.014, 0.95, -L, hw + 0.014, 1.3, L - 0.04, WHITE, 1); g.box(-hw + 0.3, 2.46, L - 0.3, hw - 0.3, 2.78, L - 0.22, lin('#f0a43a'));
  wheels(g, hw + 0.01, 0.48, [-3.6, 3.7], 0.2); lamps(g, hw, 0.75, L, 0.8, -L);
  return g.build();
}
export function cableCar() { // 2.4 x 3.1 x 8.4
  const g = new G(), hw = 1.15, L = 4.2, cream = lin('#e6dcc0'), wood = lin('#6a4a36'), brass = lin('#b8923f');
  g.box(-hw, 0.5, -L, hw, 0.85, L, WHITE, 1); g.box(-hw + 0.05, 0.3, -L + 0.3, hw - 0.05, 0.5, L - 0.3, DARK);
  g.box(-hw, 0.85, -L * 0.42, hw, 2.3, L * 0.42, WHITE, 1); g.box(-hw - 0.012, 1.45, -L * 0.4, hw + 0.012, 2.12, L * 0.4, GLASS); // closed saloon
  for (const sz of [-1, 1]) { g.box(-hw + 0.1, 0.85, sz * L * 0.5, hw - 0.1, 1.3, sz * L * 0.9, wood); for (const sx of [-1, 1]) for (const z of [L * 0.44, L * 0.94]) g.box(sx * (hw - 0.07) - 0.05, 0.85, sz * z - 0.05, sx * (hw - 0.07) + 0.05, 2.5, sz * z + 0.05, brass); g.box(-hw + 0.1, 0.85, sz * L - 0.06 * sz - 0.06, hw - 0.1, 1.5, sz * L - 0.06 * sz + 0.06, WHITE, 1); }
  g.prism([[-L - 0.1, 2.5], [-L + 0.5, 2.82], [L - 0.5, 2.82], [L + 0.1, 2.5]], -hw - 0.08, hw + 0.08, cream); g.box(-hw * 0.5, 2.82, -L * 0.7, hw * 0.5, 3.02, L * 0.7, cream);
  wheels(g, hw - 0.1, 0.3, [-2.6, 2.6], 0.12); g.box(-0.12, 2.0, L + 0.02, 0.12, 2.24, L + 0.1, HEAD);
  return g.build();
}
export function tram() { // 2.7 x 3.5 x 23: two cars and a joint
  const g = new G(), hw = 1.32, silver = lin('#c4c7c6'), grey = lin('#5a5f62');
  for (const s of [-1, 1]) {
    const z0 = s < 0 ? -11.4 : 0.5, z1 = s < 0 ? -0.5 : 11.4, nose = s < 0 ? z0 : z1, dir = s;
    g.box(-hw, 0.45, z0, hw, 3.25, z1, silver); g.box(-hw - 0.012, 1.5, z0 + 0.6, hw + 0.012, 2.55, z1 - 0.6, GLASS); g.box(-hw - 0.014, 0.9, z0, hw + 0.014, 1.36, z1, WHITE, 1);
    g.box(-hw + 0.2, 1.4, nose + (dir > 0 ? -0.02 : -0.012), hw - 0.2, 2.6, nose + (dir > 0 ? 0.012 : 0.02), GLASS); g.box(-hw + 0.2, 3.25, z0 + 1, hw - 0.2, 3.5, z1 - 1, grey);
    for (const sx of [-1, 1]) g.box(sx * hw * 0.7 - 0.18, 0.75, nose - 0.03, sx * hw * 0.7 + 0.18, 0.9, nose + 0.03, dir > 0 ? HEAD : TAIL);
    wheels(g, hw - 0.05, 0.36, [z0 + 2.2, z1 - 2.2], 0.14);
  }
  g.box(-hw + 0.12, 0.6, -0.5, hw - 0.12, 3.1, 0.5, DARK); g.box(-0.05, 3.5, 3.5, 0.05, 4.3, 3.6, DARK); g.box(-0.6, 4.3, 3.3, 0.6, 4.36, 3.8, DARK); // joint and pantograph
  return g.build();
}
export function ferry() { // 8.5 x 5.5 x 34
  const g = new G(), hw = 4.25, L = 17, hull = lin('#ece9e0'), deck = lin('#d8d4c8'), blue = lin('#2f4a6a');
  g.prism([[-L, 0.2], [-L, 2.4], [L - 4, 2.4], [L, 2.9], [L - 2.5, 0.2]], -hw, hw, hull); g.box(-hw - 0.02, 0.2, -L, hw + 0.02, 1.0, L - 2.6, blue);
  g.box(-hw + 0.5, 2.4, -L + 2.5, hw - 0.5, 4.9, L - 7, hull); g.box(-hw + 0.48, 2.9, -L + 3, hw - 0.48, 3.9, L - 7.5, GLASS); g.box(-hw - 0.02, 2.2, -L, hw + 0.02, 2.45, L - 4, WHITE, 1);
  g.box(-hw + 1.3, 4.9, -L + 5, hw - 1.3, 7.1, L - 12, hull); g.box(-hw + 1.28, 5.4, -L + 5.5, hw - 1.28, 6.4, L - 12.5, GLASS); g.box(-hw + 1.1, 7.1, -L + 4.6, hw - 1.1, 7.3, L - 11.6, deck);
  g.drum(0, 7.3, -3, 0.9, 9.6, WHITE, 1, 0.8); g.drum(0, 9.6, -3, 0.82, 9.9, DARK); g.box(-0.06, 7.3, L - 13, 0.06, 10.4, L - 12.9, DARK);
  return g.build();
}
// People: about 1.7 m tall. Legs and arms swing about hip and shoulder when the walk uniform runs.
export function person(scooter = false) {
  const g = new G(), skin = lin('#c99c7a'), hair = lin('#2e2620'), trouser = lin('#343a48'), shoe = lin('#1c1c1e');
  const limb = (sign, pivot, f) => { g.swing = scooter ? [0, 0] : [sign, pivot]; f(); g.swing = [0, 0]; };
  g.box(-0.2, 0.82, -0.11, 0.2, 1.42, 0.12, WHITE, 1);                                    // torso
  g.box(-0.1, 1.44, -0.1, 0.1, 1.66, 0.11, skin); g.box(-0.11, 1.6, -0.12, 0.11, 1.7, 0.06, hair);  // head and hair
  limb(1, 0.84, () => { g.box(-0.19, 0.06, -0.08, -0.03, 0.84, 0.08, trouser); g.box(-0.19, 0, -0.08, -0.03, 0.07, 0.16, shoe); });
  limb(-1, 0.84, () => { g.box(0.03, 0.06, -0.08, 0.19, 0.84, 0.08, trouser); g.box(0.03, 0, -0.08, 0.19, 0.07, 0.16, shoe); });
  limb(-0.8, 1.38, () => { g.box(-0.29, 0.8, -0.06, -0.2, 1.4, 0.06, WHITE, 1); g.box(-0.29, 0.72, -0.05, -0.2, 0.8, 0.05, skin); });
  limb(0.8, 1.38, () => { g.box(0.2, 0.8, -0.06, 0.29, 1.4, 0.06, WHITE, 1); g.box(0.2, 0.72, -0.05, 0.29, 0.8, 0.05, skin); });
  if (scooter) { g.box(-0.09, 0.0, -0.45, 0.09, 0.06, 0.5, DARK); g.box(-0.03, 0.06, 0.42, 0.03, 1.1, 0.48, DARK); g.box(-0.24, 1.08, 0.41, 0.24, 1.13, 0.49, DARK); g.wheel(0, 0.09, 0.52, 0.09, 0.03); g.wheel(0, 0.09, -0.46, 0.09, 0.03); }
  return g.build();
}
