interface ParameterSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  note?: string;
  disabled?: boolean;
  /** Log scaling suits frequency controls, where the useful range spans decades. */
  logarithmic?: boolean;
  onChange: (value: number) => void;
}

const TICKS = 9;

export function ParameterSlider({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  note,
  disabled,
  logarithmic,
  onChange,
}: ParameterSliderProps) {
  // The input always runs 0 to 1000; the mapping to real units happens here so
  // that a frequency slider gives even resolution across the audible range
  // instead of cramming everything below 2 kHz into the first few pixels.
  const toSlider = (real: number) => {
    if (!logarithmic) return ((real - min) / (max - min)) * 1000;
    return (Math.log(real / min) / Math.log(max / min)) * 1000;
  };
  const fromSlider = (raw: number) => {
    if (!logarithmic) return min + (raw / 1000) * (max - min);
    return min * Math.pow(max / min, raw / 1000);
  };

  const identifier = `param-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className="field">
      <div className="field__head">
        <label className="field__label" htmlFor={identifier}>
          {label}
        </label>
        <span className="field__value">{display}</span>
      </div>
      <div className="slider">
        <div className="slider__ticks" aria-hidden="true">
          {Array.from({ length: TICKS }, (_, index) => (
            <span key={index} className="slider__tick" />
          ))}
        </div>
        <input
          id={identifier}
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(toSlider(Math.min(Math.max(value, min), max)))}
          disabled={disabled}
          aria-valuetext={display}
          onChange={(event) => {
            const real = fromSlider(Number(event.target.value));
            onChange(step >= 1 ? Math.round(real / step) * step : real);
          }}
        />
      </div>
      {note ? <p className="field__note">{note}</p> : null}
    </div>
  );
}
