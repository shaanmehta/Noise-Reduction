import { useEffect, useMemo, useRef } from "react";

import { hertz } from "../lib/format";
import { buildSpectrogramLut, decodeSpectrogram, theme } from "../lib/theme";
import type { Spectrogram } from "../lib/types";

interface SpectrogramScopeProps {
  data: Spectrogram | null;
  duration: number;
  position: number;
  busy?: boolean;
  height?: number;
  onSeek?: (seconds: number) => void;
}

/**
 * The STFT magnitude itself: time across, log frequency up, level as colour.
 *
 * This is the object every filter in the application actually operates on, so
 * it is rendered at full width rather than tucked away as an illustration.
 * Pixels are blitted through a lookup table and scaled by the canvas, which is
 * fast enough to redraw on every parameter change.
 */
export function SpectrogramScope({
  data,
  duration,
  position,
  busy,
  height = 220,
  onSeek,
}: SpectrogramScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lut = useMemo(() => buildSpectrogramLut(), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !data || data.width === 0) return;

    const draw = () => {
      const width = container.clientWidth;
      if (width === 0) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);

      const context = canvas.getContext("2d");
      if (!context) return;

      // Paint the grid at native resolution, then scale it up. Nearest
      // neighbour would show the banding, so smoothing stays on.
      const bytes = decodeSpectrogram(data.data);
      const image = context.createImageData(data.width, data.height);
      for (let index = 0; index < data.width * data.height; index += 1) {
        const value = bytes[index] * 4;
        image.data[index * 4] = lut[value];
        image.data[index * 4 + 1] = lut[value + 1];
        image.data[index * 4 + 2] = lut[value + 2];
        image.data[index * 4 + 3] = 255;
      }

      const offscreen = document.createElement("canvas");
      offscreen.width = data.width;
      offscreen.height = data.height;
      offscreen.getContext("2d")?.putImageData(image, 0, 0);

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(offscreen, 0, 0, canvas.width, canvas.height);

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (duration > 0) {
        const x = Math.round((position / duration) * width) + 0.5;
        context.strokeStyle = theme.playhead;
        context.globalAlpha = 0.7;
        context.lineWidth = 1;
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
  }, [data, duration, position, height, lut]);

  const handleSeek = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || duration <= 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onSeek(((event.clientX - bounds.left) / bounds.width) * duration);
  };

  // Frequency labels drawn from the band edges the server reported.
  const marks = useMemo(() => {
    if (!data || data.bandEdgesHz.length === 0) return [];
    const low = data.bandEdgesHz[0];
    const high = data.bandEdgesHz[data.bandEdgesHz.length - 1];
    const candidates = [100, 500, 1000, 5000, 10_000, 20_000].filter(
      (value) => value > low && value < high,
    );
    const span = Math.log(high / Math.max(low, 1));
    return candidates.map((value) => ({
      value,
      // Percentage from the top, matching the flipped image rows.
      offset: (1 - Math.log(value / Math.max(low, 1)) / span) * 100,
    }));
  }, [data]);

  return (
    <div
      ref={containerRef}
      className={busy ? "scope scope--busy" : "scope"}
      style={{ height, cursor: onSeek ? "crosshair" : "default" }}
      onClick={handleSeek}
      role="img"
      aria-label="Spectrogram showing signal level by frequency over time"
    >
      <canvas ref={canvasRef} />
      {marks.map((mark) => (
        <span
          key={mark.value}
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 6,
            top: `${mark.offset}%`,
            transform: "translateY(-50%)",
            fontFamily: "var(--mono)",
            fontSize: 9.5,
            letterSpacing: "0.06em",
            color: "rgba(221, 228, 225, 0.5)",
            textShadow: "0 0 4px rgba(0, 0, 0, 0.9)",
            pointerEvents: "none",
          }}
        >
          {hertz(mark.value)}
        </span>
      ))}
    </div>
  );
}
