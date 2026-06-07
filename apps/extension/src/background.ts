/**
 * Background service worker — Chrome MV3.
 */

import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, ControlAction, PlaybackState } from "@cinema/shared";
import { log, warn, error } from "./logger";
import { DEFAULT_QUALITY, DEFAULT_FPS, type QualityKey, type FpsOption } from "./quality";

declare const __SERVER_URL__: string;

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Inbound runtime messages — typed union so handlers below get narrowed
// fields instead of reading off an `any`-shaped `msg`.
type InboundMessage =
  | { type: "CREATE_ROOM"; tabId: number; hostName: string; quality?: QualityKey; fps?: FpsOption }
  | { type: "JOIN_ROOM"; tabId: number; code: string; hostName: string; quality?: QualityKey; fps?: FpsOption }
  | { type: "STOP_SHARING" }
  | { type: "STATE_REPORT"; state: PlaybackState }
  | { type: "GET_STATUS" }
  | { type: "FORWARD_TO_CONTENT"; inner: unknown };

let socket: AppSocket | null = null;
let currentRoom: string | null = null;
let capturedTabId: number | null = null;
let hostKey: string | null = null;
let offscreenCreated = false;
let startedAt: number | null = null;

// Keys persisted in chrome.storage.session so SW restart can restore state
const SESSION_KEYS = ["currentRoom", "capturedTabId", "livekitUrl", "livekitToken", "hostKey", "quality", "fps", "startedAt"] as const;

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
        sendToContentScript(capturedTabId, { type: "CONTROL", action });
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

// Tab navigation tears down the old content script; the manifest only
// re-injects on fresh document loads, leaving a gap where messages bounce
// with "Receiving end does not exist". Re-inject once and retry.
async function sendToContentScript(tabId: number, msg: unknown) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch (err) {
    warn("[cinema bg] sendMessage failed, re-injecting content script:", err);
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tabId, msg);
    } catch (retryErr) {
      error("[cinema bg] sendMessage retry after re-inject failed:", retryErr);
    }
  }
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
    quality?: QualityKey;
    fps?: FpsOption;
    startedAt?: number;
  };

  if (!stored.currentRoom || !stored.capturedTabId || !stored.livekitUrl || !stored.livekitToken || !stored.hostKey) return;

  log("[cinema] Restoring session after SW restart, room:", stored.currentRoom);
  currentRoom = stored.currentRoom;
  capturedTabId = stored.capturedTabId;
  hostKey = stored.hostKey;
  startedAt = stored.startedAt ?? Date.now();

  // Restart offscreen capture so stream and state reporting resume
  try {
    await startCapture(stored.capturedTabId, stored.livekitUrl, stored.livekitToken, stored.quality ?? DEFAULT_QUALITY, stored.fps ?? DEFAULT_FPS);
  } catch (err) {
    error("[cinema] Failed to restart capture after SW restart:", err);
    await chrome.storage.session.remove(SESSION_KEYS as unknown as string[]);
    currentRoom = null;
    capturedTabId = null;
  }
}

// ── Messages from popup & content script ─────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: InboundMessage, _sender, sendResponse) => {
  if (msg.type === "CREATE_ROOM") {
    handleCreateRoom(msg.tabId, msg.hostName, msg.quality, msg.fps)
      .then(sendResponse)
      .catch((err) => {
        error("[cinema] CREATE_ROOM failed:", err);
        sendResponse({ ok: false, error: String(err?.message ?? err) });
      });
    return true;
  }

  if (msg.type === "JOIN_ROOM") {
    handleJoinRoom(msg.tabId, msg.code, msg.hostName, msg.quality, msg.fps)
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
    const state = msg.state;
    if (currentRoom && hostKey) getSocket().emit("state:report", { code: currentRoom, state, hostKey });
    return false;
  }

  if (msg.type === "GET_STATUS") {
    sendResponse({ sharing: capturedTabId !== null, code: currentRoom, startedAt });
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
  quality: QualityKey,
  fps: FpsOption,
  key = "",
): Promise<void> {
  currentRoom = code;
  capturedTabId = tabId;
  hostKey = key;
  startedAt = Date.now();
  await chrome.storage.session.set({
    currentRoom: code,
    capturedTabId: tabId,
    livekitUrl,
    livekitToken,
    hostKey: key,
    quality,
    fps,
    startedAt,
  });
}

async function handleCreateRoom(
  tabId: number,
  hostName: string,
  quality: QualityKey = DEFAULT_QUALITY,
  fps: FpsOption = DEFAULT_FPS,
): Promise<{ ok: boolean; code?: string; error?: string }> {
  await ensureSocketConnected();

  return new Promise((resolve, reject) => {
    getSocket().emit("room:create", { hostName }, async (res) => {
      try {
        await startCapture(tabId, res.livekitUrl, res.livekitToken, quality, fps);
        await persistSession(res.code, tabId, res.livekitUrl, res.livekitToken, quality, fps, res.hostKey);
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
  hostName: string,
  quality: QualityKey = DEFAULT_QUALITY,
  fps: FpsOption = DEFAULT_FPS,
): Promise<{ ok: boolean; error?: string }> {
  await ensureSocketConnected();

  return new Promise((resolve, reject) => {
    getSocket().emit("room:join", { code, viewerName: hostName }, async (res) => {
      try {
        if (!res.ok) { resolve({ ok: false, error: res.error }); return; }
        await startCapture(tabId, res.livekitUrl!, res.livekitToken!, quality, fps);
        await persistSession(code, tabId, res.livekitUrl!, res.livekitToken!, quality, fps);
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

async function startCapture(tabId: number, livekitUrl: string, livekitToken: string, quality: QualityKey, fps: FpsOption) {
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

  // Register listener BEFORE createDocument so we don't miss OFFSCREEN_READY
  // if the document loads before we start listening.
  type MsgHandler = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
  let readyHandler!: MsgHandler;
  const readyPromise = new Promise<void>((resolve) => {
    readyHandler = (msg: { type?: string }) => {
      if (msg?.type === "OFFSCREEN_READY") {
        chrome.runtime.onMessage.removeListener(readyHandler);
        resolve();
      }
    };
    chrome.runtime.onMessage.addListener(readyHandler);
  });

  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen.html"),
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Capturar pestaña y publicar a LiveKit",
  });
  offscreenCreated = true;

  // Wait for offscreen to signal readiness (2 s fallback in case signal was missed)
  await Promise.race([
    readyPromise,
    new Promise<void>((r) => setTimeout(() => {
      chrome.runtime.onMessage.removeListener(readyHandler);
      warn("[cinema bg] OFFSCREEN_READY timeout — proceeding anyway");
      r();
    }, 2000)),
  ]);

  const streamId = await getTabCaptureStreamId(tabId);
  chrome.runtime.sendMessage({ type: "START_PUBLISH", streamId, livekitUrl, livekitToken, quality, fps });
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
  startedAt = null;
  chrome.storage.session.remove(SESSION_KEYS as unknown as string[]);
  socket?.disconnect();
  socket = null;
}
