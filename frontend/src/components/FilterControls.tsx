import { hertz } from "../lib/format";
import {
  FILTERS,
  ROLLOFFS,
  filterDefinition,
  usesHighCutoff,
  usesLowCutoff,
  usesRolloff,
} from "../lib/filters";
import type { FilterKind, FilterSettings, Rolloff } from "../lib/types";
import { ParameterSlider } from "./ParameterSlider";

interface FilterControlsProps {
  settings: FilterSettings;
  nyquist: number;
  disabled: boolean;
  onChange: (settings: FilterSettings) => void;
}

const MIN_HZ = 20;

export function FilterControls({ settings, nyquist, disabled, onChange }: FilterControlsProps) {
  const definition = filterDefinition(settings.kind);
  const ceiling = Math.max(nyquist - 20, 1000);
  const update = (patch: Partial<FilterSettings>) => onChange({ ...settings, ...patch });

  return (
    <div className="stack">
      <div className="selector" role="radiogroup" aria-label="Filter type">
        {FILTERS.map((entry) => {
          const active = entry.kind === settings.kind;
          return (
            <button
              key={entry.kind}
              type="button"
              role="radio"
              aria-checked={active}
              className={`selector__option${active ? " selector__option--active" : ""}`}
              onClick={() => update({ kind: entry.kind as FilterKind })}
              disabled={disabled}
            >
              <span className="selector__index">{entry.index}</span>
              <span className="selector__label">{entry.label}</span>
            </button>
          );
        })}
      </div>

      <p className="field__note">{definition.summary}</p>

      {settings.kind === "spectral_gate" ? (
        <>
          <ParameterSlider
            label="Threshold"
            value={settings.threshold_db}
            min={-12}
            max={36}
            step={0.5}
            display={`${settings.threshold_db.toFixed(1)} dB`}
            note="How far above the measured noise floor a band must sit to be kept. Raise it to remove more, lower it if the signal starts breaking up."
            disabled={disabled}
            onChange={(value) => update({ threshold_db: value })}
          />
          <ParameterSlider
            label="Reduction"
            value={settings.reduction_db}
            min={-60}
            max={0}
            step={1}
            display={`${settings.reduction_db.toFixed(0)} dB`}
            note="How far rejected bands are pushed down. Leaving a little noise in sounds more natural than silencing it completely."
            disabled={disabled}
            onChange={(value) => update({ reduction_db: value })}
          />
          <ParameterSlider
            label="Time smoothing"
            value={settings.time_smoothing}
            min={1}
            max={21}
            step={2}
            display={`${settings.time_smoothing} frames`}
            note="Median width across time. Wider settings suppress the warbling artefacts that per-frame thresholding produces."
            disabled={disabled}
            onChange={(value) => update({ time_smoothing: Math.max(1, Math.round(value)) })}
          />
          <ParameterSlider
            label="Frequency smoothing"
            value={settings.freq_smoothing}
            min={1}
            max={15}
            step={2}
            display={`${settings.freq_smoothing} bins`}
            disabled={disabled}
            onChange={(value) => update({ freq_smoothing: Math.max(1, Math.round(value)) })}
          />
        </>
      ) : null}

      {usesLowCutoff(settings.kind) ? (
        <ParameterSlider
          label={settings.kind === "band_pass" ? "Lower edge" : "Cutoff"}
          value={settings.low_cutoff_hz}
          min={MIN_HZ}
          max={ceiling}
          step={1}
          logarithmic
          display={hertz(settings.low_cutoff_hz)}
          disabled={disabled}
          onChange={(value) => update({ low_cutoff_hz: Math.round(value) })}
        />
      ) : null}

      {usesHighCutoff(settings.kind) ? (
        <ParameterSlider
          label={settings.kind === "band_pass" ? "Upper edge" : "Cutoff"}
          value={settings.high_cutoff_hz}
          min={MIN_HZ}
          max={ceiling}
          step={1}
          logarithmic
          display={hertz(settings.high_cutoff_hz)}
          disabled={disabled}
          onChange={(value) => update({ high_cutoff_hz: Math.round(value) })}
        />
      ) : null}

      {usesRolloff(settings.kind) ? (
        <div className="field">
          <div className="field__head">
            <span className="field__label" id="rolloff-label">
              Roll-off
            </span>
          </div>
          <div className="segmented" role="radiogroup" aria-labelledby="rolloff-label">
            {ROLLOFFS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                role="radio"
                aria-checked={settings.rolloff === entry.value}
                className={`segmented__option${settings.rolloff === entry.value ? " segmented__option--active" : ""}`}
                onClick={() => update({ rolloff: entry.value as Rolloff })}
                disabled={disabled}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <p className="field__note">
            {ROLLOFFS.find((entry) => entry.value === settings.rolloff)?.summary}
          </p>
        </div>
      ) : null}

      {usesRolloff(settings.kind) && settings.rolloff === "butterworth" ? (
        <ParameterSlider
          label="Order"
          value={settings.order}
          min={1}
          max={12}
          step={1}
          display={`${settings.order}`}
          note="Higher orders fall away faster past the cutoff. Each step adds roughly 6 dB per octave."
          disabled={disabled}
          onChange={(value) => update({ order: Math.round(value) })}
        />
      ) : null}

      {usesRolloff(settings.kind) && settings.rolloff === "cosine" ? (
        <ParameterSlider
          label="Transition width"
          value={settings.transition_hz}
          min={10}
          max={4000}
          step={10}
          logarithmic
          display={hertz(settings.transition_hz)}
          note="Width of the raised-cosine edge. Narrow enough and it behaves like a brick wall, ringing included."
          disabled={disabled}
          onChange={(value) => update({ transition_hz: Math.round(value) })}
        />
      ) : null}
    </div>
  );
}
