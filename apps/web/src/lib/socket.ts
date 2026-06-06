import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@cinema/shared";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

function getServerUrl(): string {
  // Explicit override wins (useful for production with separate API domain)
  const explicit = process.env.NEXT_PUBLIC_SERVER_URL;
  if (explicit) return explicit;

  // Auto-detect: same host as the web app, port 3001.
  // Works for localhost, LAN IPs, and any domain without config changes.
  if (typeof window === "undefined") return "http://localhost:3001";
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:3001`;
}

export function getSocket(): AppSocket {
  if (!socket) {
    socket = io(getServerUrl(), {
      transports: ["websocket"],
      autoConnect: true,
    });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
