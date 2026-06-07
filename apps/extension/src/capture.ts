/**
 * Capture window — real (non-headless) extension page opened as a floating
 * popup window. Runs getDisplayMedia (full-screen, uncapped fps, no 15fps
 * cap) and publishes the resulting tracks to LiveKit.
 *
 * It also doubles as the HOST's voice-chat console: a screen self-preview,
 * the participants list, and mic/speaker controls — mirroring what viewers
 * see in the web room, since the host never opens that page themselves.
 *
 * ── Anti-leak design ──────────────────────────────────────────────────────
 * Voice chat must NEVER bleed into the broadcast. If we captured the movie's
 * audio via the OS loopback (getDisplayMedia({audio:true})), it would also
 * pick up viewers' voices coming out of the host's speakers and rebroadcast
 * them — an echo loop. So:
 *   1. Video comes from getDisplayMedia WITHOUT audio.
 *   2. Movie audio comes from chrome.tabCapture — captured directly from the
 *      movie tab's audio graph, which never contains voice-chat playback,
 *      regardless of which speakers the host uses.
 *   3. Voice chat plays through a separately selectable output device
 *      (headphones) as a second line of defense.
 *
 * Closing this window stops the broadcast (see background's
 * chrome.windows.onRemoved handler).
 */

import { Room, RoomEvent, RemoteTrack, RemoteParticipant, Track, type Participant } from "livekit-client";
import type { PeerInfo } from "@cinema/shared";
import { error, warn } from "./logger";
import { resolveQuality, resolveFps } from "./quality";

const pickerView = document.getElementById("picker-view") as HTMLDivElement;
const liveView = document.getElementById("live-view") as HTMLDivElement;
const btnShare = document.getElementById("btn-share") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const btnMic = document.getElementById("btn-mic") as HTMLButtonElement;
const micSelect = document.getElementById("mic-select") as HTMLSelectElement;
const speakerSelect = document.getElementById("speaker-select") as HTMLSelectElement;
const previewEl = document.getElementById("preview") as HTMLVideoElement;
const peerListEl = document.getElementById("peer-list") as HTMLUListElement;
const peerCountEl = document.getElementById("peer-count") as HTMLSpanElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const errorEl = document.getElementById("error") as HTMLDivElement;
const liveDurationEl = document.getElementById("live-duration") as HTMLSpanElement;

const MIC_STORAGE_KEY = "cinema_voice_mic";
const SPEAKER_STORAGE_KEY = "cinema_voice_speaker";

let livekitRoom: Room | null = null;
let liveTimer: ReturnType<typeof setInterval> | null = null;
let micEnabled = false;

// PeerInfo list (forwarded from the background's socket — the capture window
// has no socket of its own) joined with live LiveKit speaking/mic state.
let peers: PeerInfo[] = [];
const speaking = new Set<string>();
const remoteAudioEls = new Map<string, HTMLAudioElement>();

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

// ── Device pickers (mic + voice output) ──────────────────────────────────────
//
// Requested up front (before sharing) so the native permission prompt happens
// on a clear user gesture and the host can pick devices before going live —
// per the requirement to ask mic permission and let them choose mic/speaker
// before joining the voice chat.

async function primeDevicePermissionAndPopulate() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch (err) {
    warn("[cinema capture] mic permission not granted yet:", err);
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  populateSelect(micSelect, devices.filter((d) => d.kind === "audioinput"), "Micrófono", localStorage.getItem(MIC_STORAGE_KEY));
  populateSelect(speakerSelect, devices.filter((d) => d.kind === "audiooutput"), "Altavoz", localStorage.getItem(SPEAKER_STORAGE_KEY));
}

function populateSelect(select: HTMLSelectElement, devices: MediaDeviceInfo[], fallbackLabel: string, saved: string | null) {
  select.innerHTML = "";
  if (devices.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = `${fallbackLabel} predeterminado`;
    select.appendChild(opt);
    return;
  }
  for (const d of devices) {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `${fallbackLabel} (${d.deviceId.slice(0, 6)})`;
    select.appendChild(opt);
  }
  if (saved && devices.some((d) => d.deviceId === saved)) select.value = saved;
}

