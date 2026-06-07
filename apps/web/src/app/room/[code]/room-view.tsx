"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Room,
  RoomEvent,
  RemoteTrack,
  Track,
  ConnectionState,
} from "livekit-client";
import { getSocket } from "@/lib/socket";
import type { ControlAction, PeerInfo, PlaybackState, RoomJoinResponse } from "@cinema/shared";

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

interface Props { code: string; }

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

function SkipIcon({ direction, secs }: { direction: "back" | "forward"; secs: 5 | 10 }) {
  return (
    <span className="relative flex h-5 w-5 items-center justify-center">
      <svg viewBox="0 0 24 24" fill="currentColor" className="absolute h-5 w-5">
        {direction === "back" ? (
          <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
        ) : (
          <path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z" />
        )}
      </svg>
      <span className="relative z-10 mt-0.5 text-[7px] font-bold leading-none">{secs}</span>
    </span>
  );
}

function IconVolumeMute() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
    </svg>
  );
}

function IconVolumeLow() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M18.5 12A4.5 4.5 0 0 0 16 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
    </svg>
  );
}

function IconVolumeHigh() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}

function IconFullscreen() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
    </svg>
  );
}

function IconExitFullscreen() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
    </svg>
  );
}

function IconPeople() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
    </svg>
  );
}

// ─── Slider (reusable styled range input) ─────────────────────────────────────

interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  trackColor?: string;
  onChange: (v: number) => void;
  className?: string;
}

