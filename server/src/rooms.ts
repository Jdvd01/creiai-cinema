import { randomInt } from "crypto";
import type { PeerInfo, PlaybackState } from "@cinema/shared";

export interface Room {
  code: string;
  hostSocketId: string;
  hostKey: string;
  peers: Map<string, PeerInfo>;
  lastState: PlaybackState | null;
}

const rooms = new Map<string, Room>();

/** Generate a random 6-char uppercase room code */
export function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code: string;
  do {
    code = Array.from({ length: 6 }, () =>
      chars[randomInt(chars.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

export function createRoom(code: string, hostSocketId: string, hostName: string, hostKey: string): Room {
  const room: Room = {
    code,
    hostSocketId,
    hostKey,
    peers: new Map([
      [
        hostSocketId,
        { id: hostSocketId, name: hostName, role: "host" },
      ],
    ]),
    lastState: null,
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function getRoomBySocketId(socketId: string): Room | undefined {
  for (const room of rooms.values()) {
    if (room.peers.has(socketId)) return room;
  }
  return undefined;
}

export function addPeer(code: string, socketId: string, info: PeerInfo): void {
  rooms.get(code)?.peers.set(socketId, info);
}

export function removePeer(socketId: string): { room: Room; peer: PeerInfo } | null {
  const room = getRoomBySocketId(socketId);
  if (!room) return null;
  const peer = room.peers.get(socketId);
  if (!peer) return null;
  room.peers.delete(socketId);
  // Only clean up immediately if a viewer leaves with no one left.
  // When the host leaves, the caller (index.ts) starts a grace period timer
  // that calls deleteRoom() after 8s — don't delete here so reconnect can work.
  if (peer.role !== "host" && room.peers.size === 0) {
    rooms.delete(room.code);
  }
  return { room, peer };
}

export function deleteRoom(code: string): void {
  rooms.delete(code);
}

export function setPlaybackState(code: string, state: PlaybackState): void {
  const room = rooms.get(code);
  if (room) room.lastState = state;
}
