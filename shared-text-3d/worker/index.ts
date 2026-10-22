import { DurableObject } from 'cloudflare:workers';
import type { Sphere, SphereState } from '../src/shared/events.ts';

interface Env {
  ROOM: DurableObjectNamespace<Room>;
}

// Stored on each socket, so it survives the Durable Object hibernating between messages
interface Attachment {
  id: string;
  sphere: SphereState | null;
}

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

// Messages are JSON [event, data], using the event names from src/shared/events.ts
const send = (ws: WebSocket, event: string, data: unknown) => ws.send(JSON.stringify([event, data]));

export default {
  fetch(req, env) {
    if (new URL(req.url).pathname !== '/ws') return new Response('Not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    // One room for everyone: a single Durable Object is the single source of truth
    return env.ROOM.get(env.ROOM.idFromName('main')).fetch(req);
  },
} satisfies ExportedHandler<Env>;

export class Room extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    const me: Attachment = { id: crypto.randomUUID(), sphere: null };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(me);

    // The newcomer gets its id, then the current state
    send(server, 'id', me.id);
    send(server, 'text:init', (await this.ctx.storage.get<string>('text')) ?? '');
    send(server, 'sphere:all', this.spheres());
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 20000) return;
    let msg: unknown;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(msg)) return;
    const [event, data] = msg as [unknown, unknown];
    const me = ws.deserializeAttachment() as Attachment;

    if (event === 'text:update') {
      if (typeof data !== 'string' || data.length > 10000) return;
      await this.ctx.storage.put('text', data);
      this.broadcast(ws, 'text:update', data);
    } else if (event === 'sphere:update') {
      const s = toSphereState(data);
      if (!s) return;
      ws.serializeAttachment({ ...me, sphere: s });
      this.broadcast(ws, 'sphere:update', { id: me.id, ...s } satisfies Sphere);
    }
  }

  webSocketClose(ws: WebSocket): void {
    const me = ws.deserializeAttachment() as Attachment;
    if (me.sphere) this.broadcast(ws, 'sphere:leave', me.id);
  }

  private spheres(): Sphere[] {
    return this.ctx.getWebSockets().flatMap((ws) => {
      const { id, sphere } = ws.deserializeAttachment() as Attachment;
      return sphere ? [{ id, ...sphere }] : [];
    });
  }

  // Everyone except `from`; a socket that is mid-close throws on send, so skip it
  private broadcast(from: WebSocket, event: string, data: unknown): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== from) try { send(ws, event, data); } catch { /* closing */ }
    }
  }
}
