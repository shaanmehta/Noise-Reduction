/** Formatting helpers for instrument-style readouts: fixed width, explicit sign. */

export function decibels(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(digits);
}

export function signedDecibels(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function hertz(value: number): string {
  if (!Number.isFinite(value)) return "--";
  if (value >= 10_000) return `${(value / 1000).toFixed(1)} kHz`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)} kHz`;
  return `${Math.round(value)} Hz`;
}

export function seconds(value: number): string {
  if (!Number.isFinite(value)) return "--";
  const whole = Math.floor(value);
  const hundredths = Math.floor((value - whole) * 100);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

export function bytes(value: number): string {
  if (value >= 1024 * 1024) return `${Math.round(value / (1024 * 1024))} MB`;
  return `${Math.round(value / 1024)} kB`;
}

export function channelLabel(channels: number, originalChannels?: number): string {
  const name = channels === 1 ? "Mono" : channels === 2 ? "Stereo" : `${channels} channels`;
  // Long clips are folded to mono to stay inside the deployed memory limit.
  // Say so rather than letting a stereo upload quietly come back mono.
  if (originalChannels !== undefined && originalChannels > channels) {
    return `${name} (from ${originalChannels === 2 ? "stereo" : `${originalChannels} channels`})`;
  }
  return name;
}

const METHOD_LABELS: Record<string, string> = {
  "activity-detection": "Activity detection",
  "energy-percentile": "Energy ranking",
  "fallback-split": "Even split",
};

export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}
