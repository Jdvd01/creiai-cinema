/**
 * Capture/publish quality presets — shared between popup, background and
 * offscreen so the user-picked option maps to consistent constraints.
 */

export type QualityKey = "low" | "medium" | "high" | "ultra";

export interface QualityPreset {
  label: string;
  maxWidth: number;
  maxHeight: number;
  maxBitrate: number;
}

// Resolution + bitrate tiers. Frame rate is chosen independently (see
// FPS_OPTIONS below) so e.g. "Ultra" at 24fps or "Baja" at 60fps both work.
export const QUALITY_PRESETS: Record<QualityKey, QualityPreset> = {
  low:    { label: "Baja — 480p · 1 Mbps",    maxWidth: 854,  maxHeight: 480,  maxBitrate: 1_000_000 },
  medium: { label: "Media — 720p · 2.5 Mbps", maxWidth: 1280, maxHeight: 720,  maxBitrate: 2_500_000 },
  high:   { label: "Alta — 720p · 4 Mbps",    maxWidth: 1280, maxHeight: 720,  maxBitrate: 4_000_000 },
  ultra:  { label: "Ultra — 1080p · 6 Mbps",  maxWidth: 1920, maxHeight: 1080, maxBitrate: 6_000_000 },
};

export const DEFAULT_QUALITY: QualityKey = "medium";

export function resolveQuality(key: unknown): QualityPreset {
  return QUALITY_PRESETS[key as QualityKey] ?? QUALITY_PRESETS[DEFAULT_QUALITY];
}

// ─── Frame rate ───────────────────────────────────────────────────────────────

export const FPS_OPTIONS = [24, 30, 60] as const;
export type FpsOption = (typeof FPS_OPTIONS)[number];

export const DEFAULT_FPS: FpsOption = 30;

export function resolveFps(value: unknown): FpsOption {
  return (FPS_OPTIONS as readonly number[]).includes(value as number)
    ? (value as FpsOption)
    : DEFAULT_FPS;
}
