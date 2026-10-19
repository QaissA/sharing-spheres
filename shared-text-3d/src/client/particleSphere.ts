import * as THREE from 'three';
import { vertexShader, fragmentShader, MAX_OTHERS } from './shaders/sphere.js';

export interface ParticleSphereOptions {
  count?: number;
  radius?: number;
  color?: THREE.Color;
}

export interface OtherSphere {
  position: THREE.Vector3; // world-space centre
  color: THREE.Color;
  weight: number;          // 0..1 presence
}

// Particles spread evenly over a sphere (Fibonacci spiral), animated by a custom shader.
export function createParticleSphere({ count = 6000, radius = 150, color = new THREE.Color(0xffffff) }: ParticleSphereOptions = {}) {
  const positions = new Float32Array(count * 3);
  const randoms = new Float32Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count; // -1..1, offset avoids duplicate poles
    const r = Math.sqrt(1 - y * y);
    const a = i * golden;
    positions.set([Math.cos(a) * r * radius, y * radius, Math.sin(a) * r * radius], i * 3);
    randoms[i] = Math.random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: devicePixelRatio },
    uRadius: { value: radius },
    uColor: { value: color },
    uPresence: { value: 0 },
    uOthers: { value: Array.from({ length: MAX_OTHERS }, () => new THREE.Vector3()) },
    uOtherColors: { value: Array.from({ length: MAX_OTHERS }, () => new THREE.Color()) },
    uOtherWeights: { value: new Array<number>(MAX_OTHERS).fill(0) },
    uOtherCount: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  // The bridge reaches outside the geometry's bounds: a sphere whose centre is just
  // off-window must still draw its bridge into this window.
  points.frustumCulled = false;

  function update(seconds: number, others: OtherSphere[], presence: number): void {
    uniforms.uTime.value = seconds;
    uniforms.uPresence.value = presence;
    points.rotation.y = seconds * 0.2;
    const n = Math.min(others.length, MAX_OTHERS);
    for (let i = 0; i < n; i++) {
      uniforms.uOthers.value[i].copy(others[i].position);
      uniforms.uOtherColors.value[i].copy(others[i].color);
      uniforms.uOtherWeights.value[i] = others[i].weight;
    }
    uniforms.uOtherCount.value = n;
  }

  function dispose(): void { geometry.dispose(); material.dispose(); }

  return { points, update, dispose };
}

export type ParticleSphere = ReturnType<typeof createParticleSphere>;
