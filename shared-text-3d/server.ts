import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SphereState } from './src/shared/events.ts';

const PORT = Number(process.env.PORT) || 3000;
const app = express();
const server = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server);

// The single source of truth for the shared text (in memory for the MVP).
let currentText = '';
// One sphere per connected window, keyed by socket id.
const spheres = new Map<string, SphereState>();

const isNum = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

// Untrusted input: rebuild the object so extra fields never get stored or broadcast
function toSphereState(s: unknown): SphereState | null {
  if (typeof s !== 'object' || s === null) return null;
  const { x, y, radius, color } = s as Record<string, unknown>;
  if (!isNum(x, -1e5, 1e5) || !isNum(y, -1e5, 1e5) || !isNum(radius, 1, 1000)) return null;
  if (!isNum(color, 0, 0xffffff) || !Number.isInteger(color)) return null;
  return { x, y, radius, color };
}

app.use(express.static('public'));
// Serve three from node_modules so the runtime version always matches @types/three.
app.use('/vendor/three', express.static('node_modules/three/build'));

io.on('connection', (socket) => {
  console.log('client connected:', socket.id, '| total:', io.engine.clientsCount);

  // 1. Give the newcomer the current state
  socket.emit('text:init', currentText);

  // 2. When someone types, store it and send it to everyone else
  socket.on('text:update', (text) => {
    // Types are not enforced at runtime, so keep validating untrusted input
    if (typeof text !== 'string' || text.length > 10000) return;
    currentText = text;
    socket.broadcast.emit('text:update', text);
  });

  // 3. Spheres: newcomer gets everyone, updates go to everyone else
  socket.emit('sphere:all', [...spheres].map(([id, s]) => ({ id, ...s })));

  socket.on('sphere:update', (raw) => {
    const s = toSphereState(raw);
    if (!s) return;
    spheres.set(socket.id, s);
    socket.broadcast.emit('sphere:update', { id: socket.id, ...s });
  });

  socket.on('disconnect', () => {
    console.log('client disconnected:', socket.id);
    if (spheres.delete(socket.id)) socket.broadcast.emit('sphere:leave', socket.id);
  });
});

// Only listen when run directly (node server.ts), not when imported by the test
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  server.listen(PORT, () => console.log('Open http://localhost:' + PORT + ' in two tabs'));
}

export { server, io };
