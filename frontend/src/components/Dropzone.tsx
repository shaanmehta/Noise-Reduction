import { useCallback, useRef, useState } from "react";

import { bytes } from "../lib/format";
import { theme } from "../lib/theme";
import type { ServiceConfig } from "../lib/types";

interface DropzoneProps {
  config: ServiceConfig | null;
  busy: boolean;
  /** Once a clip is loaded the target shrinks, leaving room for the controls. */
  compact?: boolean;
  onFile: (file: File) => void;
}

/** A waveform glyph, drawn rather than illustrated, doubling as the drop target mark. */
function WaveGlyph() {
  const bars = [0.35, 0.7, 1, 0.55, 0.85, 0.4, 0.65, 0.3];
  return (
    <svg className="dropzone__glyph" viewBox="0 0 80 40" aria-hidden="true">
      {bars.map((value, index) => {
        const x = 4 + index * 10;
        const half = value * 16;
        return (
          <line
            key={index}
            x1={x}
            y1={20 - half}
            x2={x}
            y2={20 + half}
            stroke={theme.source}
            strokeWidth={2}
            opacity={0.35 + value * 0.5}
          />
        );
      })}
    </svg>
  );
}

export function Dropzone({ config, busy, compact, onFile }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      if (busy) return;
      const file = event.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [busy, onFile],
  );

  const accept = config?.supported_extensions.join(",") ?? "audio/*";
  const limit = config ? bytes(config.max_upload_bytes) : "";
  const seconds = config ? `${Math.round(config.max_duration_seconds)} seconds` : "";
  const formats = config
    ? config.supported_extensions.map((entry) => entry.replace(".", "").toUpperCase()).join("  ")
    : "";

  return (
    <>
      <button
        type="button"
        className={`dropzone${compact ? " dropzone--compact" : ""}${dragging ? " dropzone--active" : ""}${busy ? " dropzone--busy" : ""}`}
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        disabled={busy}
      >
        {compact ? null : <WaveGlyph />}
        <span className="dropzone__primary">
          {busy ? "Reading audio" : compact ? "Choose a different file" : "Drop an audio file here"}
        </span>
        {compact ? null : (
          <>
            <span className="dropzone__secondary">or click to browse</span>
            {/* Every accepted extension, straight from the server, so the list
                can never drift from what the API will actually take. */}
            <span className="dropzone__hint">{formats}</span>
            {limit && seconds ? (
              <span className="dropzone__hint">
                Up to {limit} and {seconds}
              </span>
            ) : null}
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="visually-hidden"
        aria-label="Choose an audio file to process"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
    </>
  );
}
