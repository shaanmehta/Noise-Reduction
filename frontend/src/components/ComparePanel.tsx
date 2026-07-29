import { signedDecibels } from "../lib/format";
import type { CompareResponse, FilterKind } from "../lib/types";

interface ComparePanelProps {
  comparison: CompareResponse | null;
  activeKind: FilterKind;
  busy: boolean;
  onRun: () => void;
  onSelect: (kind: FilterKind) => void;
}

const LABELS: Record<string, string> = {
  spectral_gate: "Noise removal",
  low_pass: "Cut highs",
  high_pass: "Cut lows",
  band_pass: "Keep middle",
};

/** Runs all four filters on the loaded clip and ranks them by how much they help. */
export function ComparePanel({ comparison, activeKind, busy, onRun, onSelect }: ComparePanelProps) {
  if (!comparison) {
    return (
      <div className="stack">
        <p className="helper">See which filter works best on your audio.</p>
        <button type="button" className="button button--wide" onClick={onRun} disabled={busy}>
          {busy ? "Checking" : "Test all filters"}
        </button>
      </div>
    );
  }

  // Only reserve space left of zero when something actually lands there.
  const deltas = comparison.entries.map((entry) => entry.snr_delta_db);
  const worst = Math.min(0, ...deltas);
  const best = Math.max(0, ...deltas);
  const span = Math.max(best - worst, 1);
  const zero = (-worst / span) * 100;
  const winner = comparison.entries.reduce((a, b) => (b.snr_delta_db > a.snr_delta_db ? b : a));

  return (
    <div className="stack">
      <div>
        {comparison.entries.map((entry) => {
          const negative = entry.snr_delta_db < 0;
          const width = (Math.abs(entry.snr_delta_db) / span) * 100;
          const active = entry.kind === activeKind;
          return (
            <button
              key={entry.kind}
              type="button"
              className={`compare__row${active ? " compare__row--active" : ""}`}
              onClick={() => onSelect(entry.kind)}
              aria-label={`${LABELS[entry.kind]}, ${signedDecibels(entry.snr_delta_db)} decibels. Use this filter.`}
            >
              <span className="compare__label">
                {LABELS[entry.kind] ?? entry.label}
                {entry.kind === winner.kind ? <span className="compare__badge">Best</span> : null}
              </span>
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
              <span className={`compare__delta${negative ? " compare__delta--negative" : ""}`}>
                {signedDecibels(entry.snr_delta_db)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="row" style={{ justifyContent: "space-between", gap: "var(--s3)" }}>
        <span className="helper" style={{ margin: 0 }}>
          Higher is better. Tap one to use it.
        </span>
        <button type="button" className="button" onClick={onRun} disabled={busy}>
          {busy ? "Checking" : "Retest"}
        </button>
      </div>
    </div>
  );
}
