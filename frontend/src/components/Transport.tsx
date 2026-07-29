import { seconds as formatSeconds } from "../lib/format";
import type { Side } from "../hooks/useAbPlayer";

interface TransportProps {
  playing: boolean;
  position: number;
  duration: number;
  side: Side;
  ready: boolean;
  hasProcessed: boolean;
  onToggle: () => void;
  onSelectSide: (side: Side) => void;
  onSeek: (seconds: number) => void;
}

function PlayGlyph({ playing }: { playing: boolean }) {
  return (
    <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
      {playing ? (
        <>
          <rect x="2" y="1" width="4" height="16" fill="currentColor" />
          <rect x="10" y="1" width="4" height="16" fill="currentColor" />
        </>
      ) : (
        <polygon points="2,1 15,9 2,17" fill="currentColor" />
      )}
    </svg>
  );
}

export function Transport({
  playing,
  position,
  duration,
  side,
  ready,
  hasProcessed,
  onToggle,
  onSelectSide,
  onSeek,
}: TransportProps) {
  return (
    <div className="transport">
      <div className="transport__row">
        <button
          type="button"
          className="transport__play"
          onClick={onToggle}
          disabled={!ready}
          aria-label={playing ? "Pause" : "Play"}
        >
          <PlayGlyph playing={playing} />
        </button>

        <span className="transport__time">
          {formatSeconds(position)} / {formatSeconds(duration)}
        </span>

        <div className="slider transport__scrub">
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.01}
            value={Math.min(position, duration)}
            disabled={!ready}
            aria-label="Playback position"
            aria-valuetext={formatSeconds(position)}
            onChange={(event) => onSeek(Number(event.target.value))}
          />
        </div>
      </div>

      <div className="transport__ab" role="radiogroup" aria-label="Choose which audio to hear and inspect">
        <button
          type="button"
          role="radio"
          aria-checked={side === "a"}
          data-side="a"
          data-active={side === "a"}
          onClick={() => onSelectSide("a")}
        >
          Source Audio
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={side === "b"}
          data-side="b"
          data-active={side === "b"}
          onClick={() => onSelectSide("b")}
          disabled={!hasProcessed}
        >
          Processed Audio
        </button>
      </div>
    </div>
  );
}
