import { AccessToken, TrackSource } from "livekit-server-sdk";

const LIVEKIT_URL = process.env.LIVEKIT_URL ?? "ws://localhost:7880";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

const API_KEY = process.env.NODE_ENV === "production"
  ? requireEnv("LIVEKIT_API_KEY")
  : (process.env.LIVEKIT_API_KEY ?? "devkey");

const API_SECRET = process.env.NODE_ENV === "production"
  ? requireEnv("LIVEKIT_API_SECRET")
  : (process.env.LIVEKIT_API_SECRET ?? "devsecret00000000000000000000000");

export { LIVEKIT_URL };

/**
 * Issue a LiveKit JWT for a participant in a room.
 * - host: can publish anything (screen, screen audio, mic) + data.
 * - viewer: can only publish their microphone (voice chat) — never video/screen —
 *   and can always subscribe to everything (stream + everyone's voice).
 *
 * `identity` is the LiveKit participant identity — pass the socket.id so it stays
 * stable and matches `PeerInfo.id` for UI purposes (speaking indicators, etc).
 * `displayName` is the human-readable name shown in the UI.
 */
export async function createToken(
  roomName: string,
  identity: string,
  displayName: string,
  role: "host" | "viewer"
): Promise<string> {
  const at = new AccessToken(API_KEY, API_SECRET, {
    identity,
    name: displayName,
    ttl: "4h",
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canPublishSources: role === "host" ? undefined : [TrackSource.MICROPHONE],
    canPublishData: role === "host",
    canSubscribe: true,
  });

  return await at.toJwt();
}
