/** Colour values shared between CSS and canvas drawing.
 *
 * Canvas cannot read custom properties directly, so the few colours the scopes
 * need are declared here and mirrored by the stylesheet. Two traces carry all
 * the meaning in this interface: a cool cyan for the source and a warm amber
 * for the processed result. That pairing separates on luminance as well as
 * hue, so it stays readable without relying on colour vision.
 */

export const theme = {
  ink: "#0a0c0c",
  panel: "#0f1312",
  grid: "#182220",
  gridStrong: "#22302d",
  rule: "#243230",
  textDim: "#98a5a0",
  textFaint: "#78857f",
  source: "#5fb2bd",
  sourceSoft: "rgba(95, 178, 189, 0.22)",
  processed: "#f0a93b",
  processedSoft: "rgba(240, 169, 59, 0.24)",
  warn: "#d9714a",
  playhead: "#e6ece9",
} as const;

/** Control points for the spectrogram ramp, dark floor through hot peaks. */
const RAMP: [number, [number, number, number]][] = [
  [0.0, [8, 11, 12]],
  [0.18, [12, 40, 46]],
  [0.38, [17, 84, 92]],
  [0.56, [46, 142, 138]],
  [0.72, [150, 176, 116]],
  [0.87, [240, 169, 59]],
  [1.0, [252, 240, 214]],
];

/** 256-entry RGBA lookup table used to colour spectrogram bytes. */
export function buildSpectrogramLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let index = 0; index < 256; index += 1) {
    const position = index / 255;
    let upper = 1;
    while (upper < RAMP.length - 1 && RAMP[upper][0] < position) upper += 1;
    const [lowStop, lowColour] = RAMP[upper - 1];
    const [highStop, highColour] = RAMP[upper];
    const span = highStop - lowStop || 1;
    const t = Math.min(Math.max((position - lowStop) / span, 0), 1);
    lut[index * 4] = lowColour[0] + (highColour[0] - lowColour[0]) * t;
    lut[index * 4 + 1] = lowColour[1] + (highColour[1] - lowColour[1]) * t;
    lut[index * 4 + 2] = lowColour[2] + (highColour[2] - lowColour[2]) * t;
    lut[index * 4 + 3] = 255;
  }
  return lut;
}

/** Decode the base64 spectrogram payload into raw bytes. */
export function decodeSpectrogram(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
