import * as THREE from 'three';
import { createScene } from './scene.js';
import { createTextMesh } from './textMesh.js';
import { createSync } from './socket.js';
import { createParticleSphere, type ParticleSphere } from './particleSphere.js';
import { createScreenCamera, windowCenter } from './screenSpace.js';
import { createSphereSync } from './sphereSync.js';
import type { Sphere } from '../shared/events.js';

const input = document.getElementById('input') as HTMLTextAreaElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

const RADIUS = 150;
const myColor = new THREE.Color().setHSL(Math.random(), 0.75, 0.6);

// 3D setup: one shared world in screen pixels, this window's camera looks at its own slice
const view = createScreenCamera();
const { scene, onFrame, start } = createScene(view.camera);

// Shared text: a 4x2 plane scaled to 400x200 px, shown under my sphere while there is text
const textMesh = createTextMesh();
textMesh.mesh.scale.setScalar(100);
scene.add(textMesh.mesh);
function show(text: string): void {
  textMesh.setText(text);
  textMesh.mesh.visible = text !== '';
}
show('');

// Every sphere in the world, mine included. Remote ones glide toward `target`
// and fade via `presence`; `alive = false` means fading out before removal.
interface Entry { sphere: ParticleSphere; color: THREE.Color; target: THREE.Vector3; presence: number; alive: boolean }
const entries = new Map<string, Entry>();
const MINE = 'mine';

function addEntry(id: string, x: number, y: number, radius: number, color: THREE.Color): Entry {
  const sphere = createParticleSphere({ radius, color });
  sphere.points.position.set(x, -y, 0); // screen px -> world (flip y), start in place: no fly-in
  scene.add(sphere.points);
  const entry = { sphere, color, target: sphere.points.position.clone(), presence: 0, alive: true };
  entries.set(id, entry);
  return entry;
}
const initial = windowCenter();
const mine = addEntry(MINE, initial.x, initial.y, RADIUS, myColor);

function upsert(s: Sphere): void {
  if (s.id === sphereSync.myId()) return;
  const e = entries.get(s.id) ?? addEntry(s.id, s.x, s.y, s.radius, new THREE.Color(s.color));
  e.target.set(s.x, -s.y, 0);
  e.alive = true;
}
function leave(id: string): void {
  const e = entries.get(id);
  if (e) e.alive = false; // removed once faded out, so its bridge relaxes instead of snapping
}

// Networking
const sync = createSync({
  onText(text) {
    input.value = text;
    show(text);
  },
  onStatus(online) {
    statusEl.textContent = online ? 'connected' : 'offline';
    statusEl.className = online ? 'online' : 'offline';
  },
});
const sphereSync = createSphereSync(sync.socket, {
  onAll(list) {
    // Fresh snapshot (first connect or reconnect): anything not in it is gone
    const ids = new Set(list.map((s) => s.id));
    for (const id of entries.keys()) if (id !== MINE && !ids.has(id)) leave(id);
    list.forEach(upsert);
  },
  onUpdate: upsert,
  onLeave: leave,
});

let lastT = 0;
onFrame((t) => {
  const dt = Math.min(t - lastT, 0.1); // clamp: a backgrounded tab resumes with a huge dt
  lastT = t;

  // My window may have moved or resized: re-aim the camera, re-centre my sphere, tell others
  view.update();
  const c = windowCenter();
  mine.target.set(c.x, -c.y, 0);
  mine.sphere.points.position.copy(mine.target); // mine follows the window exactly, no lag
  sphereSync.send({ x: c.x, y: c.y, radius: RADIUS, color: myColor.getHex() });

  // Frame-rate independent smoothing: the same feel at 30 or 144 fps
  const moveK = 1 - Math.exp(-dt * 12);
  const fadeK = 1 - Math.exp(-dt * 4);
  for (const [id, e] of entries) {
    e.sphere.points.position.lerp(e.target, moveK);
    e.presence += ((e.alive ? 1 : 0) - e.presence) * fadeK;
    if (!e.alive && e.presence < 0.01) {
      scene.remove(e.sphere.points);
      e.sphere.dispose();
      entries.delete(id);
    }
  }

  const all = [...entries.values()];
  for (const e of all) {
    const others = all.filter((o) => o !== e)
      .map((o) => ({ position: o.sphere.points.position, color: o.color, weight: o.presence }));
    e.sphere.update(t, others, e.presence);
  }

  textMesh.mesh.position.set(c.x, -c.y - RADIUS - 130, 0);
  textMesh.mesh.rotation.y = Math.sin(t * 0.5) * 0.3; // gentle sway
});
start();

// Local typing → render immediately, then share
input.addEventListener('input', () => {
  show(input.value);
  sync.send(input.value);
});

// Keep the hidden textarea focused so typing always works
document.addEventListener('click', () => input.focus());
input.focus();
