import { signedDecibels } from "../lib/format";
import type { CompareResponse, FilterKind } from "../lib/types";

interface ComparePanelProps {
  comparison: CompareResponse | null;
  activeKind: FilterKind;
  busy: boolean;
  onRun: () => void;
  onSelect: (kind: FilterKind) => void;
}

/**
 * Every filter scored against the same clip, on the same reference windows.
 *
 * The bars read outward from a zero line so improvement and degradation are
 * distinguishable by direction rather than only by colour.
 */
export function ComparePanel({ comparison, activeKind, busy, onRun, onSelect }: ComparePanelProps) {
  if (!comparison) {
    return (
      <div className="stack">
        <p className="field__note">
          Runs all four filters over this clip with the current settings and measures each one, so the
          comparison reflects your audio rather than a fixed example.
        </p>
        <button type="button" className="button button--wide button--accent" onClick={onRun} disabled={busy}>
          {busy ? "Measuring" : "Compare all filters"}
        </button>
      </div>
    );
  }

  // Only reserve space to the left of zero when something actually lands
  // there. Most clips improve under every filter, and a fixed centre line
  // would throw away half the width drawing nothing.
  const deltas = comparison.entries.map((entry) => entry.snr_delta_db);
  const worst = Math.min(0, ...deltas);
  const best = Math.max(0, ...deltas);
  const span = Math.max(best - worst, 1);
  const zero = (-worst / span) * 100;
  const scale = (value: number) => (Math.abs(value) / span) * 100;

  return (
    <div className="stack">
      {!comparison.reliable ? (
        <p className="field__note">
          This clip has no clearly quiet passage, so these figures indicate relative behaviour rather
          than a true measurement. Trust your ears over the numbers here.
        </p>
      ) : null}

      <div>
        {comparison.entries.map((entry) => {
          const negative = entry.snr_delta_db < 0;
          const width = scale(entry.snr_delta_db);
          const active = entry.kind === activeKind;
          return (
            <button
              key={entry.kind}
              type="button"
              className={`compare__row${active ? " compare__row--active" : ""}`}
              style={{ width: "100%", textAlign: "left" }}
              onClick={() => onSelect(entry.kind)}
              aria-label={`${entry.label}: ${signedDecibels(entry.snr_delta_db)} decibels change. Select this filter.`}
            >
              <span className="compare__label">{entry.label}</span>
              <span className="compare__track">
                <span className="compare__zero" style={{ left: `${zero}%` }} />
                <span
                  className={`compare__bar${negative ? " compare__bar--negative" : ""}`}
                  style={{
                    left: negative ? `${zero - width}%` : `${zero}%`,
                    width: `${Math.max(width, 0.5)}%`,
                  }}
                />
              </span>
              <span
                className="compare__delta"
                style={{ color: negative ? "var(--warn)" : "var(--processed)" }}
              >
                {signedDecibels(entry.snr_delta_db)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="field__note">
          Change in signal-to-noise ratio against the unprocessed clip at {comparison.baseline_snr_db.toFixed(1)} dB.
        </span>
        <button type="button" className="button" onClick={onRun} disabled={busy}>
          {busy ? "Measuring" : "Rerun"}
        </button>
      </div>
    </div>
  );
}
