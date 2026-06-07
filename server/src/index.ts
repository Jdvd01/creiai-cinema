import "dotenv/config";
import { randomBytes, timingSafeEqual } from "crypto";
import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@cinema/shared";
import { createToken, LIVEKIT_URL } from "./livekit";
import { log, warn } from "./logger";
import {
  generateCode,
  createRoom,
  getRoom,
  addPeer,
  removePeer,
  deleteRoom,
  setPlaybackState,
} from "./rooms";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = http.createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CORS_ORIGIN },
  transports: ["websocket", "polling"],
});

const CODE_RE = /^[A-Z2-9]{6}$/;
function isValidCode(code: unknown): code is string {
  return typeof code === "string" && CODE_RE.test(code);
}
function sanitizeName(name: unknown): string {
  if (typeof name !== "string") return "";
  return name.trim().slice(0, 32).replace(/[<>"]/g, "");
}

// Grace period timers: when host disconnects, wait before closing the room
// so a SW restart can reconnect and resume without viewers seeing "host left"
const pendingHostLeft = new Map<string, ReturnType<typeof setTimeout>>();

io.on("connection", (socket) => {
  log(`[+] socket ${socket.id}`);

  // ── Create room (host) ────────────────────────────────────────────────────
  socket.on("room:create", async (payload, cb) => {
    const hostName = sanitizeName(payload.hostName);
    if (!hostName) return;

    const code = generateCode();
    const hostKey = randomBytes(32).toString("hex");
    const room = createRoom(code, socket.id, hostName, hostKey);
    socket.join(code);

    const token = await createToken(code, hostName, "host");
    cb({ code, livekitUrl: LIVEKIT_URL, livekitToken: token, hostKey, createdAt: room.createdAt });

    log(`[room] created ${code} by ${hostName}`);
  });

  // ── Join room (viewer) ────────────────────────────────────────────────────
  socket.on("room:join", async (payload, cb) => {
    if (!isValidCode(payload.code)) {
      cb({ ok: false, error: "Invalid room code" });
      return;
    }
    const viewerName = sanitizeName(payload.viewerName);
    if (!viewerName) { cb({ ok: false, error: "Invalid name" }); return; }

    const room = getRoom(payload.code);
    if (!room) {
      cb({ ok: false, error: "Room not found" });
      return;
    }

    const peer = { id: socket.id, name: viewerName, role: "viewer" as const };
    addPeer(payload.code, socket.id, peer);
    socket.join(payload.code);

    const token = await createToken(payload.code, viewerName, "viewer");

    socket.to(payload.code).emit("peer:join", peer);
    socket.emit("room:peers", [...room.peers.values()]);

    cb({
      ok: true,
      livekitUrl: LIVEKIT_URL,
      livekitToken: token,
      state: room.lastState ?? undefined,
      createdAt: room.createdAt,
    });

    log(`[room] ${viewerName} joined ${payload.code}`);
  });

  // ── Control relayed viewer → host ─────────────────────────────────────────
  socket.on("control:action", ({ code, action }) => {
    const room = getRoom(code);
    log(`[ctrl] from=${socket.id} code=${code} action=${action.type} room=${room?.code ?? "NOT_FOUND"} hostSocket=${room?.hostSocketId ?? "-"}`);
    if (!room) return;
    io.to(room.hostSocketId).emit("control:action", action);
  });

  // ── State reported by host extension → all viewers ────────────────────────
  socket.on("state:report", ({ code, state, hostKey }) => {
    const room = getRoom(code);
    if (!room) {
      log(`[state] from=${socket.id} code=${code} room=NOT_FOUND — room deleted or never created`);
      return;
    }

    // SW restarted: new socket claiming to be host for this room — verify hostKey
    if (room.hostSocketId !== socket.id) {
      const providedBuf = Buffer.from(hostKey ?? "", "hex");
      const expectedBuf = Buffer.from(room.hostKey, "hex");
      const valid =
        providedBuf.length === expectedBuf.length &&
        timingSafeEqual(providedBuf, expectedBuf);
      if (!valid) {
        warn(`[state] rejected host takeover attempt from ${socket.id} for room ${code}`);
        return;
      }
      log(`[state] host socket changed: ${room.hostSocketId} → ${socket.id} for room ${code}`);
      // Cancel pending host:left if it was scheduled
      const timer = pendingHostLeft.get(code);
      if (timer) { clearTimeout(timer); pendingHostLeft.delete(code); }
      // Update peer map and hostSocketId
      const hostPeer = room.peers.get(room.hostSocketId);
      if (hostPeer) {
        room.peers.delete(room.hostSocketId);
        room.peers.set(socket.id, { ...hostPeer, id: socket.id });
      }
      room.hostSocketId = socket.id;
      socket.join(code);
    }

    setPlaybackState(code, state);
    socket.to(code).emit("state:update", state);
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const result = removePeer(socket.id);
    if (!result) return;
    const { room, peer } = result;

    if (peer.role === "host") {
      // Give the SW 8 s to reconnect before telling viewers the host left.
      // state:report from the new socket cancels this timer automatically.
      const timer = setTimeout(() => {
        pendingHostLeft.delete(room.code);
        deleteRoom(room.code);
        io.to(room.code).emit("host:left");
        log(`[room] host left (grace period expired), closed ${room.code}`);
      }, 8000);
      pendingHostLeft.set(room.code, timer);
      log(`[room] host disconnected from ${room.code}, waiting 8s for reconnect`);
    } else {
      io.to(room.code).emit("peer:leave", peer);
      log(`[room] ${peer.name} left ${room.code}`);
    }
  });
});

httpServer.listen(PORT, () => {
  log(`cinema server listening on :${PORT}`);
});
