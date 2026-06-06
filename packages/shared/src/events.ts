/**
 * Shared Socket.io event types between server, web and extension.
 * Import from "@cinema/shared" in all packages.
 */

// ─── Room lifecycle ──────────────────────────────────────────────────────────

export interface RoomCreatePayload {
  /** Display name the host chose */
  hostName: string;
}

export interface RoomCreateResponse {
  code: string;
  livekitUrl: string;
  livekitToken: string;
  /** Opaque secret the host must include in state:report to authenticate reconnects */
  hostKey: string;
}

export interface RoomJoinPayload {
  code: string;
  viewerName: string;
}

export interface RoomJoinResponse {
  ok: boolean;
  error?: string;
  livekitUrl?: string;
  livekitToken?: string;
  /** Current playback state so late joiners sync up */
  state?: PlaybackState;
}

export interface PeerInfo {
  id: string;
  name: string;
  role: "host" | "viewer";
}

// ─── Playback control (viewer → server → host extension) ─────────────────────

export type ControlAction =
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; currentTime: number }
  | { type: "rate"; rate: number };

// ─── Playback state (host extension → server → all viewers) ──────────────────

export interface PlaybackState {
  paused: boolean;
  currentTime: number;
  duration: number;
  rate: number;
  /** Server epoch ms when this snapshot was taken (for drift correction) */
  ts: number;
}

// ─── Socket event map ─────────────────────────────────────────────────────────

/**
 * Events emitted by clients, received by server.
 */
export interface ClientToServerEvents {
  "room:create": (
    payload: RoomCreatePayload,
    cb: (res: RoomCreateResponse) => void
  ) => void;
  "room:join": (
    payload: RoomJoinPayload,
    cb: (res: RoomJoinResponse) => void
  ) => void;
  "control:action": (payload: { code: string; action: ControlAction }) => void;
  "state:report": (payload: { code: string; state: PlaybackState; hostKey: string }) => void;
}

/**
 * Events emitted by server, received by clients.
 */
export interface ServerToClientEvents {
  "room:peers": (peers: PeerInfo[]) => void;
  "peer:join": (peer: PeerInfo) => void;
  "peer:leave": (peer: PeerInfo) => void;
  "host:left": () => void;
  "control:action": (action: ControlAction) => void;
  "state:update": (state: PlaybackState) => void;
}
