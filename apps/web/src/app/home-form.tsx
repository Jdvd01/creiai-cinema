"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/socket";
import type { RoomCreateResponse, RoomJoinResponse } from "@cinema/shared";

type Tab = "create" | "join";

export function HomeForm() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("create");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Ingresa tu nombre"); return; }
    if (tab === "join" && !code.trim()) { setError("Ingresa el código de sala"); return; }
    setLoading(true);

    const socket = getSocket();

    if (tab === "create") {
      socket.emit("room:create", { hostName: name.trim() }, (res: RoomCreateResponse) => {
        // Store token/url in sessionStorage for the room page
        sessionStorage.setItem(`lk_token_${res.code}`, res.livekitToken);
        sessionStorage.setItem("lk_url", res.livekitUrl);
        sessionStorage.setItem("my_name", name.trim());
        sessionStorage.setItem("my_role", "host");
        router.push(`/room/${res.code}`);
      });
    } else {
      socket.emit(
        "room:join",
        { code: code.trim().toUpperCase(), viewerName: name.trim() },
        (res: RoomJoinResponse) => {
          if (!res.ok) {
            setError(res.error ?? "Error al unirse");
            setLoading(false);
            return;
          }
          const roomCode = code.trim().toUpperCase();
          sessionStorage.setItem(`lk_token_${roomCode}`, res.livekitToken!);
          sessionStorage.setItem("lk_url", res.livekitUrl!);
          sessionStorage.setItem("my_name", name.trim());
          sessionStorage.setItem("my_role", "viewer");
          if (res.state) sessionStorage.setItem(`state_${roomCode}`, JSON.stringify(res.state));
          router.push(`/room/${roomCode}`);
        }
      );
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-neutral-700 bg-neutral-900 p-6"
    >
      {/* Tabs */}
      <div className="flex rounded-lg bg-neutral-800 p-1">
        {(["create", "join"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? "bg-white text-black"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            {t === "create" ? "Crear sala" : "Unirse"}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="Tu nombre"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={24}
        className="rounded-lg border border-neutral-600 bg-neutral-800 px-4 py-2.5 text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
      />

      {tab === "join" && (
        <input
          type="text"
          placeholder="Código de sala (ej. ABC123)"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          className="rounded-lg border border-neutral-600 bg-neutral-800 px-4 py-2.5 font-mono text-white uppercase placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
        />
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-blue-600 py-2.5 font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
      >
        {loading ? "Conectando…" : tab === "create" ? "Crear sala" : "Unirse"}
      </button>
    </form>
  );
}
