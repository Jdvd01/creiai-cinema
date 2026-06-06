/**
 * Content script — injected into every tab.
 *
 * Guard against multiple injections (extension reload injects a fresh copy
 * while the previous isolated-world instance may still be alive).
 */

import { log, warn } from "./logger";

// @ts-expect-error – isolated-world window property
if (window.__cinemaContentScriptActive) {
  // Already running — stop old interval so the new instance takes over cleanly
  // @ts-expect-error
  if (window.__cinemaStopReporting) window.__cinemaStopReporting();
}
// @ts-expect-error
window.__cinemaContentScriptActive = true;

let reportInterval: ReturnType<typeof setInterval> | null = null;

function findVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll("video"));
  if (!videos.length) return null;
  return (
    videos.sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0] ?? null
  );
}

// ── Listen for messages from background ───────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "CONTROL") {
    const video = findVideo();
    log(`[cinema] CONTROL ${msg.action?.type} — video:`, video ? `${video.videoWidth}x${video.videoHeight} src=${video.currentSrc.slice(0, 60)}` : "NOT FOUND");
    if (video) applyControl(msg.action);
  }
  if (msg.type === "START_REPORTING") {
    log("[cinema] START_REPORTING received");
    startReporting();
  }
  if (msg.type === "STOP_REPORTING") {
    stopReporting();
  }
});

function applyControl(action: { type: string; currentTime?: number; rate?: number }) {
  const video = findVideo();
  if (!video) return;

  switch (action.type) {
    case "play":
      video.play().catch((e) => warn("[cinema] play() failed:", e));
      break;
    case "pause":
      video.pause();
      break;
    case "seek":
      if (action.currentTime !== undefined) {
        log(`[cinema] seek to ${action.currentTime}, seekable:`, video.seekable.length > 0);
        video.currentTime = action.currentTime;
      }
      break;
    case "rate":
      if (action.rate !== undefined) video.playbackRate = action.rate;
      break;
  }
}

function startReporting() {
  if (reportInterval) clearInterval(reportInterval);
  reportInterval = setInterval(() => {
    const video = findVideo();
    if (!video) return;
    chrome.runtime.sendMessage({
      type: "STATE_REPORT",
      state: {
        paused: video.paused,
        currentTime: video.currentTime,
        duration: video.duration || 0,
        rate: video.playbackRate,
        ts: Date.now(),
      },
    }).catch(() => {/* context invalidated */});
  }, 1000);
}

function stopReporting() {
  if (reportInterval) {
    clearInterval(reportInterval);
    reportInterval = null;
  }
}

// Expose stop function for the multiple-injection guard
// @ts-expect-error
window.__cinemaStopReporting = stopReporting;
