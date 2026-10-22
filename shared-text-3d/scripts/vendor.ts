// Copies three into public/ so any static host (wrangler dev, Vercel) serves it next to the client.
import { cpSync } from 'node:fs';

cpSync('node_modules/three/build', 'public/vendor/three', { recursive: true });
