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
  | { type: "CAPTURE_ENDED" }
  | { type: "STATE_REPORT"; state: PlaybackState }
  | { type: "GET_STATUS" }
  | { type: "FORWARD_TO_CONTENT"; inner: unknown };

let socket: AppSocket | null = null;
let currentRoom: string | null = null;
let capturedTabId: number | null = null;
let hostKey: string | null = null;
let captureWindowId: number | null = null;
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

  // getDisplayMedia needs a fresh user gesture — there's no headless way to
  // resume the capture window's stream after a SW restart. End the session.
  warn("[cinema] Can't silently resume capture after SW restart (getDisplayMedia needs a user gesture) — ending session");
  await chrome.storage.session.remove(SESSION_KEYS as unknown as string[]);
  currentRoom = null;
  capturedTabId = null;
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

  if (msg.type === "STOP_SHARING" || msg.type === "CAPTURE_ENDED") {
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
        await persistSession(res.code, tabId, res.livekitUrl, res.livekitToken, quality, fps, res.hostKey);
        await openCaptureWindow();
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
        await persistSession(code, tabId, res.livekitUrl!, res.livekitToken!, quality, fps);
        await openCaptureWindow();
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

// ── Capture window ────────────────────────────────────────────────────────────

const CAPTURE_WINDOW_WIDTH = 320;
const CAPTURE_WINDOW_HEIGHT = 220;

async function openCaptureWindow() {
  // Re-inject content script to ensure fresh context (extension reload invalidates old one)
  if (capturedTabId !== null) {
    await chrome.scripting.executeScript({
      target: { tabId: capturedTabId },
      files: ["content.js"],
    }).catch((err) => warn("[cinema bg] content script re-inject:", err));
  }

  // Close an existing capture window before opening a new one (handles SW restart)
  if (captureWindowId !== null) {
    await chrome.windows.remove(captureWindowId).catch(() => {});
    captureWindowId = null;
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("capture.html"),
    type: "popup",
    width: CAPTURE_WINDOW_WIDTH,
    height: CAPTURE_WINDOW_HEIGHT,
    focused: true,
  });
  captureWindowId = win.id ?? null;
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === captureWindowId) {
    captureWindowId = null;
    stopSharing();
  }
});

function stopSharing() {
  if (captureWindowId !== null) {
    chrome.windows.remove(captureWindowId).catch(() => {});
    captureWindowId = null;
  }
  currentRoom = null;
  capturedTabId = null;
  hostKey = null;
  startedAt = null;
  chrome.storage.session.remove(SESSION_KEYS as unknown as string[]);
  socket?.disconnect();
  socket = null;
}
