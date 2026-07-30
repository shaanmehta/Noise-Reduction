import { useEffect, useRef } from "react";

import { theme } from "../lib/theme";
import type { Waveform } from "../lib/types";

interface WaveformScopeProps {
  data: Waveform | null;
  /**
   * The source envelope, used only to set the vertical scale.
   *
   * Both traces are drawn at the same gain, derived from the source. Scaling
   * each one to its own peak would make a quiet recording and a loud one look
   * identical, and worse, would erase the very difference this view exists to
   * show: after filtering, the processed trace should visibly sit lower.
   */
  reference?: Waveform | null;
  /** Colours the trace to match the source/processed selection above it. */
  processed: boolean;
  duration: number;
  position: number;
  busy?: boolean;
  height?: number;
  onSeek?: (seconds: number) => void;
}

/**
 * Ceiling on the zoom applied to quiet recordings.
 *
 * 8x is +18 dB, enough to bring a quiet phone recording up to a readable
 * height without turning a near-silent clip into a wall of magnified noise.
 */
const MAX_GAIN = 8;

function peakOf(waveform: Waveform | null | undefined): number {
  if (!waveform || waveform.max.length === 0) return 1;
  let peak = 0;
  for (const value of waveform.max) peak = Math.max(peak, Math.abs(value));
  for (const value of waveform.min) peak = Math.max(peak, Math.abs(value));
  return peak;
}

/**
 * The loudness envelope of whichever track is selected.
 *
 * Only one signal is drawn at a time so the picture always matches what is
 * playing. Flipping between source and processed swaps the trace in place,
 * which makes the difference easier to see than two shapes layered together.
 */
export function WaveformScope({
  data,
  reference,
  processed,
  duration,
  position,
  busy,
  height = 280,
  onSeek,
}: WaveformScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = container.clientWidth;
      if (width === 0) return;

      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const middle = height / 2;
      const amplitude = height / 2 - 8;

      context.strokeStyle = theme.grid;
      context.lineWidth = 1;
      for (const fraction of [0.25, 0.75]) {
        context.beginPath();
        context.moveTo(0, Math.round(height * fraction) + 0.5);
        context.lineTo(width, Math.round(height * fraction) + 0.5);
        context.stroke();
      }
      context.strokeStyle = theme.gridStrong;
      context.beginPath();
      context.moveTo(0, Math.round(middle) + 0.5);
      context.lineTo(width, Math.round(middle) + 0.5);
      context.stroke();

      if (data && data.max.length) {
        // Fill the panel: a recording peaking at -20 dBFS would otherwise draw
        // as a barely visible line down the middle.
        const gain = Math.min(1 / Math.max(peakOf(reference ?? data), 1e-3), MAX_GAIN);
        const clamp = (value: number) => Math.max(-1, Math.min(1, value * gain));

        const count = data.max.length;
        const step = width / count;
        context.beginPath();
        for (let index = 0; index < count; index += 1) {
          const x = index * step;
          context.moveTo(x, middle - clamp(data.max[index]) * amplitude);
          context.lineTo(x, middle - clamp(data.min[index]) * amplitude);
        }
        context.strokeStyle = processed ? theme.processed : theme.source;
        context.lineWidth = Math.max(step, 1);
        context.stroke();
      }

      if (duration > 0) {
        const x = Math.round((position / duration) * width) + 0.5;
        context.strokeStyle = theme.playhead;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [data, reference, processed, duration, position, height]);

  const handleSeek = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || duration <= 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onSeek(((event.clientX - bounds.left) / bounds.width) * duration);
  };

  return (
    <div
      ref={containerRef}
      className={busy ? "scope scope--busy" : "scope"}
      style={{ height, cursor: onSeek ? "crosshair" : "default" }}
      onClick={handleSeek}
      role="img"
      aria-label={`Waveform of the ${processed ? "processed" : "source"} audio`}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
