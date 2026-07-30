import type { FilterKind, FilterSettings, Rolloff } from "./types";

export const DEFAULT_SETTINGS: FilterSettings = {
  kind: "spectral_gate",
  low_cutoff_hz: 300,
  high_cutoff_hz: 5000,
  rolloff: "butterworth",
  order: 4,
  transition_hz: 250,
  threshold_db: 6,
  reduction_db: -24,
  time_smoothing: 5,
  freq_smoothing: 3,
};

export interface FilterDefinition {
  kind: FilterKind;
  index: string;
  label: string;
  shortLabel: string;
  /** One line under the name, describing what the filter is for. */
  best: string;
}

export const FILTERS: FilterDefinition[] = [
  {
    kind: "spectral_gate",
    index: "01",
    label: "Spectral Gate",
    shortLabel: "Spectral Gate",
    best: "For steady or quiet noise.",
  },
  {
    kind: "low_pass",
    index: "02",
    label: "Low-Pass",
    shortLabel: "Low-Pass",
    best: "For high-frequency hiss.",
  },
  {
    kind: "high_pass",
    index: "03",
    label: "High-Pass",
    shortLabel: "High-Pass",
    best: "For low rumble.",
  },
  {
    kind: "band_pass",
    index: "04",
    label: "Band-Pass",
    shortLabel: "Band-Pass",
    best: "For targeted mid noise.",
  },
];

export const ROLLOFFS: { value: Rolloff; label: string; summary: string }[] = [
  { value: "butterworth", label: "Smooth", summary: "Gentle fade at the edge. Sounds the most natural." },
  { value: "cosine", label: "Tighter", summary: "A sharper edge that still avoids harshness." },
  { value: "brickwall", label: "Hard", summary: "An abrupt cut. Can sound harsh, included for comparison." },
];

export function filterDefinition(kind: FilterKind): FilterDefinition {
  return FILTERS.find((entry) => entry.kind === kind) ?? FILTERS[0];
}

export function usesLowCutoff(kind: FilterKind): boolean {
  return kind === "high_pass" || kind === "band_pass";
}

export function usesHighCutoff(kind: FilterKind): boolean {
  return kind === "low_pass" || kind === "band_pass";
}

export function usesRolloff(kind: FilterKind): boolean {
  return kind !== "spectral_gate";
}

/* ---------------------------------------------------------------------------
 * Plain-language mappings for the noise-removal controls.
 *
 * The underlying filter takes decibels and kernel widths, which mean nothing
 * to someone who just wants their recording to sound better. Each control
 * below is presented as a simple 1-to-10 or named scale and converted to the
 * real units here, so the interface stays approachable without the processing
 * losing any precision.
 * ------------------------------------------------------------------------ */

const STRENGTH_MIN_DB = -4;
const STRENGTH_MAX_DB = 26;

/** Slider position 1-10 to gate threshold in dB. */
export function strengthToDb(level: number): number {
  const t = (Math.min(Math.max(level, 1), 10) - 1) / 9;
  return STRENGTH_MIN_DB + t * (STRENGTH_MAX_DB - STRENGTH_MIN_DB);
}

export function dbToStrength(db: number): number {
  const t = (db - STRENGTH_MIN_DB) / (STRENGTH_MAX_DB - STRENGTH_MIN_DB);
  return Math.round(1 + Math.min(Math.max(t, 0), 1) * 9);
}

const DEPTH_MIN_DB = -6;
const DEPTH_MAX_DB = -48;

/** Slider position 1-10 to how far rejected sound is turned down, in dB. */
export function depthToDb(level: number): number {
  const t = (Math.min(Math.max(level, 1), 10) - 1) / 9;
  return DEPTH_MIN_DB + t * (DEPTH_MAX_DB - DEPTH_MIN_DB);
}

export function dbToDepth(db: number): number {
  const t = (db - DEPTH_MIN_DB) / (DEPTH_MAX_DB - DEPTH_MIN_DB);
  return Math.round(1 + Math.min(Math.max(t, 0), 1) * 9);
}

/** Named smoothing steps, each setting both kernel widths at once. */
export const SMOOTHING_STEPS: { label: string; time: number; freq: number }[] = [
  { label: "Off", time: 1, freq: 1 },
  { label: "Light", time: 3, freq: 1 },
  { label: "Normal", time: 5, freq: 3 },
  { label: "Strong", time: 9, freq: 5 },
  { label: "Maximum", time: 15, freq: 7 },
];

export function smoothingIndex(settings: FilterSettings): number {
  const match = SMOOTHING_STEPS.findIndex((step) => step.time === settings.time_smoothing);
  return match >= 0 ? match : 2;
}

export function strengthWord(level: number): string {
  if (level <= 2) return "Very gentle";
  if (level <= 4) return "Gentle";
  if (level <= 6) return "Balanced";
  if (level <= 8) return "Aggressive";
  return "Very aggressive";
}
