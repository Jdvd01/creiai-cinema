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

interface Props {
  code: string;
}

export function RoomView({ code }: Props) {
  const router = useRouter();
  const mainRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const livekitRoom = useRef<Room | null>(null);

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
  // Optimistic play/pause: updated immediately on click, cleared when real state:update arrives
  const [optimisticPaused, setOptimisticPaused] = useState<boolean | null>(null);

  // ── Read token from sessionStorage on mount ───────────────────────────────
  useEffect(() => {
    const token = sessionStorage.getItem(`lk_token_${code}`);
    const url = sessionStorage.getItem("lk_url");
    const myRole = sessionStorage.getItem("my_role") as "host" | "viewer";
    if (token && url) {
      setRole(myRole ?? "viewer");
      setLkToken(token);
      setLkUrl(url);
      // Apply last known state so late joiners see correct play/pause
      const storedState = sessionStorage.getItem(`state_${code}`);
      if (storedState) {
        try { setPlaybackState(JSON.parse(storedState)); } catch { /* ignore */ }
      }
    }
  }, [code]);

  // ── LiveKit connection ────────────────────────────────────────────────────
  useEffect(() => {
    if (!lkToken || !lkUrl) return;

    const room = new Room({ adaptiveStream: false, dynacast: false });
    livekitRoom.current = room;

    const onStateChange = (state: ConnectionState) => setConnectionState(state);
    const onTrackSubscribed = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video && videoRef.current) {
        track.attach(videoRef.current);
      }
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

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();

    socket.on("room:peers", (list) => setPeers(list));
    socket.on("peer:join", (peer) => setPeers((p) => [...p, peer]));
    socket.on("peer:leave", (peer) => setPeers((p) => p.filter((x) => x.id !== peer.id)));
    socket.on("host:left", () => setHostLeft(true));
    socket.on("state:update", (state) => {
      setPlaybackState(state);
      setOptimisticPaused(null); // real state arrived, clear optimistic
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

  const handlePlayPause = useCallback(() => {
    const next = !effectivePaused;
    setOptimisticPaused(next);
    sendControl({ type: next ? "pause" : "play" });
  }, [effectivePaused, sendControl]);

  const skip = useCallback((secs: number) => {
    const t = Math.max(0, duration > 0 ? Math.min(currentTime + secs, duration) : currentTime + secs);
    sendControl({ type: "seek", currentTime: t });
  }, [currentTime, duration, sendControl]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      mainRef.current?.requestFullscreen();
    }
  }, []);

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
        }}
      />
    );
  }

  // ── Host left ─────────────────────────────────────────────────────────────
  if (hostLeft) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
        <p className="text-2xl font-bold">🚪 El host se fue</p>
        <p className="text-neutral-400">La sala fue cerrada.</p>
        <button
          onClick={() => router.push("/")}
          className="rounded bg-blue-600 px-5 py-2 font-medium"
        >
          Volver al inicio
        </button>
      </div>
    );
  }

  return (
    <div ref={mainRef} className="flex h-screen flex-col bg-black text-white">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="font-bold">🎬 Creiai Cinema</span>
          <code className="rounded bg-neutral-800 px-2 py-0.5 text-xs font-mono text-neutral-300">
            {code}
          </code>
          <ConnectionBadge state={connectionState} />
        </div>
        <PeerList peers={peers} />
      </header>

      {/* LiveKit error banner */}
      {livekitError && (
        <div className="shrink-0 border-b border-red-800 bg-red-950 px-4 py-2 text-sm text-red-300">
          <span className="font-semibold">Error LiveKit:</span> {livekitError}
          {(livekitError.toLowerCase().includes("websocket") ||
            livekitError.toLowerCase().includes("connect")) && (
            <span className="ml-2 text-red-400">
              — ¿Está corriendo Docker?{" "}
              <code className="font-mono">docker compose up -d</code>
            </span>
          )}
        </div>
      )}

      {/* Video area */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        {role === "host" ? (
          <div className="flex flex-col items-center gap-4 p-8 text-center">
            <p className="text-xl font-semibold">Eres el host 🎥</p>
            <p className="max-w-sm text-sm text-neutral-400">
              Abre la película en otra pestaña, haz clic en el icono de la extensión Creiai Cinema
              y escribe el código{" "}
              <code className="font-mono text-white">{code}</code> para empezar a compartir.
            </p>
            <p className="text-xs text-neutral-500">
              {peers.length - 1} viewer{peers.length !== 2 ? "s" : ""} conectado
              {peers.length !== 2 ? "s" : ""}
            </p>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            onDoubleClick={toggleFullscreen}
            className="max-h-full max-w-full cursor-pointer"
            title="Doble clic para pantalla completa"
          />
        )}
      </div>

      {/* Controls bar */}
      <div className="shrink-0 border-t border-neutral-800 bg-neutral-900 px-4 py-3">
        {/* Progress / seek row */}
        <div className="mb-2 flex items-center gap-2 text-xs text-neutral-400">
          <span className="w-10 text-right tabular-nums">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration > 0 ? Math.floor(duration) : 100}
            value={Math.floor(currentTime)}
            onChange={(e) => sendControl({ type: "seek", currentTime: Number(e.target.value) })}
            disabled={duration === 0}
            className="flex-1 accent-blue-500 disabled:opacity-40"
          />
          <span className="w-10 tabular-nums">{duration > 0 ? formatTime(duration) : "--:--"}</span>
        </div>

        {/* Buttons row */}
        <div className="flex items-center gap-2 text-sm">
          {/* Skip back */}
          <button
            onClick={() => skip(-10)}
            className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
            title="Retroceder 10s"
          >
            ⏮ 10s
          </button>
          <button
            onClick={() => skip(-5)}
            className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
            title="Retroceder 5s"
          >
            ⏮ 5s
          </button>

          {/* Play / Pause */}
          <button
            onClick={handlePlayPause}
            className="rounded bg-white px-4 py-1.5 font-bold text-black hover:bg-neutral-200"
          >
            {effectivePaused ? "▶ Play" : "⏸ Pausa"}
          </button>

          {/* Skip forward */}
          <button
            onClick={() => skip(5)}
            className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
            title="Adelantar 5s"
          >
            5s ⏭
          </button>
          <button
            onClick={() => skip(10)}
            className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
            title="Adelantar 10s"
          >
            10s ⏭
          </button>

          {/* Velocity */}
          <div className="flex items-center gap-1 text-xs text-neutral-400">
            <span className="ml-2">Vel:</span>
            {[0.5, 1, 1.25, 1.5, 2].map((r) => (
              <button
                key={r}
                onClick={() => sendControl({ type: "rate", rate: r })}
                className={`rounded px-2 py-0.5 ${
                  playbackState?.rate === r ? "bg-blue-600 text-white" : "hover:bg-neutral-700"
                }`}
              >
                {r}x
              </button>
            ))}
          </div>

          {/* Volume + Fullscreen (viewer only) */}
          {role === "viewer" && (
            <div className="ml-auto flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setMuted((m) => !m)}
                  className="rounded px-1.5 py-0.5 text-base hover:bg-neutral-700"
                  title={muted ? "Activar sonido" : "Silenciar"}
                >
                  {muted ? "🔇" : volume === 0 ? "🔈" : volume < 0.5 ? "🔉" : "🔊"}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false); }}
                  className="w-20 accent-blue-500"
                  title="Volumen local"
                />
                <span className="w-8 text-xs text-neutral-500 tabular-nums">
                  {muted ? "0%" : `${Math.round(volume * 100)}%`}
                </span>
              </div>
              <button
                onClick={toggleFullscreen}
                className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
                title="Pantalla completa (o doble clic en el video)"
              >
                ⛶ Pantalla completa
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Join prompt ───────────────────────────────────────────────────────────────

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
        if (!res.ok) {
          setError(res.error ?? "Sala no encontrada");
          return;
        }
        sessionStorage.setItem(`lk_token_${code}`, res.livekitToken!);
        sessionStorage.setItem("lk_url", res.livekitUrl!);
        sessionStorage.setItem("my_name", name.trim());
        sessionStorage.setItem("my_role", "viewer");
        if (res.state) sessionStorage.setItem(`state_${code}`, JSON.stringify(res.state));
        onJoined(res.livekitToken!, res.livekitUrl!, "viewer", res.state);
      }
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-black p-4">
      <div className="flex flex-col items-center gap-1">
        <span className="text-2xl font-bold">🎬 Creiai Cinema</span>
        <p className="text-sm text-neutral-400">Unirse a la sala</p>
      </div>
      <code className="rounded-lg bg-neutral-800 px-4 py-2 font-mono text-lg tracking-widest text-white">
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
          className="rounded-lg border border-neutral-600 bg-neutral-800 px-4 py-2.5 text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue-600 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? "Conectando…" : "Unirse"}
        </button>
      </form>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const color =
    state === ConnectionState.Connected
      ? "bg-green-500"
      : state === ConnectionState.Connecting
      ? "bg-yellow-500"
      : "bg-red-500";
  const label =
    state === ConnectionState.Connected
      ? "Conectado"
      : state === ConnectionState.Connecting
      ? "Conectando…"
      : "Desconectado";
  return (
    <span className="flex items-center gap-1.5 text-xs text-neutral-400">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function PeerList({ peers }: { peers: PeerInfo[] }) {
  return (
    <div className="flex items-center gap-1">
      {peers.slice(0, 5).map((p) => (
        <span
          key={p.id}
          title={`${p.name} (${p.role})`}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-700 text-xs font-bold"
        >
          {p.name[0]?.toUpperCase()}
        </span>
      ))}
      {peers.length > 5 && (
        <span className="text-xs text-neutral-400">+{peers.length - 5}</span>
      )}
    </div>
  );
}
