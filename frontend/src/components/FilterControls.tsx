import { hertz } from "../lib/format";
import {
  FILTERS,
  ROLLOFFS,
  SMOOTHING_STEPS,
  dbToDepth,
  dbToStrength,
  depthToDb,
  filterDefinition,
  smoothingIndex,
  strengthToDb,
  strengthWord,
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

  const strength = dbToStrength(settings.threshold_db);
  const depth = dbToDepth(settings.reduction_db);
  const smoothing = smoothingIndex(settings);

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
              <span className="selector__label">{entry.label}</span>
              <span className="selector__best">{entry.best}</span>
            </button>
          );
        })}
      </div>

      <p className="helper">{definition.summary}</p>

      {settings.kind === "spectral_gate" ? (
        <>
          <ParameterSlider
            label="Strength"
            value={strength}
            min={1}
            max={10}
            step={1}
            display={`${strength} / 10`}
            caption={strengthWord(strength)}
            note="How much background noise to take out."
            disabled={disabled}
            onChange={(value) => update({ threshold_db: strengthToDb(Math.round(value)) })}
          />
          <ParameterSlider
            label="Depth"
            value={depth}
            min={1}
            max={10}
            step={1}
            display={`${depth} / 10`}
            note="How far the noise is turned down. Leaving a little in sounds more natural."
            disabled={disabled}
            onChange={(value) => update({ reduction_db: depthToDb(Math.round(value)) })}
          />
          <ParameterSlider
            label="Smoothing"
            value={smoothing}
            min={0}
            max={SMOOTHING_STEPS.length - 1}
            step={1}
            display={SMOOTHING_STEPS[smoothing].label}
            note="Cleans up the watery, warbling sound that noise removal can leave behind."
            disabled={disabled}
            onChange={(value) => {
              const step = SMOOTHING_STEPS[Math.round(value)] ?? SMOOTHING_STEPS[2];
              update({ time_smoothing: step.time, freq_smoothing: step.freq });
            }}
          />
        </>
      ) : null}

      {usesLowCutoff(settings.kind) ? (
        <ParameterSlider
          label={settings.kind === "band_pass" ? "Keep above" : "Cut below"}
          value={settings.low_cutoff_hz}
          min={MIN_HZ}
          max={ceiling}
          step={1}
          logarithmic
          display={hertz(settings.low_cutoff_hz)}
          note="Sounds lower than this are removed."
          disabled={disabled}
          onChange={(value) => update({ low_cutoff_hz: Math.round(value) })}
        />
      ) : null}

      {usesHighCutoff(settings.kind) ? (
        <ParameterSlider
          label={settings.kind === "band_pass" ? "Keep below" : "Cut above"}
          value={settings.high_cutoff_hz}
          min={MIN_HZ}
          max={ceiling}
          step={1}
          logarithmic
          display={hertz(settings.high_cutoff_hz)}
          note="Sounds higher than this are removed."
          disabled={disabled}
          onChange={(value) => update({ high_cutoff_hz: Math.round(value) })}
        />
      ) : null}

      {usesRolloff(settings.kind) ? (
        <div className="field">
          <div className="field__head">
            <span className="field__label" id="rolloff-label">
              Edge
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
    </div>
  );
}
