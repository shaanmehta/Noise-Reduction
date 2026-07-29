import type { Side } from "../hooks/useAbPlayer";
import { decibels, signedDecibels } from "../lib/format";
import type { Metrics } from "../lib/types";
import { HelpTip } from "./HelpTip";

interface MeasurementPanelProps {
  source: Metrics;
  processed: Metrics | null;
  side: Side;
  reliable: boolean;
  separationDb: number;
  canDownload: boolean;
  onDownload: () => void;
}

interface RowProps {
  label: string;
  help: string;
  source: number;
  processed: number | null;
  unit: string;
  side: Side;
}

function Row({ label, help, source, processed, unit, side }: RowProps) {
  return (
    <div className="measure__row">
      <span className="measure__label">
        {label}
        <HelpTip label={label}>{help}</HelpTip>
      </span>
      <span className={`measure__cell${side === "a" ? " measure__cell--active" : ""}`}>
        {decibels(source)} {unit}
      </span>
      <span className={`measure__cell${side === "b" ? " measure__cell--active" : ""}`}>
        {processed === null ? "--" : `${decibels(processed)} ${unit}`}
      </span>
    </div>
  );
}

/**
 * Both readings side by side, with the one currently being listened to
 * highlighted, so the numbers always match what is playing.
 */
export function MeasurementPanel({
  source,
  processed,
  side,
  reliable,
  separationDb,
  canDownload,
  onDownload,
}: MeasurementPanelProps) {
  const showing = side === "b" && processed ? processed : source;
  const improvement = processed ? processed.snr_db - source.snr_db : null;

  return (
    <div className="stack">
      <div className="gauge">
        <div>
          <div className="gauge__value" data-side={side}>
            {decibels(showing.snr_db)}
            <span className="gauge__unit">dB</span>
          </div>
          {/* The explanation lives once, on the Clarity row below. */}
          <div className="gauge__caption">
            Clarity of {side === "b" ? "processed" : "source"} audio
          </div>
        </div>
        {improvement !== null ? (
          <div className={`gauge__delta ${improvement >= 0 ? "gauge__delta--up" : "gauge__delta--down"}`}>
            {signedDecibels(improvement)} dB
            <div className="gauge__caption">improvement</div>
          </div>
        ) : null}
      </div>

      <div className="measure">
        <div className="measure__row measure__row--head">
          <span className="measure__label" />
          <span className={`measure__cell${side === "a" ? " measure__cell--active" : ""}`}>Source</span>
          <span className={`measure__cell${side === "b" ? " measure__cell--active" : ""}`}>Processed</span>
        </div>
        <Row
          label="Clarity"
          help="How far the wanted audio rises above the background noise. Higher is cleaner."
          source={source.snr_db}
          processed={processed?.snr_db ?? null}
          unit="dB"
          side={side}
        />
        <Row
          label="Noise floor"
          help="How loud the background hiss is. Lower is quieter."
          source={source.noise_floor_dbfs}
          processed={processed?.noise_floor_dbfs ?? null}
          unit="dB"
          side={side}
        />
        <Row
          label="Signal level"
          help="How loud the audio you want to keep is. This should barely change."
          source={source.signal_level_dbfs}
          processed={processed?.signal_level_dbfs ?? null}
          unit="dB"
          side={side}
        />
      </div>

      {!reliable ? (
        <p className="notice">
          <span className="notice__tag">Note</span>
          <span>
            This clip has no quiet moment to measure the background from, so these numbers are a rough
            guide. Trust your ears. Quiet and loud parts differ by only {decibels(separationDb)} dB.
          </span>
        </p>
      ) : null}

      <button
        type="button"
        className="button button--primary button--wide"
        onClick={onDownload}
        disabled={!canDownload}
      >
        Download Processed Audio
      </button>
    </div>
  );
}
