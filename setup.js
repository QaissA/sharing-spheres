#!/usr/bin/env node
/**
 * Shared Text 3D — step-by-step project planner & builder
 *
 * Usage:
 *   node setup.js                 interactive: explains each step, asks before running it
 *   node setup.js --yes           run every step without asking
 *   node setup.js --plan          only print the plan, change nothing
 *   node setup.js --dir my-app    choose the project folder (default: shared-text-3d)
 *   node setup.js --reset         forget saved progress and start over
 *
 * Progress is saved in <project>/.setup-progress.json, so you can quit
 * at any step and re-run the script later to continue where you left off.
 * No dependencies needed to run this script itself (Node 18+).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn, execSync } = require('child_process');

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
  bold: (s) => '\x1b[1m' + s + '\x1b[0m',
  dim: (s) => '\x1b[2m' + s + '\x1b[0m',
  green: (s) => '\x1b[32m' + s + '\x1b[0m',
  yellow: (s) => '\x1b[33m' + s + '\x1b[0m',
  red: (s) => '\x1b[31m' + s + '\x1b[0m',
  cyan: (s) => '\x1b[36m' + s + '\x1b[0m',
};

function writeFile(rel, content) {
  const full = path.join(PROJECT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.replace(/^\n/, ''));
  console.log('   ' + c.green('✔') + ' wrote ' + rel);
}

function run(cmd) {
  console.log('   ' + c.dim('$ ' + cmd));
  execSync(cmd, { cwd: PROJECT, stdio: 'inherit' });
}

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch { return { done: [] }; }
}
function saveProgress(p) {
  fs.mkdirSync(PROJECT, { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

let rl;
function ask(q) {
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => res(a.trim().toLowerCase())));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function waitForServer(url, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try { return await httpGet(url); } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('server did not start on ' + url);
}

// ---------- file templates ----------
const FILES = {
  'server.js': `
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// The single source of truth for the shared text (in memory for the MVP).
let currentText = '';

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('client connected:', socket.id, '| total:', io.engine.clientsCount);

  // 1. Give the newcomer the current state
  socket.emit('text:init', currentText);

  // 2. When someone types, store it and send it to everyone else
  socket.on('text:update', (text) => {
    if (typeof text !== 'string' || text.length > 10000) return; // basic validation
    currentText = text;
    socket.broadcast.emit('text:update', text);
  });

  socket.on('disconnect', () => console.log('client disconnected:', socket.id));
});

if (require.main === module) {
  server.listen(PORT, () => console.log('Open http://localhost:' + PORT + ' in two tabs'));
}

module.exports = { server, io };
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
    { "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js" } }
  </script>
</head>
<body>
  <!-- Hidden textarea: gives us native typing, backspace, paste, mobile keyboard -->
  <textarea id="input" autofocus spellcheck="false" aria-label="Shared text"></textarea>
  <div id="status" class="offline">connecting…</div>
  <div id="hint">Click anywhere and type — open a second tab to see it sync</div>

  <script src="/socket.io/socket.io.js"></script>
  <script type="module" src="main.js"></script>
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

  'public/scene.js': `
import * as THREE from 'three';

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

  const frameCallbacks = [];
  function onFrame(fn) { frameCallbacks.push(fn); }
  function start() {
    renderer.setAnimationLoop((t) => {
      frameCallbacks.forEach((fn) => fn(t / 1000));
      renderer.render(scene, camera);
    });
  }

  return { scene, camera, renderer, onFrame, start };
}
`,

  'public/textMesh.js': `
import * as THREE from 'three';

// Draws text on a 2D canvas, then uses that canvas as a texture on a 3D plane.
export function createTextMesh({ width = 1024, height = 512, fontSize = 44 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 2),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })
  );

  const padding = 40;
  const lineHeight = fontSize * 1.3;

  // Split on newlines, then wrap long lines to the canvas width
  function wrap(text) {
    const lines = [];
    text.split('\\n').forEach((para) => {
      let line = '';
      for (const ch of para) {
        if (ctx.measureText(line + ch).width > width - padding * 2) { lines.push(line); line = ch; }
        else line += ch;
      }
      lines.push(line);
    });
    return lines;
  }

  function setText(text) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(40, 44, 90, 0.85)';
    ctx.fillRect(0, 0, width, height);

    ctx.font = fontSize + 'px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';

    const lines = wrap(text);
    // Keep the most recent lines visible if the text overflows
    const maxLines = Math.floor((height - padding * 2) / lineHeight);
    const visible = lines.slice(-maxLines);
    visible.forEach((line, i) => ctx.fillText(line, padding, padding + i * lineHeight));

    // Simple caret after the last character
    const last = visible[visible.length - 1] || '';
    const x = padding + ctx.measureText(last).width + 4;
    const y = padding + (visible.length - 1) * lineHeight;
    ctx.fillRect(x, y, 3, fontSize);

    texture.needsUpdate = true;
  }

  setText('');
  return { mesh, setText };
}
`,

  'public/socket.js': `
// Thin wrapper around Socket.IO so main.js doesn't care about event names.
export function createSync({ onText, onStatus }) {
  const socket = io(); // global from /socket.io/socket.io.js

  socket.on('connect', () => onStatus(true));
  socket.on('disconnect', () => onStatus(false));
  socket.on('text:init', onText);
  socket.on('text:update', onText);

  return {
    send(text) { socket.emit('text:update', text); },
  };
}
`,

  'public/main.js': `
import { createScene } from './scene.js';
import { createTextMesh } from './textMesh.js';
import { createSync } from './socket.js';

const input = document.getElementById('input');
const statusEl = document.getElementById('status');

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

  'test/sync.test.js': `
// Starts the server, connects two clients, and checks that text typed
// in one arrives in the other (both directions) plus late-joiner state.
const { io: Client } = require('socket.io-client');
const { server } = require('../server');

const PORT = 3999;
const URL = 'http://localhost:' + PORT;
const wait = (socket, event) => new Promise((res) => socket.once(event, res));

function check(name, ok) {
  console.log((ok ? '  PASS ' : '  FAIL ') + name);
  if (!ok) process.exitCode = 1;
}

server.listen(PORT, async () => {
  const a = Client(URL), b = Client(URL);
  try {
    await Promise.all([wait(a, 'text:init'), wait(b, 'text:init')]);

    let got = wait(b, 'text:update');
    a.emit('text:update', 'hello from A');
    check('A -> B', (await got) === 'hello from A');

    got = wait(a, 'text:update');
    b.emit('text:update', 'hello from B');
    check('B -> A', (await got) === 'hello from B');

    const c = Client(URL);
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
const STEPS = [
  {
    id: 'check-node',
    title: 'Check your environment',
    why: 'Socket.IO 4 and modern syntax need Node 18 or newer, plus npm.',
    run() {
      const major = Number(process.versions.node.split('.')[0]);
      console.log('   Node ' + process.versions.node);
      if (major < 18) throw new Error('Node 18+ required — install from https://nodejs.org');
      execSync('npm --version', { stdio: 'pipe' });
      console.log('   ' + c.green('✔') + ' npm available');
    },
  },
  {
    id: 'init',
    title: 'Create the project folder and package.json',
    why: 'Sets up the project with start/test scripts.',
    run() {
      fs.mkdirSync(path.join(PROJECT, 'public'), { recursive: true });
      const pkg = {
        name: path.basename(PROJECT).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        version: '0.1.0',
        private: true,
        description: 'Two browser tabs share typed text in real time, rendered with Three.js',
        main: 'server.js',
        scripts: { start: 'node server.js', dev: 'node --watch server.js', test: 'node test/sync.test.js' },
      };
      writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n');
      writeFile('.gitignore', 'node_modules\n.setup-progress.json\n');
    },
  },
  {
    id: 'deps',
    title: 'Install dependencies',
    why: 'express serves the page, socket.io does real-time messaging, socket.io-client is for the automated test.',
    run() {
      run('npm install express socket.io');
      run('npm install --save-dev socket.io-client');
    },
  },
  {
    id: 'server',
    title: 'Write the server (server.js)',
    why: 'Holds the current text, sends it to new tabs, and relays each change to the other tabs.',
    run() { writeFile('server.js', FILES['server.js']); },
  },
  {
    id: 'html',
    title: 'Write the page shell (index.html + style.css)',
    why: 'Loads Three.js via an import map (no bundler) and adds a hidden textarea to capture typing.',
    run() {
      writeFile('public/index.html', FILES['public/index.html']);
      writeFile('public/style.css', FILES['public/style.css']);
    },
  },
  {
    id: 'three',
    title: 'Write the Three.js part (scene.js + textMesh.js)',
    why: 'scene.js = camera/renderer/loop. textMesh.js draws text on a canvas used as a texture on a 3D plane.',
    run() {
      writeFile('public/scene.js', FILES['public/scene.js']);
      writeFile('public/textMesh.js', FILES['public/textMesh.js']);
    },
  },
  {
    id: 'client',
    title: 'Write the client logic (socket.js + main.js)',
    why: 'Connects to the server, sends local typing, applies remote updates, shows connection status.',
    run() {
      writeFile('public/socket.js', FILES['public/socket.js']);
      writeFile('public/main.js', FILES['public/main.js']);
    },
  },
  {
    id: 'test',
    title: 'Write and run the sync test',
    why: 'Proves the core feature works: A→B, B→A, and a newly opened tab receives the current text.',
    run() {
      writeFile('test/sync.test.js', FILES['test/sync.test.js']);
      run('npm test');
    },
  },
  {
    id: 'smoke',
    title: 'Smoke-test the running server',
    why: 'Starts the real server and checks the page and the Socket.IO client script are served.',
    async run() {
      const child = spawn(process.execPath, ['server.js'], {
        cwd: PROJECT, env: { ...process.env, PORT: String(PORT + 1) }, stdio: 'ignore',
      });
      try {
        const base = 'http://localhost:' + (PORT + 1);
        const page = await waitForServer(base + '/');
        if (page.status !== 200 || !page.body.includes('Shared Text 3D')) throw new Error('index.html not served');
        console.log('   ' + c.green('✔') + ' page served');
        const sio = await httpGet(base + '/socket.io/socket.io.js');
        if (sio.status !== 200) throw new Error('socket.io client script not served');
        console.log('   ' + c.green('✔') + ' socket.io client served');
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
function printPlan(progress) {
  console.log('\n' + c.bold('Shared Text 3D — MVP plan') + c.dim('  (' + PROJECT + ')') + '\n');
  STEPS.forEach((s, i) => {
    const mark = progress.done.includes(s.id) ? c.green('✔') : c.dim('○');
    console.log(' ' + mark + ' ' + (i + 1) + '. ' + s.title);
    console.log('      ' + c.dim(s.why));
  });
  console.log('\n ' + c.bold('After the MVP:'));
  ROADMAP.forEach((r) => console.log('   • ' + r));
  console.log('');
}

async function main() {
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
      console.log(c.red('  ✖ ' + err.message));
      console.log(c.yellow('  Fix the issue and re-run the script — finished steps will be skipped.'));
      process.exitCode = 1;
      break;
    }
  }

  if (rl) rl.close();

  if (STEPS.every((s) => progress.done.includes(s.id))) {
    console.log(c.green(c.bold('\n🎉 MVP ready!')));
    console.log('   cd ' + path.relative(process.cwd(), PROJECT) + ' && npm start');
    console.log('   then open http://localhost:' + PORT + ' in TWO tabs and type in either one.\n');
  }
}

main();
