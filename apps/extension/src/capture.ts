/**
 * Capture window — real (non-headless) extension page opened as a floating
 * popup window. Runs getDisplayMedia (full-screen + system audio, no 15fps
 * cap) and publishes the resulting tracks to LiveKit.
 *
 * Closing this window stops the broadcast (see background's
 * chrome.windows.onRemoved handler).
 */

import { Room, Track } from "livekit-client";
import { error } from "./logger";
import { resolveQuality, resolveFps } from "./quality";

const pickerView = document.getElementById("picker-view") as HTMLDivElement;
const liveView = document.getElementById("live-view") as HTMLDivElement;
const btnShare = document.getElementById("btn-share") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const errorEl = document.getElementById("error") as HTMLDivElement;
const liveDurationEl = document.getElementById("live-duration") as HTMLSpanElement;

let livekitRoom: Room | null = null;
let liveTimer: ReturnType<typeof setInterval> | null = null;

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function startLiveTimer(startedAt: number) {
  const tick = () => {
    liveDurationEl.textContent = formatDuration(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
  };
  tick();
  liveTimer = setInterval(tick, 1000);
}

function stopLiveTimer() {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
}

btnShare.addEventListener("click", () => {
  btnShare.disabled = true;
  errorEl.textContent = "";
  statusEl.textContent = "Conectando…";
  startSharing().catch((err) => {
    error("[cinema capture] startSharing failed:", err);
    errorEl.textContent = err?.message ?? "No se pudo iniciar la transmisión";
    statusEl.textContent = "";
    btnShare.disabled = false;
  });
});

btnStop.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CAPTURE_ENDED" });
});

async function startSharing() {
  const stored = await chrome.storage.session.get(["livekitUrl", "livekitToken", "quality", "fps", "startedAt"]) as {
    livekitUrl?: string;
    livekitToken?: string;
    quality?: unknown;
    fps?: unknown;
    startedAt?: number;
  };

  if (!stored.livekitUrl || !stored.livekitToken) {
    throw new Error("Faltan credenciales de la sala");
  }

  const preset = resolveQuality(stored.quality);
  const frameRate = resolveFps(stored.fps);

  // Native picker (gesture required — must happen here, can't be delegated).
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate, width: { max: preset.maxWidth }, height: { max: preset.maxHeight } },
    audio: true,
  });

  const videoTrack = stream.getVideoTracks()[0];
  const audioTrack = stream.getAudioTracks()[0];

  videoTrack?.addEventListener("ended", () => {
    chrome.runtime.sendMessage({ type: "CAPTURE_ENDED" });
  });

  const room = new Room();
  livekitRoom = room;
  await room.connect(stored.livekitUrl, stored.livekitToken, { autoSubscribe: false });

  if (videoTrack) {
    await room.localParticipant.publishTrack(videoTrack, {
      name: "screen",
      source: Track.Source.ScreenShare,
      videoEncoding: { maxBitrate: preset.maxBitrate, maxFramerate: frameRate },
      simulcast: false,
    });
  }

  if (audioTrack) {
    await room.localParticipant.publishTrack(audioTrack, {
      name: "screen-audio",
      source: Track.Source.ScreenShareAudio,
    });
  }

  chrome.runtime.sendMessage({ type: "FORWARD_TO_CONTENT", inner: { type: "START_REPORTING" } });

  pickerView.classList.add("hidden");
  liveView.classList.remove("hidden");
  statusEl.textContent = "✅ Transmitiendo";
  startLiveTimer(stored.startedAt ?? Date.now());
}

window.addEventListener("beforeunload", () => {
  livekitRoom?.disconnect();
  stopLiveTimer();
});