micSelect.addEventListener("change", () => {
  localStorage.setItem(MIC_STORAGE_KEY, micSelect.value);
  // If we're already talking, swap the live capture to the new device.
  if (micEnabled && livekitRoom) {
    livekitRoom.localParticipant
      .setMicrophoneEnabled(true, { deviceId: micSelect.value || undefined })
      .catch((err) => warn("[cinema capture] mic device switch failed:", err));
  }
});

speakerSelect.addEventListener("change", () => {
  localStorage.setItem(SPEAKER_STORAGE_KEY, speakerSelect.value);
  applySinkToAllVoiceElements();
});

function applySinkToAllVoiceElements() {
  const sinkId = speakerSelect.value;
  if (!sinkId) return;
  for (const el of remoteAudioEls.values()) {
    // setSinkId is not in the standard lib.dom types yet on some TS targets.
    (el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> })
      .setSinkId?.(sinkId)
      .catch((err) => warn("[cinema capture] setSinkId failed:", err));
  }
}

void primeDevicePermissionAndPopulate();

// ── Participants panel ────────────────────────────────────────────────────────
//
// The capture window has no socket connection (that lives in the background
// service worker), so the peer list is forwarded from there. Speaking / mic
// state comes straight from this window's own LiveKit Room.

chrome.runtime.onMessage.addListener((msg: { type: string; peers?: PeerInfo[] }) => {
  if (msg.type === "PEERS_SNAPSHOT" && msg.peers) {
    peers = msg.peers;
    renderPeers();
  }
});

chrome.runtime.sendMessage({ type: "GET_PEERS" }, (res: { peers?: PeerInfo[] } | undefined) => {
  if (res?.peers) { peers = res.peers; renderPeers(); }
});

function micGlyphFor(identity: string): string {
  const participant = identity === livekitRoom?.localParticipant.identity
    ? livekitRoom?.localParticipant
    : livekitRoom?.remoteParticipants.get(identity);
  return participant?.isMicrophoneEnabled ? "🎤" : "🔇";
}

function renderPeers() {
  peerCountEl.textContent = String(peers.length);
  peerListEl.innerHTML = "";
  for (const p of peers) {
    const li = document.createElement("li");

    const avatar = document.createElement("span");
    avatar.className = "avatar" + (speaking.has(p.id) ? " speaking" : "");
    avatar.textContent = (p.name[0] ?? "?").toUpperCase();

    const name = document.createElement("span");
    name.className = "peer-name";
    name.textContent = p.name;

    const role = document.createElement("span");
    role.className = "peer-role";
    role.textContent = p.role === "host" ? "host" : "viewer";

    const mic = document.createElement("span");
    const glyph = micGlyphFor(p.id);
    mic.className = "mic-icon" + (glyph === "🎤" ? " live" : "");
    mic.textContent = glyph;
    mic.title = glyph === "🎤" ? "Hablando habilitado" : "Silenciado";

    li.append(avatar, name, role, mic);
    peerListEl.appendChild(li);
  }
}

// ── Sharing flow ──────────────────────────────────────────────────────────────

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

btnMic.addEventListener("click", () => {
  if (!livekitRoom) return;
  const next = !micEnabled;
  btnMic.disabled = true;
  livekitRoom.localParticipant
    .setMicrophoneEnabled(next, { deviceId: micSelect.value || undefined, echoCancellation: true, noiseSuppression: true })
    .then(() => {
      micEnabled = next;
      btnMic.setAttribute("aria-pressed", String(next));
      btnMic.textContent = next ? "🎤 Hablando" : "🎤 Hablar";
      renderPeers(); // refresh our own mic glyph
    })
    .catch((err) => {
      error("[cinema capture] mic toggle failed:", err);
      errorEl.textContent = "No se pudo acceder al micrófono";
    })
    .finally(() => { btnMic.disabled = false; });
});

/** Request the movie tab's audio-only MediaStreamTrack via the background SW
 *  (only it holds the "tabCapture" permission). This grabs audio straight
 *  from the tab's graph — never the OS loopback — so voice chat can never
 *  leak into it. */
