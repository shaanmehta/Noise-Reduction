import { useEffect, useRef } from "react";

import { theme } from "../lib/theme";
import type { Waveform } from "../lib/types";

interface WaveformScopeProps {
  source: Waveform | null;
  processed: Waveform | null;
  duration: number;
  position: number;
  busy?: boolean;
  height?: number;
  onSeek?: (seconds: number) => void;
}

/**
 * Overlaid min/max envelopes for the source and processed signals.
 *
 * The source is drawn as a filled silhouette and the processed signal as a
 * line over the top, so the difference between them reads as the area that
 * has been removed rather than as two shapes to mentally subtract.
 */
export function WaveformScope({
  source,
  processed,
  duration,
  position,
  busy,
  height = 168,
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
      const amplitude = height / 2 - 6;

      // Reference graticule: centre line plus half-scale marks.
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

      // The source is a solid silhouette; the processed signal is an outline
      // over it. Drawing the second as a filled block too would simply hide
      // the first, and the point of the view is the difference between them.
      const silhouette = (data: Waveform, style: string) => {
        const count = data.max.length;
        if (count === 0) return;
        const step = width / count;
        context.beginPath();
        for (let index = 0; index < count; index += 1) {
          const x = index * step;
          context.moveTo(x, middle - data.max[index] * amplitude);
          context.lineTo(x, middle - data.min[index] * amplitude);
        }
        context.strokeStyle = style;
        context.lineWidth = Math.max(step, 1);
        context.globalAlpha = 0.55;
        context.stroke();
        context.globalAlpha = 1;
      };

      const envelope = (data: Waveform, style: string, fillStyle: string) => {
        const count = data.max.length;
        if (count === 0) return;
        const step = width / count;

        context.beginPath();
        for (let index = 0; index < count; index += 1) {
          const x = index * step;
          const y = middle - data.max[index] * amplitude;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        for (let index = count - 1; index >= 0; index -= 1) {
          context.lineTo(index * step, middle - data.min[index] * amplitude);
        }
        context.closePath();
        context.fillStyle = fillStyle;
        context.fill();
        context.strokeStyle = style;
        context.lineWidth = 1;
        context.stroke();
      };

      if (source) silhouette(source, theme.source);
      if (processed) envelope(processed, theme.processed, theme.processedSoft);

      if (duration > 0) {
        const x = Math.round((position / duration) * width) + 0.5;
        context.strokeStyle = theme.playhead;
        context.globalAlpha = 0.75;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
        context.globalAlpha = 1;
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [source, processed, duration, position, height]);

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
      aria-label="Waveform of the source audio overlaid with the processed result"
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