function Slider({ value, min = 0, max = 1, step = 0.01, disabled, trackColor = "bg-red-500", onChange, className = "" }: SliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className={`group relative flex cursor-pointer items-center ${className}`}>
      <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/20 group-hover:h-[5px] transition-all duration-150" />
      <div
        className={`absolute left-0 h-[3px] rounded-full group-hover:h-[5px] transition-all duration-150 ${trackColor}`}
        style={{ width: `${pct}%` }}
      />
      <div
        className={`absolute h-3 w-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity ${trackColor}`}
        style={{ left: `calc(${pct}% - 6px)` }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="relative z-10 h-[14px] w-full cursor-pointer opacity-0 disabled:cursor-default"
      />
    </div>
  );
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

// ─── RoomView ─────────────────────────────────────────────────────────────────

export function RoomView({ code }: Props) {
  const router = useRouter();
  const mainRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const livekitRoom = useRef<Room | null>(null);
  const peersRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsHovered = useRef(false);

  const [lkToken, setLkToken] = useState<string | null>(null);
  const [lkUrl, setLkUrl] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [playbackState, setPlaybackState] = useState<PlaybackState | null>(null);
  const [role, setRole] = useState<"host" | "viewer">("viewer");
  const [hostLeft, setHostLeft] = useState(false);
  const [livekitError, setLivekitError] = useState<string | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [optimisticPaused, setOptimisticPaused] = useState<boolean | null>(null);
  const [optimisticRate, setOptimisticRate] = useState<number | null>(null);
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPeers, setShowPeers] = useState(false);
  const [showSpeed, setShowSpeed] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [hud, setHud] = useState<{ type: "play" | "pause" | "back" | "fwd"; secs?: number; key: number } | null>(null);
  const hudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHud = useCallback((type: "play" | "pause" | "back" | "fwd", secs?: number) => {
    if (hudTimer.current) clearTimeout(hudTimer.current);
    setHud({ type, secs, key: Date.now() });
    hudTimer.current = setTimeout(() => setHud(null), 800);
  }, []);

  useEffect(() => () => {
    if (hudTimer.current) clearTimeout(hudTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  // ── Auto-hide controls on mouse idle ─────────────────────────────────────
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!controlsHovered.current) setShowControls(false);
    }, 3000);
  }, []);

  const revealControls = useCallback(() => {
    setShowControls(true);
    scheduleHide();
  }, [scheduleHide]);

  // ── Read token from sessionStorage ───────────────────────────────────────
  useEffect(() => {
    const token = sessionStorage.getItem(`lk_token_${code}`);
    const url = sessionStorage.getItem("lk_url");
    const myRole = sessionStorage.getItem("my_role") as "host" | "viewer";
    if (token && url) {
      setRole(myRole ?? "viewer");
      setLkToken(token);
      setLkUrl(url);
      const storedState = sessionStorage.getItem(`state_${code}`);
      if (storedState) {
        try { setPlaybackState(JSON.parse(storedState)); } catch { /* ignore */ }
      }
      const storedCreatedAt = sessionStorage.getItem(`created_${code}`);
      if (storedCreatedAt) setStreamStartedAt(Number(storedCreatedAt));
    }
  }, [code]);

  // ── "Time live" counter ───────────────────────────────────────────────────
  useEffect(() => {
    if (!streamStartedAt) return;
    const tick = () => setLiveSeconds(Math.max(0, Math.floor((Date.now() - streamStartedAt) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [streamStartedAt]);

  // ── LiveKit connection ────────────────────────────────────────────────────
  useEffect(() => {
    if (!lkToken || !lkUrl) return;
    const room = new Room({ adaptiveStream: false, dynacast: false });
    livekitRoom.current = room;
    const onStateChange = (state: ConnectionState) => setConnectionState(state);
    const onTrackSubscribed = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video && videoRef.current) track.attach(videoRef.current);
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach() as HTMLAudioElement;
        el.volume = volume;
        audioRef.current = el;
        document.body.appendChild(el);
      }
    };
    const onTrackUnsubscribed = (track: RemoteTrack) => {
      track.detach();
      if (track.kind === Track.Kind.Audio && audioRef.current) {
        audioRef.current.remove();
        audioRef.current = null;
      }
    };
    room.on(RoomEvent.ConnectionStateChanged, onStateChange);
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.connect(lkUrl, lkToken).catch((err: Error) => {
      console.error("[cinema] LiveKit connection failed:", err);
      setLivekitError(err.message ?? String(err));
    });
    return () => {
      room.off(RoomEvent.ConnectionStateChanged, onStateChange);
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lkToken, lkUrl]);

  // ── Volume sync ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
      audioRef.current.muted = muted;
    }
  }, [volume, muted]);

  // ── Fullscreen change detection ───────────────────────────────────────────
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // ── Click-outside to close dropdowns ─────────────────────────────────────
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (peersRef.current && !peersRef.current.contains(e.target as Node)) setShowPeers(false);
      if (speedRef.current && !speedRef.current.contains(e.target as Node)) setShowSpeed(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    socket.on("room:peers", (list) => setPeers(list));
    socket.on("peer:join", (peer) => setPeers((p) => [...p, peer]));
    socket.on("peer:leave", (peer) => setPeers((p) => p.filter((x) => x.id !== peer.id)));
    socket.on("host:left", () => setHostLeft(true));
    socket.on("state:update", (state) => {
      setPlaybackState(state);
      setOptimisticPaused(null);
      setOptimisticRate(null);
    });
    return () => {
      socket.off("room:peers");
      socket.off("peer:join");
      socket.off("peer:leave");
      socket.off("host:left");
      socket.off("state:update");
    };
  }, []);

  // ── Controls ──────────────────────────────────────────────────────────────
  const sendControl = useCallback((action: ControlAction) => {
    getSocket().emit("control:action", { code, action });
  }, [code]);

  const effectivePaused = optimisticPaused ?? playbackState?.paused ?? false;
  const duration = playbackState?.duration ?? 0;
  const currentTime = playbackState?.currentTime ?? 0;
  const currentRate = optimisticRate ?? playbackState?.rate ?? 1;

  const handlePlayPause = useCallback(() => {
    const next = !effectivePaused;
    setOptimisticPaused(next);
    sendControl({ type: next ? "pause" : "play" });
    showHud(next ? "pause" : "play");
  }, [effectivePaused, sendControl, showHud]);

  const skip = useCallback((secs: number) => {
    const t = Math.max(0, duration > 0 ? Math.min(currentTime + secs, duration) : currentTime + secs);
    sendControl({ type: "seek", currentTime: t });
    showHud(secs < 0 ? "back" : "fwd", Math.abs(secs));
  }, [currentTime, duration, sendControl, showHud]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else mainRef.current?.requestFullscreen();
  }, []);

  // ── Keyboard controls ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case " ":
        case "k":
        case "K":
          e.preventDefault();
          handlePlayPause();
          break;
        case "ArrowLeft":
          e.preventDefault();
          skip(-5);
          break;
        case "j":
        case "J":
          e.preventDefault();
          skip(-10);
          break;
        case "ArrowRight":
          e.preventDefault();
          skip(5);
          break;
        case "l":
        case "L":
          e.preventDefault();
          skip(10);
          break;
        case "m":
        case "M":
          e.preventDefault();
          setMuted((m) => !m);
          break;
        case "f":
        case "F":
          e.preventDefault();
          if (role === "viewer") toggleFullscreen();
          break;
        case "ArrowUp":
          if (role === "viewer") {
            e.preventDefault();
            setVolume((v) => Math.min(1, Math.round((v + 0.1) * 20) / 20));
            setMuted(false);
          }
          break;
        case "ArrowDown":
          if (role === "viewer") {
            e.preventDefault();
            setVolume((v) => Math.max(0, Math.round((v - 0.1) * 20) / 20));
          }
          break;
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handlePlayPause, skip, toggleFullscreen, role]);

  const VolumeIcon = muted || volume === 0
    ? IconVolumeMute
    : volume < 0.5
    ? IconVolumeLow
    : IconVolumeHigh;

  // ── Join prompt ───────────────────────────────────────────────────────────
  if (!lkToken) {
    return (
      <JoinPrompt
        code={code}
        onJoined={(token, url, myRole, initialState) => {
          setRole(myRole);
          setLkToken(token);
          setLkUrl(url);
          if (initialState) setPlaybackState(initialState);
          const storedCreatedAt = sessionStorage.getItem(`created_${code}`);
          if (storedCreatedAt) setStreamStartedAt(Number(storedCreatedAt));
        }}
      />
    );
  }

  // ── Host left ─────────────────────────────────────────────────────────────
  if (hostLeft) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-950 text-center text-white">
        <div className="text-6xl">🚪</div>
        <p className="text-2xl font-bold">El host se fue</p>
        <p className="text-neutral-400">La sala fue cerrada.</p>
        <button
          onClick={() => router.push("/")}
          className="mt-2 rounded-full bg-white px-6 py-2.5 font-semibold text-black transition-colors hover:bg-neutral-200"
        >
          Volver al inicio
        </button>
      </div>
    );
  }

  const overlayVisible = showControls || showPeers || showSpeed;

  return (
    <div
      ref={mainRef}
      className={`relative h-screen overflow-hidden select-none bg-black text-white ${overlayVisible ? "cursor-auto" : "cursor-none"}`}
      onMouseMove={revealControls}
      onMouseLeave={() => { if (hideTimer.current) clearTimeout(hideTimer.current); setShowControls(false); }}
    >
      {/* ── Video / host background ─────────────────────────────────────── */}
      {role === "host" ? (
        <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/5 text-4xl">🎥</div>
          <div>
            <p className="text-xl font-semibold">Eres el host</p>
            <p className="mt-1 max-w-sm text-sm text-neutral-400">
              Abre la película en otra pestaña, haz clic en el icono de la extensión
              Creiai Cinema y escribe el código para empezar a compartir.
            </p>
          </div>
          <code className="rounded-xl border border-white/20 bg-white/5 px-6 py-3 font-mono text-3xl font-bold tracking-[0.3em] text-white">
            {code}
          </code>
          <p className="text-xs text-neutral-500">
            {peers.length - 1} viewer{peers.length !== 2 ? "s" : ""} conectado{peers.length !== 2 ? "s" : ""}
          </p>
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          onDoubleClick={toggleFullscreen}
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}

      {/* ── Overlay chrome (header + controls) ──────────────────────────── */}
      <div
        className={`pointer-events-none absolute inset-0 flex flex-col justify-between transition-opacity duration-300 ${overlayVisible ? "opacity-100" : "opacity-0"}`}
        onMouseEnter={() => { controlsHovered.current = true; if (hideTimer.current) clearTimeout(hideTimer.current); }}
        onMouseLeave={() => { controlsHovered.current = false; scheduleHide(); }}
      >
        {/* Top: header */}
        <div className="pointer-events-auto bg-gradient-to-b from-black/80 via-black/40 to-transparent pb-12">
          <header className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="font-bold tracking-tight drop-shadow">🎬 Creiai Cinema</span>
              <code className="rounded border border-white/20 bg-black/40 px-2 py-0.5 font-mono text-xs text-neutral-300">
                {code}
              </code>
              <ConnectionBadge state={connectionState} />
              {streamStartedAt !== null && (
                <span
                  className="flex items-center gap-1.5 text-xs text-neutral-400"
                  title="Tiempo en vivo"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  {formatTime(liveSeconds)}
                </span>
              )}
            </div>

            {/* Participants dropdown */}
            <div className="relative" ref={peersRef}>
              <button
                onClick={() => setShowPeers((v) => !v)}
                className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm text-white transition-colors hover:bg-white/10"
              >
                <IconPeople />
                <span className="font-medium">{peers.length}</span>
              </button>

              {showPeers && (
                <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-white/10 bg-neutral-900 shadow-2xl">
                  <div className="border-b border-white/10 px-4 py-2.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                      Participantes ({peers.length})
                    </span>
                  </div>
                  <ul className="max-h-64 overflow-y-auto py-1">
                    {peers.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold">
                          {p.name[0]?.toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{p.name}</p>
                          <p className="text-xs capitalize text-neutral-400">{p.role}</p>
                        </div>
                        {p.role === "host" && (
                          <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-400">
                            host
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </header>

          {/* LiveKit error banner */}
          {livekitError && (
            <div className="mx-4 rounded-lg border border-red-800 bg-red-950/90 px-4 py-2 text-sm text-red-300">
              <span className="font-semibold">Error LiveKit:</span> {livekitError}
              {(livekitError.toLowerCase().includes("websocket") || livekitError.toLowerCase().includes("connect")) && (
                <span className="ml-2 text-red-400">
                  — ¿Está corriendo Docker? <code className="font-mono">docker compose up -d</code>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Bottom: controls */}
        <div className="pointer-events-auto bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-4 pt-16">

        {/* Progress bar */}
        <Slider
          value={Math.min(currentTime, duration > 0 ? duration : currentTime)}
          min={0}
          max={duration > 0 ? duration : 100}
          step={1}
          disabled={duration === 0}
          trackColor="bg-red-500"
          onChange={(v) => sendControl({ type: "seek", currentTime: v })}
          className="mb-3 h-4"
        />

        {/* Controls row */}
        <div className="flex items-center gap-1">

          {/* Skip back */}
          <button
            onClick={() => skip(-10)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
            title="Retroceder 10s"
          >
            <SkipIcon direction="back" secs={10} />
          </button>
          <button
            onClick={() => skip(-5)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
            title="Retroceder 5s"
          >
            <SkipIcon direction="back" secs={5} />
          </button>

          {/* Play / Pause */}
          <button
            onClick={handlePlayPause}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
            title={effectivePaused ? "Reproducir" : "Pausar"}
          >
            {effectivePaused ? <IconPlay /> : <IconPause />}
          </button>

          {/* Skip forward */}
          <button
            onClick={() => skip(5)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
            title="Adelantar 5s"
          >
            <SkipIcon direction="forward" secs={5} />
          </button>
          <button
            onClick={() => skip(10)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
            title="Adelantar 10s"
          >
            <SkipIcon direction="forward" secs={10} />
          </button>

          {/* Time */}
          <div className="ml-2 flex items-center gap-1 font-mono text-xs tabular-nums text-white/70">
            <span>{formatTime(currentTime)}</span>
            <span className="text-white/30">/</span>
            <span>{duration > 0 ? formatTime(duration) : "--:--"}</span>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Speed dropdown */}
          <div className="relative" ref={speedRef}>
            <button
              onClick={() => setShowSpeed((v) => !v)}
              className="flex h-9 items-center justify-center rounded-full px-3 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              title="Velocidad de reproducción"
            >
              {currentRate === 1 ? "Normal" : `${currentRate}x`}
            </button>
            {showSpeed && (
              <div className="absolute bottom-full right-0 z-50 mb-2 w-36 overflow-hidden rounded-xl border border-white/10 bg-neutral-900 py-1 shadow-2xl">
                <div className="border-b border-white/10 px-4 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    Velocidad
                  </span>
                </div>
                {SPEEDS.map((r) => (
                  <button
                    key={r}
                    onClick={() => { setOptimisticRate(r); sendControl({ type: "rate", rate: r }); setShowSpeed(false); }}
                    className={`flex w-full items-center justify-between px-4 py-2 text-sm transition-colors hover:bg-white/10 ${
                      currentRate === r ? "font-medium text-blue-400" : "text-white"
                    }`}
                  >
                    <span>{r === 1 ? "Normal" : `${r}x`}</span>
                    {currentRate === r && <IconCheck />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Volume (viewer only) */}
          {role === "viewer" && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMuted((m) => !m)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                title={muted ? "Activar sonido" : "Silenciar"}
              >
                <VolumeIcon />
              </button>
              <Slider
                value={muted ? 0 : volume}
                min={0}
                max={1}
                step={0.05}
                trackColor="bg-white"
                onChange={(v) => { setVolume(v); setMuted(false); }}
                className="h-4 w-20"
              />
            </div>
          )}

          {/* Fullscreen (viewer only) */}
          {role === "viewer" && (
            <button
              onClick={toggleFullscreen}
              className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
            >
              {isFullscreen ? <IconExitFullscreen /> : <IconFullscreen />}
            </button>
          )}
        </div>
      </div>
      </div>{/* end overlay */}

      {/* ── Center HUD feedback ──────────────────────────────────────────── */}
      {hud && (
        <div
          key={hud.key}
          className="pointer-events-none absolute inset-0 z-40"
        >
          {/* full-screen darkening */}
          <div className="animate-hud absolute inset-0 bg-black/30" />
          {/* center pill */}
          <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-hud flex flex-col items-center gap-2 rounded-2xl bg-black/70 px-8 py-6 backdrop-blur-md">
            {hud.type === "play" && (
              <svg viewBox="0 0 24 24" fill="white" className="h-14 w-14 drop-shadow-lg">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
            {hud.type === "pause" && (
              <svg viewBox="0 0 24 24" fill="white" className="h-14 w-14 drop-shadow-lg">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            )}
            {(hud.type === "back" || hud.type === "fwd") && (
              <>
                <svg viewBox="0 0 24 24" fill="white" className="h-10 w-10 drop-shadow-lg">
                  {hud.type === "back" ? (
                    <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
                  ) : (
                    <path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z" />
                  )}
                </svg>
                <span className="text-sm font-semibold text-white drop-shadow">
                  {hud.type === "back" ? "-" : "+"}{hud.secs}s
                </span>
              </>
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── JoinPrompt ───────────────────────────────────────────────────────────────

interface JoinPromptProps {
  code: string;
  onJoined: (token: string, url: string, role: "host" | "viewer", state?: PlaybackState) => void;
}

function JoinPrompt({ code, onJoined }: JoinPromptProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Escribe tu nombre"); return; }
    setLoading(true);
    setError("");
    const socket = getSocket();
    socket.emit(
      "room:join",
      { code, viewerName: name.trim() },
      (res: RoomJoinResponse) => {
        setLoading(false);
        if (!res.ok) { setError(res.error ?? "Sala no encontrada"); return; }
        sessionStorage.setItem(`lk_token_${code}`, res.livekitToken!);
        sessionStorage.setItem("lk_url", res.livekitUrl!);
        sessionStorage.setItem("my_name", name.trim());
        sessionStorage.setItem("my_role", "viewer");
        if (res.state) sessionStorage.setItem(`state_${code}`, JSON.stringify(res.state));
        if (res.createdAt) sessionStorage.setItem(`created_${code}`, String(res.createdAt));
        onJoined(res.livekitToken!, res.livekitUrl!, "viewer", res.state);
      }
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-neutral-950 p-4 text-white">
      <div className="flex flex-col items-center gap-1">
        <span className="text-3xl font-bold tracking-tight">🎬 Creiai Cinema</span>
        <p className="text-sm text-neutral-400">Unirse a la sala</p>
      </div>

      <code className="rounded-xl border border-white/10 bg-white/5 px-6 py-3 font-mono text-2xl font-bold tracking-[0.3em] text-white">
        {code}
      </code>

      <form onSubmit={handleJoin} className="flex w-full max-w-xs flex-col gap-3">
        <input
          type="text"
          placeholder="Tu nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
          autoFocus
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-neutral-500 outline-none transition-colors focus:border-white/30 focus:bg-white/10"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-white py-3 font-semibold text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
        >
          {loading ? "Conectando…" : "Unirse"}
        </button>
      </form>
    </div>
  );
}

// ─── ConnectionBadge ──────────────────────────────────────────────────────────

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const isConnected = state === ConnectionState.Connected;
  const isConnecting = state === ConnectionState.Connecting;
  const color = isConnected ? "bg-green-500" : isConnecting ? "bg-yellow-500" : "bg-red-500";
  const label = isConnected ? "Conectado" : isConnecting ? "Conectando…" : "Desconectado";
  return (
    <span className="flex items-center gap-1.5 text-xs text-neutral-400">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
