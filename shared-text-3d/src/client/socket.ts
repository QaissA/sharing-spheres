import type { ClientToServerEvents, ServerToClientEvents } from '../shared/events.js';

export interface SyncHandlers {
  onText: (text: string) => void;
  onStatus: (online: boolean) => void;
}

type Listeners = { [E in keyof ServerToClientEvents]: ServerToClientEvents[E] } & {
  connect: () => void;
  disconnect: () => void;
};

// The few bits of a Socket.IO-style socket the app uses, over a plain WebSocket.
// Messages are JSON [event, data]; the server sends 'id' first on every connection.
export interface SyncSocket {
  id: string | undefined;
  on<E extends keyof Listeners>(event: E, fn: Listeners[E]): void;
  emit<E extends keyof ClientToServerEvents>(event: E, data: Parameters<ClientToServerEvents[E]>[0]): void;
}

const RECONNECT_MS = 2000;

function connectSocket(url: string): SyncSocket {
  const listeners = new Map<string, ((data?: unknown) => void)[]>();
  const fire = (event: string, data?: unknown) => listeners.get(event)?.forEach((fn) => fn(data));
  let ws: WebSocket;

  const socket: SyncSocket = {
    id: undefined,
    on(event, fn) { listeners.set(event, [...(listeners.get(event) ?? []), fn as (data?: unknown) => void]); },
    emit(event, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify([event, data])); },
  };

  function open(): void {
    ws = new WebSocket(url);
    ws.onmessage = (e) => {
      const [event, data] = JSON.parse(e.data as string) as [string, unknown];
      if (event === 'id') {
        socket.id = data as string;
        fire('connect');
      } else fire(event, data);
    };
    // Also fires after a failed attempt, so this keeps retrying while the server is away
    ws.onclose = () => {
      if (socket.id !== undefined) {
        socket.id = undefined;
        fire('disconnect');
      }
      setTimeout(open, RECONNECT_MS);
    };
  }
  open();
  return socket;
}

// Thin wrapper around the socket so main.ts doesn't care about event names.
export function createSync({ onText, onStatus }: SyncHandlers) {
  // Empty locally (same origin); the Vercel build fills in the Cloudflare Worker URL
  const configured = document.querySelector<HTMLMetaElement>('meta[name="socket-url"]')?.content;
  const url = configured || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  const socket = connectSocket(url);

  socket.on('connect', () => onStatus(true));
  socket.on('disconnect', () => onStatus(false));
  socket.on('text:init', onText);
  socket.on('text:update', onText);

  return {
    socket, // shared with sphereSync so both features use one connection
    send(text: string): void { socket.emit('text:update', text); },
  };
}
