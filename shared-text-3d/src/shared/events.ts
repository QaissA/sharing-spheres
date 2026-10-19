// Event contract shared by server and client — a typo in an event name is now a compile error.

// One window's sphere. x/y are SCREEN pixels (origin top-left of the physical screen, y down).
export interface SphereState {
  x: number;
  y: number;
  radius: number;
  color: number; // 0xRRGGBB
}

export interface Sphere extends SphereState {
  id: string; // the owning socket's id
}

export interface ServerToClientEvents {
  'text:init': (text: string) => void;
  'text:update': (text: string) => void;
  'sphere:all': (spheres: Sphere[]) => void;
  'sphere:update': (sphere: Sphere) => void;
  'sphere:leave': (id: string) => void;
}

export interface ClientToServerEvents {
  'text:update': (text: string) => void;
  'sphere:update': (state: SphereState) => void;
}
