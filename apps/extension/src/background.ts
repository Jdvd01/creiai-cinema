/**
 * Background service worker — Chrome MV3.
 */

import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, ControlAction, PlaybackState } from "@cinema/shared";
import { log, warn, error } from "./logger";

declare const __SERVER_URL__: string;

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;
let currentRoom: string | null = null;
let capturedTabId: number | null = null;
let hostKey: string | null = null;
let offscreenCreated = false;

// Keys persisted in chrome.storage.session so SW restart can restore state
const SESSION_KEYS = ["currentRoom", "capturedTabId", "livekitUrl", "livekitToken", "hostKey"] as const;

// ── Socket ────────────────────────────────────────────────────────────────────

function getSocket(): AppSocket {
  if (!socket || !socket.connected) {
    socket = io(__SERVER_URL__, { transports: ["websocket"] });

    socket.on("connect_error", (err) => {
      error("[cinema] socket connect_error:", err.message);
    });

    socket.on("control:action", (action: ControlAction) => {
      log("[cinema bg] control:action received:", action.type, "capturedTabId:", capturedTabId);
      if (capturedTabId !== null) {
        chrome.tabs.sendMessage(capturedTabId, { type: "CONTROL", action }).catch((err) => {
          error("[cinema bg] sendMessage to content script failed:", err);
        });
      } else {
        warn("[cinema bg] control:action dropped — capturedTabId is null");
      }
    });

    // On reconnect: restore session so state:report keeps flowing
    socket.on("connect", () => {
      restoreSessionAfterRestart().catch(error);
    });
  }
  return socket;
}

// ── SW restart recovery ───────────────────────────────────────────────────────

async function restoreSessionAfterRestart() {
  // Already have a room in memory — nothing to restore
  if (currentRoom) return;

  const stored = await chrome.storage.session.get(SESSION_KEYS as unknown as string[]) as {
    currentRoom?: string;
    capturedTabId?: number;
    livekitUrl?: string;
    livekitToken?: string;
    hostKey?: string;
  };

  if (!stored.currentRoom || !stored.capturedTabId || !stored.livekitUrl || !stored.livekitToken || !stored.hostKey) return;

  log("[cinema] Restoring session after SW restart, room:", stored.currentRoom);
  currentRoom = stored.currentRoom;
  capturedTabId = stored.capturedTabId;
  hostKey = stored.hostKey;

  // Restart offscreen capture so stream and state reporting resume
  try {
    await startCapture(stored.capturedTabId, stored.livekitUrl, stored.livekitToken);
  } catch (err) {
    error("[cinema] Failed to restart capture after SW restart:", err);
    await chrome.storage.session.remove(SESSION_KEYS as unknown as string[]);
    currentRoom = null;
    capturedTabId = null;
  }
}

// ── Messages from popup & content script ─────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "CREATE_ROOM") {
    handleCreateRoom(msg.tabId, msg.hostName)
      .then(sendResponse)
      .catch((err) => {
        error("[cinema] CREATE_ROOM failed:", err);
        sendResponse({ ok: false, error: String(err?.message ?? err) });
      });
    return true;
  }

  if (msg.type === "JOIN_ROOM") {
    handleJoinRoom(msg.tabId, msg.code, msg.hostName)
      .then(sendResponse)
      .catch((err) => {
        error("[cinema] JOIN_ROOM failed:", err);
        sendResponse({ ok: false, error: String(err?.message ?? err) });
      });
    return true;
  }

  if (msg.type === "STOP_SHARING") {
    stopSharing();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "STATE_REPORT") {
    const state = msg.state as PlaybackState;
    if (currentRoom && hostKey) getSocket().emit("state:report", { code: currentRoom, state, hostKey });
    return false;
  }

  if (msg.type === "GET_STATUS") {
    sendResponse({ sharing: capturedTabId !== null, code: currentRoom });
    return false;
  }

  if (msg.type === "FORWARD_TO_CONTENT") {
    if (capturedTabId !== null) {
      chrome.tabs.sendMessage(capturedTabId, msg.inner).catch(() => {});
    }
    return false;
  }
});

// ── Room management ───────────────────────────────────────────────────────────

async function persistSession(
  code: string,
  tabId: number,
  livekitUrl: string,
  livekitToken: string,
  key = "",
): Promise<void> {
  currentRoom = code;
  capturedTabId = tabId;
  hostKey = key;
  await chrome.storage.session.set({
    currentRoom: code,
    capturedTabId: tabId,
    livekitUrl,
    livekitToken,
    hostKey: key,
  });
}

async function handleCreateRoom(
  tabId: number,
  hostName: string
): Promise<{ ok: boolean; code?: string; error?: string }> {
  await ensureSocketConnected();

  return new Promise((resolve, reject) => {
    getSocket().emit("room:create", { hostName }, async (res) => {
      try {
        await startCapture(tabId, res.livekitUrl, res.livekitToken);
        await persistSession(res.code, tabId, res.livekitUrl, res.livekitToken, res.hostKey);
        resolve({ ok: true, code: res.code });
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function handleJoinRoom(
  tabId: number,
  code: string,
  hostName: string
): Promise<{ ok: boolean; error?: string }> {
  await ensureSocketConnected();

  return new Promise((resolve, reject) => {
    getSocket().emit("room:join", { code, viewerName: hostName }, async (res) => {
      try {
        if (!res.ok) { resolve({ ok: false, error: res.error }); return; }
        await startCapture(tabId, res.livekitUrl!, res.livekitToken!);
        await persistSession(code, tabId, res.livekitUrl!, res.livekitToken!);
        resolve({ ok: true });
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Wait up to 5 s for the socket to connect before emitting
function ensureSocketConnected(): Promise<void> {
  const s = getSocket();
  if (s.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("No se pudo conectar al servidor (timeout)")), 5000);
    s.once("connect", () => { clearTimeout(timeout); resolve(); });
    s.once("connect_error", (err) => { clearTimeout(timeout); reject(err); });
  });
}

// ── Tab capture + offscreen ───────────────────────────────────────────────────

async function startCapture(tabId: number, livekitUrl: string, livekitToken: string) {
  // Re-inject content script to ensure fresh context (extension reload invalidates old one)
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  }).catch((err) => warn("[cinema bg] content script re-inject:", err));

  // Close existing offscreen doc before creating a new one (handles SW restart)
  if (offscreenCreated) {
    await chrome.offscreen.closeDocument().catch(() => {});
    offscreenCreated = false;
  }

  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen.html"),
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Capturar pestaña y publicar a LiveKit",
  });
  offscreenCreated = true;

  const streamId = await getTabCaptureStreamId(tabId);
  chrome.runtime.sendMessage({ type: "START_PUBLISH", streamId, livekitUrl, livekitToken });
}

async function getTabCaptureStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError || !id) {
        reject(new Error(chrome.runtime.lastError?.message ?? "tabCapture falló"));
      } else {
        resolve(id);
      }
    });
  });
}

function stopSharing() {
  if (offscreenCreated) {
    chrome.runtime.sendMessage({ type: "STOP_PUBLISH" });
    chrome.offscreen.closeDocument().catch(() => {});
    offscreenCreated = false;
  }
  currentRoom = null;
  capturedTabId = null;
  hostKey = null;
  chrome.storage.session.remove(SESSION_KEYS as unknown as string[]);
  socket?.disconnect();
  socket = null;
}
