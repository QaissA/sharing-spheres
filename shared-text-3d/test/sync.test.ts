// Starts the Worker locally, connects two clients, and checks that text typed
// in one arrives in the other (both directions) plus late-joiner state,
// then the same for spheres, plus sphere:leave on disconnect.
import { unstable_startWorker } from 'wrangler';
import type { ClientToServerEvents, ServerToClientEvents, Sphere } from '../src/shared/events.ts';

type Payload<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>[0];

function check(name: string, ok: boolean): void {
  console.log((ok ? '  PASS ' : '  FAIL ') + name);
  if (!ok) process.exitCode = 1;
}

const worker = await unstable_startWorker({ config: 'wrangler.jsonc', dev: { persist: false, logLevel: 'none' } });
const wsUrl = new URL('/ws', await worker.url).href.replace(/^http/, 'ws');

// Buffers every message, so one sent before we start waiting is not lost
function connect() {
  const ws = new WebSocket(wsUrl);
  const inbox: [string, unknown][] = [];
  let notify = () => {};
  ws.onmessage = (e) => { inbox.push(JSON.parse(e.data as string)); notify(); };
  const client = {
    id: '',
    // Resolves with the data of the oldest unread `event`
    async wait<E extends keyof ServerToClientEvents | 'id'>(event: E): Promise<E extends keyof ServerToClientEvents ? Payload<E> : string> {
      for (;;) {
        const i = inbox.findIndex(([e]) => e === event);
        if (i >= 0) return inbox.splice(i, 1)[0][1] as never;
        await new Promise<void>((res) => { notify = res; });
      }
    },
    emit<E extends keyof ClientToServerEvents>(event: E, data: Parameters<ClientToServerEvents[E]>[0]) {
      ws.send(JSON.stringify([event, data]));
    },
    close: () => ws.close(),
  };
  return client;
}

const ready = async (c: ReturnType<typeof connect>) => { c.id = await c.wait('id'); return c; };

const a = await ready(connect()), b = await ready(connect());
try {
  await Promise.all([a.wait('text:init'), b.wait('text:init')]);

  a.emit('text:update', 'hello from A');
  check('A -> B', (await b.wait('text:update')) === 'hello from A');

  b.emit('text:update', 'hello from B');
  check('B -> A', (await a.wait('text:update')) === 'hello from B');

  const c = await ready(connect());
  check('late joiner gets current text', (await c.wait('text:init')) === 'hello from B');
  c.close();

  a.emit('sphere:update', { x: 100, y: 200, radius: 150, color: 0xff0000 });
  let s: Sphere = await b.wait('sphere:update');
  check('sphere A -> B', s.id === a.id && s.x === 100 && s.y === 200 && s.color === 0xff0000);

  b.emit('sphere:update', { x: 900, y: 200, radius: 150, color: 0x00ff00 });
  s = await a.wait('sphere:update');
  check('sphere B -> A', s.id === b.id && s.x === 900);

  a.emit('sphere:update', { x: 'nope', y: 0, radius: 150, color: 0 } as never);
  b.emit('text:update', 'after bad sphere');
  check('invalid sphere is dropped', (await a.wait('text:update')) === 'after bad sphere' && !(await hasQueued(b, 'sphere:update')));

  b.close();
  check('disconnect -> sphere:leave', (await a.wait('sphere:leave')) === b.id);

  const d = await ready(connect());
  const all = await d.wait('sphere:all');
  check('late joiner gets remaining spheres', all.length === 1 && all[0].id === a.id);
  d.close();
} catch (e) {
  console.error(e); process.exitCode = 1;
} finally {
  a.close(); b.close();
  await worker.dispose();
}

// True if `event` arrives within a short window (used to assert something was NOT sent)
async function hasQueued(c: ReturnType<typeof connect>, event: keyof ServerToClientEvents): Promise<boolean> {
  return Promise.race([c.wait(event).then(() => true), new Promise<boolean>((res) => setTimeout(res, 300, false))]);
}
