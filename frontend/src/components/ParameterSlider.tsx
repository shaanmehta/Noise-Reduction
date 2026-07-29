interface ParameterSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  /** Optional word next to the number, e.g. "Balanced". */
  caption?: string;
  note?: string;
  disabled?: boolean;
  /** Log scaling suits frequency controls, where the useful range spans decades. */
  logarithmic?: boolean;
  onChange: (value: number) => void;
}

export function ParameterSlider({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  caption,
  note,
  disabled,
  logarithmic,
  onChange,
}: ParameterSliderProps) {
  // Frequency controls run on a log scale so the audible range spreads evenly
  // across the track instead of bunching everything below 2 kHz at one end.
  // Plain 1-to-10 controls step directly.
  const identifier = `param-${label.replace(/\s+/g, "-").toLowerCase()}`;

  const toSlider = (real: number) =>
    logarithmic ? (Math.log(real / min) / Math.log(max / min)) * 1000 : real;
  const fromSlider = (raw: number) =>
    logarithmic ? min * Math.pow(max / min, raw / 1000) : raw;

  return (
    <div className="field">
      <div className="field__head">
        <label className="field__label" htmlFor={identifier}>
          {label}
        </label>
        <span className="field__value">
          {display}
          {caption ? <span className="field__caption">{caption}</span> : null}
        </span>
      </div>
      <div className="slider">
        <input
          id={identifier}
          type="range"
          min={logarithmic ? 0 : min}
          max={logarithmic ? 1000 : max}
          step={logarithmic ? 1 : step}
          value={Math.round(toSlider(Math.min(Math.max(value, min), max)))}
          disabled={disabled}
          aria-valuetext={caption ? `${display}, ${caption}` : display}
          onChange={(event) => {
            const real = fromSlider(Number(event.target.value));
            onChange(logarithmic ? Math.round(real / step) * step : real);
          }}
        />
      </div>
      {note ? <p className="field__note">{note}</p> : null}
    </div>
  );
}
