#!/bin/sh
# Static client for Vercel; the realtime server is the Cloudflare Worker at $SOCKET_URL (wss://.../ws)
set -e
npm run build
sed -i "s|name=\"socket-url\" content=\"\"|name=\"socket-url\" content=\"$SOCKET_URL\"|" public/index.html