function getTabAudioStreamId(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "GET_TAB_AUDIO_STREAM_ID" }, (res: { ok: boolean; streamId?: string; error?: string } | undefined) => {
      if (res?.ok && res.streamId) resolve(res.streamId);
      else reject(new Error(res?.error ?? "No se pudo capturar el audio de la pestaña"));
    });
  });
}

async function captureTabAudio(): Promise<MediaStreamTrack | null> {
  try {
    const streamId = await getTabAudioStreamId();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // @ts-expect-error chromeMediaSource/-Id are Chrome-only constraint extensions
        mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
      },
    });
    return stream.getAudioTracks()[0] ?? null;
  } catch (err) {
    warn("[cinema capture] tab audio capture failed (continuing without movie audio):", err);
    return null;
  }
}

/** chromeMediaSource:"tab" silences local playback of the tab — replay it
 *  through Web Audio so the host still hears their movie. */
function replayLocally(track: MediaStreamTrack) {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  source.connect(ctx.destination);
  track.addEventListener("ended", () => ctx.close().catch(() => {}));
}

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
  // No system-audio loopback: the movie's audio is captured separately from
  // the tab (see captureTabAudio), which is the anti-leak guarantee.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate, width: { max: preset.maxWidth }, height: { max: preset.maxHeight } },
    audio: false,
  });

  const videoTrack = stream.getVideoTracks()[0];

  videoTrack?.addEventListener("ended", () => {
    chrome.runtime.sendMessage({ type: "CAPTURE_ENDED" });
  });

  const room = new Room();
  livekitRoom = room;

  room.on(RoomEvent.ActiveSpeakersChanged, (active: Participant[]) => {
    speaking.clear();
    for (const p of active) speaking.add(p.identity);
    renderPeers();
  });
  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
    if (track.kind === Track.Kind.Audio && track.source === Track.Source.Microphone) {
      const el = track.attach() as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      el.muted = false;
      const sinkId = speakerSelect.value;
      if (sinkId) el.setSinkId?.(sinkId).catch(() => {});
      remoteAudioEls.set(participant.identity, el);
      document.body.appendChild(el);
    }
  });
  room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
    if (track.kind === Track.Kind.Audio && track.source === Track.Source.Microphone) {
      track.detach().forEach((el) => el.remove());
      remoteAudioEls.delete(participant.identity);
    }
  });
  room.on(RoomEvent.TrackMuted, () => renderPeers());
  room.on(RoomEvent.TrackUnmuted, () => renderPeers());
  room.on(RoomEvent.ParticipantConnected, () => renderPeers());
  room.on(RoomEvent.ParticipantDisconnected, () => renderPeers());

  // autoSubscribe: true — the host needs to hear everyone's voice. The host
  // never subscribes to its own ScreenShare/ScreenShareAudio (LiveKit doesn't
  // surface local tracks as subscriptions), so it naturally never hears the
  // transmission — exactly the "viewer without transmission audio" the host
  // console is meant to be.
  await room.connect(stored.livekitUrl, stored.livekitToken, { autoSubscribe: true });

  if (videoTrack) {
    await room.localParticipant.publishTrack(videoTrack, {
      name: "screen",
      source: Track.Source.ScreenShare,
      videoEncoding: { maxBitrate: preset.maxBitrate, maxFramerate: frameRate },
      simulcast: false,
    });
    previewEl.srcObject = new MediaStream([videoTrack]);
  }

  const tabAudioTrack = await captureTabAudio();
  if (tabAudioTrack) {
    replayLocally(tabAudioTrack);
    await room.localParticipant.publishTrack(tabAudioTrack, {
      name: "screen-audio",
      source: Track.Source.ScreenShareAudio,
    });
  }

  // Start muted — voice is opt-in (toggle to talk).
  micEnabled = false;
  btnMic.setAttribute("aria-pressed", "false");
  btnMic.textContent = "🎤 Hablar";

  chrome.runtime.sendMessage({ type: "FORWARD_TO_CONTENT", inner: { type: "START_REPORTING" } });

  pickerView.classList.add("hidden");
  liveView.classList.remove("hidden");
  statusEl.textContent = "✅ Transmitiendo";
  startLiveTimer(stored.startedAt ?? Date.now());
  renderPeers();
}

window.addEventListener("beforeunload", () => {
  livekitRoom?.disconnect();
  stopLiveTimer();
});
