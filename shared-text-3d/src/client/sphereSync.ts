import type { SyncSocket } from './socket.js';
import type { Sphere, SphereState } from '../shared/events.js';

export interface SphereHandlers {
  onAll: (spheres: Sphere[]) => void;
  onUpdate: (sphere: Sphere) => void;
  onLeave: (id: string) => void;
}

const MIN_INTERVAL_MS = 1000 / 30; // at most ~30 updates per second

// Sphere events on the existing socket, so one window = one socket id = one sphere.
export function createSphereSync(socket: SyncSocket, { onAll, onUpdate, onLeave }: SphereHandlers) {
  let lastSent: SphereState | null = null;
  let lastSentAt = -Infinity;

  socket.on('sphere:all', onAll);
  socket.on('sphere:update', onUpdate);
  socket.on('sphere:leave', onLeave);
  // The server forgets our sphere when we disconnect: re-announce after a reconnect
  socket.on('connect', () => { if (lastSent) socket.emit('sphere:update', lastSent); });

  // Safe to call every frame: only sends when something changed, throttled.
  // Comparing against the last SENT state means the final resting position
  // still goes out on a later frame, even if it landed inside the throttle window.
  function send(state: SphereState): void {
    const now = performance.now();
    const changed = !lastSent || lastSent.x !== state.x || lastSent.y !== state.y
      || lastSent.radius !== state.radius || lastSent.color !== state.color;
    if (!changed || now - lastSentAt < MIN_INTERVAL_MS) return;
    socket.emit('sphere:update', state);
    lastSent = state;
    lastSentAt = now;
  }

  return { send, myId: () => socket.id };
}
