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
    socket, // shared with sphereSync so both features use one connection
    send(text: string): void { socket.emit('text:update', text); },
  };
}
