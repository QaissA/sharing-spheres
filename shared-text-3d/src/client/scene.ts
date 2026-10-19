import * as THREE from 'three';

export type FrameCallback = (seconds: number) => void;

// The camera comes from outside (screenSpace.ts) because it follows the window on screen.
export function createScene(camera: THREE.Camera) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1020);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  // Camera frustum is refreshed every frame by screenSpace, only the canvas needs resizing
  addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight));

  const frameCallbacks: FrameCallback[] = [];
  function onFrame(fn: FrameCallback): void { frameCallbacks.push(fn); }
  function start(): void {
    renderer.setAnimationLoop((t: number) => {
      frameCallbacks.forEach((fn) => fn(t / 1000));
      renderer.render(scene, camera);
    });
  }

  return { scene, camera, renderer, onFrame, start };
}
