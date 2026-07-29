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
}

export const FILTERS: FilterDefinition[] = [
  {
    kind: "spectral_gate",
    index: "01",
    label: "Spectral gate",
    shortLabel: "Gate",
    summary:
      "Measures the noise floor in every frequency band, then attenuates whichever bands fall back to it. Removes steady noise without touching the frequencies the signal occupies.",
  },
  {
    kind: "low_pass",
    index: "02",
    label: "Low pass",
    shortLabel: "Low",
    summary:
      "Keeps everything below the cutoff. Useful against hiss and other high-frequency noise sitting above the material you want.",
  },
  {
    kind: "high_pass",
    index: "03",
    label: "High pass",
    shortLabel: "High",
    summary:
      "Keeps everything above the cutoff. Removes rumble, handling noise and mains hum from the bottom of the spectrum.",
  },
  {
    kind: "band_pass",
    index: "04",
    label: "Band pass",
    shortLabel: "Band",
    summary:
      "Keeps a single band and rejects both extremes. Effective when the signal occupies a known range, as speech largely does.",
  },
];

export const ROLLOFFS: { value: Rolloff; label: string; summary: string }[] = [
  {
    value: "butterworth",
    label: "Butterworth",
    summary: "Flat passband with a smooth, monotonic slope. The default, and the gentlest on transients.",
  },
  {
    value: "cosine",
    label: "Cosine taper",
    summary: "A raised-cosine edge of adjustable width. Tighter than Butterworth, still free of ringing.",
  },
  {
    value: "brickwall",
    label: "Brick wall",
    summary: "An abrupt cutoff. Included for comparison: it rings audibly, which is why the others exist.",
  },
];

export function filterDefinition(kind: FilterKind): FilterDefinition {
  return FILTERS.find((entry) => entry.kind === kind) ?? FILTERS[0];
}

/** Which controls apply to which filter, so the panel only shows what matters. */
export function usesLowCutoff(kind: FilterKind): boolean {
  return kind === "high_pass" || kind === "band_pass";
}

export function usesHighCutoff(kind: FilterKind): boolean {
  return kind === "low_pass" || kind === "band_pass";
}

export function usesRolloff(kind: FilterKind): boolean {
  return kind !== "spectral_gate";
}
