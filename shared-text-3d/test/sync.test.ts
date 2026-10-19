// Starts the server, connects two clients, and checks that text typed
// in one arrives in the other (both directions) plus late-joiner state,
// then the same for spheres, plus sphere:leave on disconnect.
import { io as Client, type Socket } from 'socket.io-client';
import { server } from '../server.ts';
import type { ClientToServerEvents, ServerToClientEvents } from '../src/shared/events.ts';

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const PORT = 3999;
const URL = 'http://localhost:' + PORT;
const connect = (): TestSocket => Client(URL);
// Resolves with the first argument of the next `event` on `socket`
const wait = <E extends keyof ServerToClientEvents>(socket: TestSocket, event: E) =>
  new Promise<Parameters<ServerToClientEvents[E]>[0]>((res) => socket.once(event, res as never));

function check(name: string, ok: boolean): void {
  console.log((ok ? '  PASS ' : '  FAIL ') + name);
  if (!ok) process.exitCode = 1;
}

server.listen(PORT, async () => {
  const a = connect(), b = connect();
  try {
    await Promise.all([wait(a, 'text:init'), wait(b, 'text:init')]);

    let got = wait(b, 'text:update');
    a.emit('text:update', 'hello from A');
    check('A -> B', (await got) === 'hello from A');

    got = wait(a, 'text:update');
    b.emit('text:update', 'hello from B');
    check('B -> A', (await got) === 'hello from B');

    const c = connect();
    check('late joiner gets current text', (await wait(c, 'text:init')) === 'hello from B');
    c.close();

    let sphere = wait(b, 'sphere:update');
    a.emit('sphere:update', { x: 100, y: 200, radius: 150, color: 0xff0000 });
    let s = await sphere;
    check('sphere A -> B', s.id === a.id && s.x === 100 && s.y === 200 && s.color === 0xff0000);

    sphere = wait(a, 'sphere:update');
    b.emit('sphere:update', { x: 900, y: 200, radius: 150, color: 0x00ff00 });
    s = await sphere;
    check('sphere B -> A', s.id === b.id && s.x === 900);

    const bId = b.id;
    const left = wait(a, 'sphere:leave');
    b.close();
    check('disconnect -> sphere:leave', (await left) === bId);

    const d = connect();
    const all = await wait(d, 'sphere:all');
    check('late joiner gets remaining spheres', all.length === 1 && all[0].id === a.id);
    d.close();
  } catch (e) {
    console.error(e); process.exitCode = 1;
  } finally {
    a.close(); b.close(); server.close();
    setTimeout(() => process.exit(), 100);
  }
});
