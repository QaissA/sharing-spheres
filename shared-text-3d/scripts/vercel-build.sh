#!/bin/sh
# Static client for Vercel; the Socket.IO server runs on Render at $SOCKET_URL
set -e
npm run build
mkdir -p public/vendor
cp -r node_modules/three/build public/vendor/three
# Serve the Socket.IO client from here: Render serves it without CORS headers, which module scripts need
cp node_modules/socket.io-client/dist/socket.io.esm.min.js public/vendor/
sed -i -e 's|/socket.io/socket.io.esm.min.js|/vendor/socket.io.esm.min.js|' \
  -e "s|name=\"socket-url\" content=\"\"|name=\"socket-url\" content=\"$SOCKET_URL\"|" public/index.html
