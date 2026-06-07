/**
 * Popup script.
 * Sends messages to background service worker.
 */

import { QUALITY_PRESETS, DEFAULT_QUALITY, type QualityKey, FPS_OPTIONS, DEFAULT_FPS, type FpsOption } from "./quality";

declare const __WEB_URL__: string;

const QUALITY_STORAGE_KEY = "cinema_quality";
const FPS_STORAGE_KEY = "cinema_fps";

const tabCreate = document.getElementById("tab-create") as HTMLButtonElement;
const tabJoin = document.getElementById("tab-join") as HTMLButtonElement;
const joinExtras = document.getElementById("join-extras") as HTMLDivElement;
const formView = document.getElementById("form-view") as HTMLDivElement;
const sharingView = document.getElementById("sharing-view") as HTMLDivElement;
const nameInput = document.getElementById("name") as HTMLInputElement;
const codeInput = document.getElementById("code") as HTMLInputElement;
const btnStart = document.getElementById("btn-start") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const roomCodeEl = document.getElementById("room-code") as HTMLDivElement;
const roomLinkEl = document.getElementById("room-link") as HTMLInputElement;
const btnCopy = document.getElementById("btn-copy") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const errorEl = document.getElementById("error") as HTMLDivElement;
const liveDurationEl = document.getElementById("live-duration") as HTMLSpanElement;
const qualitySelect = document.getElementById("quality") as HTMLSelectElement;
const fpsSelect = document.getElementById("fps") as HTMLSelectElement;

let activeTab: "create" | "join" = "create";
let liveTimer: ReturnType<typeof setInterval> | null = null;

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function startLiveTimer(startedAt: number) {
  stopLiveTimer();
  const tick = () => {
    liveDurationEl.textContent = formatDuration(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
  };
  tick();
  liveTimer = setInterval(tick, 1000);
}

function stopLiveTimer() {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
}

// ── Quality picker ────────────────────────────────────────────────────────────
for (const [key, preset] of Object.entries(QUALITY_PRESETS)) {
  const opt = document.createElement("option");
  opt.value = key;
  opt.textContent = preset.label;
  qualitySelect.appendChild(opt);
}
qualitySelect.value = (localStorage.getItem(QUALITY_STORAGE_KEY) as QualityKey | null) ?? DEFAULT_QUALITY;
qualitySelect.addEventListener("change", () => {
  localStorage.setItem(QUALITY_STORAGE_KEY, qualitySelect.value);
});

// ── FPS picker ────────────────────────────────────────────────────────────────
for (const fps of FPS_OPTIONS) {
  const opt = document.createElement("option");
  opt.value = String(fps);
  opt.textContent = `${fps} fps`;
  fpsSelect.appendChild(opt);
}
fpsSelect.value = localStorage.getItem(FPS_STORAGE_KEY) ?? String(DEFAULT_FPS);
fpsSelect.addEventListener("change", () => {
  localStorage.setItem(FPS_STORAGE_KEY, fpsSelect.value);
});

// ── Check if already sharing ──────────────────────────────────────────────────
chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res: { sharing: boolean; code: string | null; startedAt?: number | null }) => {
  if (res?.sharing && res.code) {
    showSharingView(res.code, res.startedAt ?? Date.now());
  }
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
tabCreate.addEventListener("click", () => {
  activeTab = "create";
  tabCreate.classList.add("active");
  tabJoin.classList.remove("active");
  joinExtras.style.display = "none";
  btnStart.textContent = "Compartir esta pestaña";
});

tabJoin.addEventListener("click", () => {
  activeTab = "join";
  tabJoin.classList.add("active");
  tabCreate.classList.remove("active");
  joinExtras.style.display = "block";
  btnStart.textContent = "Unirse y compartir";
});

// ── Start ─────────────────────────────────────────────────────────────────────
btnStart.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();
  errorEl.textContent = "";

  if (!name) { errorEl.textContent = "Escribe tu nombre"; return; }
  if (activeTab === "join" && !code) { errorEl.textContent = "Escribe el código de sala"; return; }

  btnStart.disabled = true;
  statusEl.textContent = "Conectando…";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { errorEl.textContent = "No se pudo obtener la pestaña activa"; btnStart.disabled = false; return; }

  const quality = qualitySelect.value as QualityKey;
  const fps = Number(fpsSelect.value) as FpsOption;

  if (activeTab === "create") {
    chrome.runtime.sendMessage(
      { type: "CREATE_ROOM", tabId: tab.id, hostName: name, quality, fps },
      (res: { ok: boolean; code?: string; error?: string } | undefined) => {
        btnStart.disabled = false;
        statusEl.textContent = "";
        if (!res || !res.ok) {
          errorEl.textContent = res?.error ?? "Error al crear sala. Revisa la consola del Service Worker.";
          return;
        }
        showSharingView(res.code!, Date.now());
      }
    );
  } else {
    chrome.runtime.sendMessage(
      { type: "JOIN_ROOM", tabId: tab.id, code, hostName: name, quality, fps },
      (res: { ok: boolean; error?: string }) => {
        btnStart.disabled = false;
        if (!res.ok) { errorEl.textContent = res.error ?? "Error al unirse"; statusEl.textContent = ""; return; }
        showSharingView(code, Date.now());
      }
    );
  }
});

// ── Stop ──────────────────────────────────────────────────────────────────────
btnStop.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "STOP_SHARING" }, () => {
    showFormView();
  });
});

// ── Copy link ──────────────────────────────────────────────────────────────────
btnCopy.addEventListener("click", () => {
  navigator.clipboard.writeText(roomLinkEl.value).then(() => {
    btnCopy.textContent = "✓ Copiado";
    setTimeout(() => { btnCopy.textContent = "Copiar"; }, 2000);
  });
});

roomLinkEl.addEventListener("click", () => roomLinkEl.select());

// ── View helpers ──────────────────────────────────────────────────────────────
function showSharingView(code: string, startedAt: number) {
  const url = `${__WEB_URL__}/room/${code}`;
  formView.classList.add("hidden");
  sharingView.classList.add("active");
  roomCodeEl.textContent = code;
  roomLinkEl.value = url;
  statusEl.textContent = "✅ Compartiendo";
  startLiveTimer(startedAt);
}

function showFormView() {
  formView.classList.remove("hidden");
  sharingView.classList.remove("active");
  statusEl.textContent = "";
  stopLiveTimer();
}
