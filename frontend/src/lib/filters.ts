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
  summary: string;
  best: string;
}

export const FILTERS: FilterDefinition[] = [
  {
    kind: "spectral_gate",
    index: "01",
    label: "Noise removal",
    shortLabel: "Noise removal",
    summary: "Learns what the background noise sounds like, then turns it down and leaves everything else alone.",
    best: "Best all-round choice",
  },
  {
    kind: "low_pass",
    index: "02",
    label: "Cut highs",
    shortLabel: "Cut highs",
    summary: "Keeps low sounds and removes high ones.",
    best: "Good for hiss",
  },
  {
    kind: "high_pass",
    index: "03",
    label: "Cut lows",
    shortLabel: "Cut lows",
    summary: "Keeps high sounds and removes low ones.",
    best: "Good for rumble and hum",
  },
  {
    kind: "band_pass",
    index: "04",
    label: "Keep middle",
    shortLabel: "Keep middle",
    summary: "Removes both the lowest and the highest sounds.",
    best: "Good for speech",
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
