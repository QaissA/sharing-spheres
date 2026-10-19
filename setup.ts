#!/usr/bin/env node
/**
 * Shared Text 3D (TypeScript edition) — step-by-step project planner & builder
 *
 * Usage:
 *   node setup.ts                 interactive: explains each step, asks before running it
 *   node setup.ts --yes           run every step without asking
 *   node setup.ts --plan          only print the plan, change nothing
 *   node setup.ts --dir my-app    choose the project folder (default: shared-text-3d)
 *   node setup.ts --reset         forget saved progress and start over
 *
 * Needs Node 22.18+ (runs .ts natively by stripping types — no tsx/ts-node).
 * Progress is saved in <project>/.setup-progress.json, so you can quit
 * at any step and re-run the script later to continue where you left off.
 * The generated project is TypeScript end to end: server, shared types, client, test.
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { spawn, execSync } from 'node:child_process';

interface Step {
  id: string;
  title: string;
  why: string;
  run: () => void | Promise<void>;
}

interface Progress {
  done: string[];
}

interface HttpResult {
  status: number | undefined;
  body: string;
}

// ---------- CLI options ----------
const args = process.argv.slice(2);
const AUTO = args.includes('--yes') || args.includes('-y');
const PLAN_ONLY = args.includes('--plan');
const RESET = args.includes('--reset');
const dirIdx = args.indexOf('--dir');
const PROJECT = path.resolve(dirIdx !== -1 && args[dirIdx + 1] ? args[dirIdx + 1] : 'shared-text-3d');
const PROGRESS_FILE = path.join(PROJECT, '.setup-progress.json');
const PORT = 3000;

// ---------- small helpers ----------
const c = {
  bold: (s: string) => '\x1b[1m' + s + '\x1b[0m',
  dim: (s: string) => '\x1b[2m' + s + '\x1b[0m',
  green: (s: string) => '\x1b[32m' + s + '\x1b[0m',
  yellow: (s: string) => '\x1b[33m' + s + '\x1b[0m',
  red: (s: string) => '\x1b[31m' + s + '\x1b[0m',
  cyan: (s: string) => '\x1b[36m' + s + '\x1b[0m',
};

function writeFile(rel: string, content: string): void {
  const full = path.join(PROJECT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.replace(/^\n/, ''));
  console.log('   ' + c.green('✔') + ' wrote ' + rel);
}

function writeJson(rel: string, data: unknown): void {
  writeFile(rel, JSON.stringify(data, null, 2) + '\n');
}

function run(cmd: string): void {
  console.log('   ' + c.dim('$ ' + cmd));
  execSync(cmd, { cwd: PROJECT, stdio: 'inherit' });
}

function loadProgress(): Progress {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')) as Progress; } catch { return { done: [] }; }
}
function saveProgress(p: Progress): void {
  fs.mkdirSync(PROJECT, { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

let rl: readline.Interface | undefined;
function ask(q: string): Promise<string> {
  rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
  const r = rl;
  return new Promise((res) => r.question(q, (a) => res(a.trim().toLowerCase())));
}

function httpGet(url: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function waitForServer(url: string, tries = 30): Promise<HttpResult> {
  for (let i = 0; i < tries; i++) {
    try { return await httpGet(url); } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('server did not start on ' + url);
}

// ---------- config templates ----------
// Server + test: run by Node directly, so only erasable TS syntax is allowed (no enum/namespace).
const TSCONFIG_SERVER = {
  compilerOptions: {
    target: 'ES2022',
    module: 'nodenext',
    moduleResolution: 'nodenext',
    noEmit: true,
    allowImportingTsExtensions: true,
    erasableSyntaxOnly: true,
    verbatimModuleSyntax: true,
    strict: true,
    skipLibCheck: true,
    types: ['node'],
  },
  include: ['server.ts', 'test', 'src/shared'],
};

// Client: compiled by tsc to public/build, bare imports resolved by the import map in index.html.
const TSCONFIG_CLIENT = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    rootDir: 'src',
    outDir: 'public/build',
    verbatimModuleSyntax: true,
    strict: true,
    skipLibCheck: true,
    types: [],
  },
  include: ['src/client', 'src/shared'],
};

// ---------- file templates ----------
const FILES: Record<string, string> = {
  'src/shared/events.ts': `
// Event contract shared by server and client — a typo in an event name is now a compile error.
export interface ServerToClientEvents {
  'text:init': (text: string) => void;
  'text:update': (text: string) => void;
}

export interface ClientToServerEvents {
  'text:update': (text: string) => void;
}
`,

  'server.ts': `
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from './src/shared/events.ts';

const PORT = Number(process.env.PORT) || 3000;
const app = express();
const server = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server);

// The single source of truth for the shared text (in memory for the MVP).
let currentText = '';

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

  socket.on('disconnect', () => console.log('client disconnected:', socket.id));
});

// Only listen when run directly (node server.ts), not when imported by the test
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  server.listen(PORT, () => console.log('Open http://localhost:' + PORT + ' in two tabs'));
}

export { server, io };
`,

  'public/index.html': `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Shared Text 3D</title>
  <link rel="stylesheet" href="style.css" />
  <script type="importmap">
    {
      "imports": {
        "three": "/vendor/three/three.module.js",
        "socket.io-client": "/socket.io/socket.io.esm.min.js"
      }
    }
  </script>
</head>
<body>
  <!-- Hidden textarea: gives us native typing, backspace, paste, mobile keyboard -->
  <textarea id="input" autofocus spellcheck="false" aria-label="Shared text"></textarea>
  <div id="status" class="offline">connecting…</div>
  <div id="hint">Click anywhere and type — open a second tab to see it sync</div>

  <!-- Compiled from src/client/main.ts by: npm run build -->
  <script type="module" src="build/client/main.js"></script>
</body>
</html>
`,

  'public/style.css': `
html, body { margin: 0; height: 100%; overflow: hidden; background: #0f1020; font-family: sans-serif; }
canvas { display: block; }
#input { position: fixed; top: 0; left: 0; width: 1px; height: 1px; opacity: 0; }
#status { position: fixed; top: 12px; right: 12px; padding: 4px 10px; border-radius: 12px;
          font-size: 13px; color: #fff; }
#status.online  { background: #1f8f4e; }
#status.offline { background: #a33; }
#hint { position: fixed; bottom: 12px; width: 100%; text-align: center; color: #889; font-size: 13px; }
`,

  'src/client/scene.ts': `
import * as THREE from 'three';

export type FrameCallback = (seconds: number) => void;

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1020);

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
  camera.position.z = 5;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

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
`,

  'src/client/textMesh.ts': `
import * as THREE from 'three';

export interface TextMeshOptions {
  width?: number;
  height?: number;
  fontSize?: number;
}

// Draws text on a 2D canvas, then uses that canvas as a texture on a 3D plane.
export function createTextMesh({ width = 1024, height = 512, fontSize = 44 }: TextMeshOptions = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not supported in this browser');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 2),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })
  );

  const padding = 40;
  const lineHeight = fontSize * 1.3;

  // Split on newlines, then wrap long lines to the canvas width
  function wrap(text: string): string[] {
    const lines: string[] = [];
    text.split('\\n').forEach((para) => {
      let line = '';
      for (const ch of para) {
        if (ctx!.measureText(line + ch).width > width - padding * 2) { lines.push(line); line = ch; }
        else line += ch;
      }
      lines.push(line);
    });
    return lines;
  }

  function setText(text: string): void {
    ctx!.clearRect(0, 0, width, height);
    ctx!.fillStyle = 'rgba(40, 44, 90, 0.85)';
    ctx!.fillRect(0, 0, width, height);

    ctx!.font = fontSize + 'px sans-serif';
    ctx!.fillStyle = '#ffffff';
    ctx!.textBaseline = 'top';

    const lines = wrap(text);
    // Keep the most recent lines visible if the text overflows
    const maxLines = Math.floor((height - padding * 2) / lineHeight);
    const visible = lines.slice(-maxLines);
    visible.forEach((line, i) => ctx!.fillText(line, padding, padding + i * lineHeight));

    // Simple caret after the last character
    const last = visible[visible.length - 1] ?? '';
    const x = padding + ctx!.measureText(last).width + 4;
    const y = padding + (visible.length - 1) * lineHeight;
    ctx!.fillRect(x, y, 3, fontSize);

    texture.needsUpdate = true;
  }

  setText('');
  return { mesh, setText };
}
`,

  'src/client/socket.ts': `
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/events.js';

export interface SyncHandlers {
  onText: (text: string) => void;
  onStatus: (online: boolean) => void;
}

// Thin wrapper around Socket.IO so main.ts doesn't care about event names.
export function createSync({ onText, onStatus }: SyncHandlers) {
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();

  socket.on('connect', () => onStatus(true));
  socket.on('disconnect', () => onStatus(false));
  socket.on('text:init', onText);
  socket.on('text:update', onText);

  return {
    send(text: string): void { socket.emit('text:update', text); },
  };
}
`,

  'src/client/main.ts': `
import { createScene } from './scene.js';
import { createTextMesh } from './textMesh.js';
import { createSync } from './socket.js';

const input = document.getElementById('input') as HTMLTextAreaElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

// 3D setup
const { scene, onFrame, start } = createScene();
const textMesh = createTextMesh();
scene.add(textMesh.mesh);
onFrame((t) => { textMesh.mesh.rotation.y = Math.sin(t * 0.5) * 0.3; }); // gentle sway
start();

// Networking
const sync = createSync({
  onText(text) {
    input.value = text;
    textMesh.setText(text);
  },
  onStatus(online) {
    statusEl.textContent = online ? 'connected' : 'offline';
    statusEl.className = online ? 'online' : 'offline';
  },
});

// Local typing → render immediately, then share
input.addEventListener('input', () => {
  textMesh.setText(input.value);
  sync.send(input.value);
});

// Keep the hidden textarea focused so typing always works
document.addEventListener('click', () => input.focus());
input.focus();
`,

  'test/sync.test.ts': `
// Starts the server, connects two clients, and checks that text typed
// in one arrives in the other (both directions) plus late-joiner state.
import { io as Client, type Socket } from 'socket.io-client';
import { server } from '../server.ts';
import type { ClientToServerEvents, ServerToClientEvents } from '../src/shared/events.ts';

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const PORT = 3999;
const URL = 'http://localhost:' + PORT;
const connect = (): TestSocket => Client(URL);
const wait = (socket: TestSocket, event: keyof ServerToClientEvents) =>
  new Promise<string>((res) => socket.once(event, (text: string) => res(text)));

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
  } catch (e) {
    console.error(e); process.exitCode = 1;
  } finally {
    a.close(); b.close(); server.close();
    setTimeout(() => process.exit(), 100);
  }
});
`,
};

// ---------- the plan ----------
const STEPS: Step[] = [
  {
    id: 'check-node',
    title: 'Check your environment',
    why: 'Node 22.18+ runs .ts files natively (type stripping), so no tsx/ts-node is needed. Also needs npm.',
    run() {
      const [major, minor] = process.versions.node.split('.').map(Number);
      console.log('   Node ' + process.versions.node);
      if (major < 22 || (major === 22 && minor < 18)) {
        throw new Error('Node 22.18+ required to run .ts natively — install from https://nodejs.org');
      }
      execSync('npm --version', { stdio: 'pipe' });
      console.log('   ' + c.green('✔') + ' npm available');
    },
  },
  {
    id: 'init',
    title: 'Create the project folder and package.json',
    why: 'ESM project ("type": "module") with build, typecheck, start, dev and test scripts — all TypeScript.',
    run() {
      fs.mkdirSync(path.join(PROJECT, 'public'), { recursive: true });
      writeJson('package.json', {
        name: path.basename(PROJECT).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        version: '0.1.0',
        private: true,
        type: 'module',
        description: 'Two browser tabs share typed text in real time, rendered with Three.js (TypeScript)',
        main: 'server.ts',
        engines: { node: '>=22.18' },
        scripts: {
          build: 'tsc -p tsconfig.client.json',
          watch: 'tsc -p tsconfig.client.json --watch',
          typecheck: 'tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.client.json',
          start: 'npm run build && node server.ts',
          dev: 'node --watch server.ts',
          test: 'node test/sync.test.ts',
        },
      });
      writeFile('.gitignore', 'node_modules\npublic/build\n.setup-progress.json\n');
    },
  },
  {
    id: 'deps',
    title: 'Install dependencies',
    why: 'express + socket.io + three at runtime; typescript, @types/* and socket.io-client (types + test) for development.',
    run() {
      run('npm install express socket.io three');
      run('npm install --save-dev typescript @types/node @types/express @types/three socket.io-client');
    },
  },
  {
    id: 'tsconfig',
    title: 'Write the TypeScript configs (tsconfig.json + tsconfig.client.json)',
    why: 'Server/test config is check-only and forbids non-erasable syntax Node cannot strip; client config compiles to public/build.',
    run() {
      writeJson('tsconfig.json', TSCONFIG_SERVER);
      writeJson('tsconfig.client.json', TSCONFIG_CLIENT);
    },
  },
  {
    id: 'shared',
    title: 'Write the shared event types (src/shared/events.ts)',
    why: 'One typed contract for socket events, used by both server and client.',
    run() { writeFile('src/shared/events.ts', FILES['src/shared/events.ts']); },
  },
  {
    id: 'server',
    title: 'Write the server (server.ts)',
    why: 'Holds the current text, sends it to new tabs, relays each change, and serves three from node_modules.',
    run() { writeFile('server.ts', FILES['server.ts']); },
  },
  {
    id: 'html',
    title: 'Write the page shell (index.html + style.css)',
    why: 'Import map points "three" and "socket.io-client" at locally served ES modules (no bundler); hidden textarea captures typing.',
    run() {
      writeFile('public/index.html', FILES['public/index.html']);
      writeFile('public/style.css', FILES['public/style.css']);
    },
  },
  {
    id: 'client',
    title: 'Write and compile the client (scene, textMesh, socket, main .ts)',
    why: 'Browsers cannot run TypeScript, so tsc compiles src/client to public/build.',
    run() {
      for (const name of ['scene', 'textMesh', 'socket', 'main']) {
        writeFile('src/client/' + name + '.ts', FILES['src/client/' + name + '.ts']);
      }
      run('npm run build');
    },
  },
  {
    id: 'test',
    title: 'Write the sync test (test/sync.test.ts)',
    why: 'Proves the core feature works: A→B, B→A, and a newly opened tab receives the current text.',
    run() { writeFile('test/sync.test.ts', FILES['test/sync.test.ts']); },
  },
  {
    id: 'typecheck',
    title: 'Type-check everything',
    why: 'Node only strips types, it never checks them — this step is what actually enforces TypeScript.',
    run() { run('npm run typecheck'); },
  },
  {
    id: 'run-test',
    title: 'Run the sync test',
    why: 'Runs test/sync.test.ts directly with Node.',
    run() { run('npm test'); },
  },
  {
    id: 'smoke',
    title: 'Smoke-test the running server',
    why: 'Starts the real server.ts and checks the page, compiled client, three and the Socket.IO ESM client are served.',
    async run() {
      const child = spawn(process.execPath, ['server.ts'], {
        cwd: PROJECT, env: { ...process.env, PORT: String(PORT + 1) }, stdio: 'ignore',
      });
      try {
        const base = 'http://localhost:' + (PORT + 1);
        const page = await waitForServer(base + '/');
        if (page.status !== 200 || !page.body.includes('Shared Text 3D')) throw new Error('index.html not served');
        console.log('   ' + c.green('✔') + ' page served');
        for (const asset of ['/build/client/main.js', '/vendor/three/three.module.js', '/socket.io/socket.io.esm.min.js']) {
          const res = await httpGet(base + asset);
          if (res.status !== 200) throw new Error(asset + ' not served (HTTP ' + res.status + ')');
          console.log('   ' + c.green('✔') + ' ' + asset + ' served');
        }
      } finally {
        child.kill();
      }
    },
  },
];

const ROADMAP = [
  'Rooms: /room/:id + socket.join(id) so groups don\'t share one text',
  'Debounce emits (~50 ms) to cut traffic on fast typing',
  'Persist currentText (file/Redis) so it survives restarts',
  'Show who\'s connected (user count / colors)',
  'Concurrent editing without overwrites: Yjs (CRDT)',
  'Crisper 3D text: troika-three-text',
];

// ---------- runner ----------
function printPlan(progress: Progress): void {
  console.log('\n' + c.bold('Shared Text 3D (TypeScript) — MVP plan') + c.dim('  (' + PROJECT + ')') + '\n');
  STEPS.forEach((s, i) => {
    const mark = progress.done.includes(s.id) ? c.green('✔') : c.dim('○');
    console.log(' ' + mark + ' ' + (i + 1) + '. ' + s.title);
    console.log('      ' + c.dim(s.why));
  });
  console.log('\n ' + c.bold('After the MVP:'));
  ROADMAP.forEach((r) => console.log('   • ' + r));
  console.log('');
}

async function main(): Promise<void> {
  if (RESET && fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
  const progress = loadProgress();
  printPlan(progress);
  if (PLAN_ONLY) return;

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    if (progress.done.includes(step.id)) continue;

    console.log(c.cyan(c.bold('\n▶ Step ' + (i + 1) + '/' + STEPS.length + ': ' + step.title)));
    console.log('  ' + step.why);

    if (!AUTO) {
      const a = await ask('  [Enter] run · [s] skip · [q] quit > ');
      if (a === 'q') { console.log(c.yellow('\nStopped. Re-run the script to continue from here.')); break; }
      if (a === 's') { console.log(c.yellow('  skipped')); continue; }
    }

    try {
      await step.run();
      progress.done.push(step.id);
      saveProgress(progress);
      console.log(c.green('  ✔ done'));
    } catch (err) {
      console.log(c.red('  ✖ ' + (err instanceof Error ? err.message : String(err))));
      console.log(c.yellow('  Fix the issue and re-run the script — finished steps will be skipped.'));
      process.exitCode = 1;
      break;
    }
  }

  rl?.close();

  if (STEPS.every((s) => progress.done.includes(s.id))) {
    console.log(c.green(c.bold('\n🎉 MVP ready!')));
    console.log('   cd ' + path.relative(process.cwd(), PROJECT) + ' && npm start');
    console.log('   then open http://localhost:' + PORT + ' in TWO tabs and type in either one.');
    console.log(c.dim('   dev: run "npm run watch" and "npm run dev" in two terminals.\n'));
  }
}

main();
