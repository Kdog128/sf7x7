// Orbit-style city camera: target on the ground, distance, yaw and pitch, with damping.
import * as THREE from 'three';
import { MAP, heightAt } from './terrain.js';
import { clamp } from './util.js';

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3(1800, 0, -1200); this.dist = 9000; this.yaw = 0.35; this.pitch = 0.9; // pitch: angle above the horizon
    this.gTarget = this.target.clone(); this.gDist = this.dist; this.gYaw = this.yaw; this.gPitch = this.pitch;
    this.minDist = 45; this.maxDist = 30000;
  }
  set(x, z, dist, yaw, pitch, snap = true) {
    this.gTarget.set(x, 0, z); this.gDist = dist; this.gYaw = yaw; this.gPitch = pitch;
    if (snap) { this.target.copy(this.gTarget); this.target.y = Math.max(heightAt(x, z), 0); this.dist = dist; this.yaw = yaw; this.pitch = pitch; this.apply(); }
  }
  offset(dist, yaw, pitch, out) { const c = Math.cos(pitch); return out.set(Math.sin(yaw) * c * dist, Math.sin(pitch) * dist, Math.cos(yaw) * c * dist); }
  // Pan by a world-space delta on the ground plane.
  panWorld(dx, dz) { this.gTarget.x = clamp(this.gTarget.x + dx, MAP.minX, MAP.maxX); this.gTarget.z = clamp(this.gTarget.z + dz, MAP.minZ, MAP.maxZ); }
  panImmediate(dx, dz) { this.panWorld(dx, dz); this.target.x = this.gTarget.x; this.target.z = this.gTarget.z; }
  // Zoom by factor, keeping the ground point under the given ray direction fixed.
  zoom(factor, rayDir) {
    const nd = clamp(this.gDist * factor, this.minDist, this.maxDist);
    if (rayDir && rayDir.y < -0.02) {
      const u = this.offset(1, this.gYaw, this.gPitch, _v1);
      const k = _v2.copy(u).addScaledVector(rayDir, -u.y / rayDir.y);
      this.panWorld((this.gDist - nd) * k.x, (this.gDist - nd) * k.z);
    }
    this.gDist = nd;
  }
  rotate(dyaw, dpitch) { this.gYaw += dyaw; this.gPitch = clamp(this.gPitch + dpitch, 0.14, 1.553); }
  update(dt) {
    const k = 1 - Math.exp(-dt * 14);
    this.target.x += (this.gTarget.x - this.target.x) * k; this.target.z += (this.gTarget.z - this.target.z) * k;
    this.dist *= Math.pow(this.gDist / this.dist, k);
    this.yaw += (this.gYaw - this.yaw) * k; this.pitch += (this.gPitch - this.pitch) * k;
    const gy = Math.max(heightAt(this.target.x, this.target.z), 0);
    this.target.y += (gy - this.target.y) * (1 - Math.exp(-dt * 6));
    this.apply();
  }
  apply() {
    const cam = this.camera;
    this.offset(this.dist, this.yaw, this.pitch, _v1);
    cam.position.copy(this.target).add(_v1);
    const floor = Math.max(heightAt(cam.position.x, cam.position.z), 0) + 6;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.near = clamp(this.dist * 0.03, 1, 120); cam.far = 150000;
    cam.lookAt(this.target); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  }
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
