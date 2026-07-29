import { useMemo } from "react";

import { hertz } from "../lib/format";
import { theme } from "../lib/theme";

interface ResponseCurveProps {
  points: { hz: number; gain: number }[] | null;
  nyquist: number;
}

const WIDTH = 600;
const HEIGHT = 130;
const PAD_LEFT = 34;
const PAD_BOTTOM = 18;
const DECIBEL_FLOOR = -60;

/**
 * Magnitude response of the active filter, on log frequency against decibels.
 *
 * This is the transfer function being multiplied into every spectrogram frame,
 * so showing it turns an abstract cutoff number into the shape it actually
 * applies, including how gradually the chosen roll-off gets there.
 */
export function ResponseCurve({ points, nyquist }: ResponseCurveProps) {
  const geometry = useMemo(() => {
    if (!points || points.length === 0) return null;
    const low = points[0].hz;
    const high = points[points.length - 1].hz;
    const span = Math.log(high / low);

    const x = (hz: number) => PAD_LEFT + (Math.log(hz / low) / span) * (WIDTH - PAD_LEFT - 8);
    const y = (gain: number) => {
      const db = Math.max(20 * Math.log10(Math.max(gain, 1e-6)), DECIBEL_FLOOR);
      return 8 + (1 - (db - DECIBEL_FLOOR) / -DECIBEL_FLOOR) * (HEIGHT - PAD_BOTTOM - 8);
    };

    const path = points
      .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.hz).toFixed(2)},${y(point.gain).toFixed(2)}`)
      .join(" ");
    const area = `${path} L${x(high).toFixed(2)},${HEIGHT - PAD_BOTTOM} L${x(low).toFixed(2)},${HEIGHT - PAD_BOTTOM} Z`;

    const decades = [100, 1000, 10_000].filter((value) => value > low && value < high);
    const levels = [0, -20, -40];

    return { path, area, x, y, decades, levels, low, high };
  }, [points]);

  if (!geometry) {
    return (
      <p className="field__note" style={{ padding: "var(--s4)" }}>
        The spectral gate builds a gain that changes over time as well as frequency, so it has no single
        fixed response to plot. The spectrogram above shows what it removed.
      </p>
    );
  }

  return (
    <figure style={{ margin: 0, padding: "var(--s3) var(--s4) var(--s2)" }}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        role="img"
        aria-label={`Filter magnitude response from ${hertz(geometry.low)} to ${hertz(geometry.high)}, with the Nyquist frequency at ${hertz(nyquist)}`}
        preserveAspectRatio="none"
      >
        {geometry.levels.map((level) => {
          const y = geometry.y(10 ** (level / 20));
          return (
            <g key={level}>
              <line x1={PAD_LEFT} y1={y} x2={WIDTH - 8} y2={y} stroke={theme.grid} strokeWidth={1} />
              <text
                x={PAD_LEFT - 6}
                y={y + 3}
                textAnchor="end"
                fill={theme.textFaint}
                fontSize={9}
                fontFamily="var(--mono)"
              >
                {level}
              </text>
            </g>
          );
        })}

        {geometry.decades.map((value) => (
          <g key={value}>
            <line
              x1={geometry.x(value)}
              y1={8}
              x2={geometry.x(value)}
              y2={HEIGHT - PAD_BOTTOM}
              stroke={theme.grid}
              strokeWidth={1}
            />
            <text
              x={geometry.x(value)}
              y={HEIGHT - 5}
              textAnchor="middle"
              fill={theme.textFaint}
              fontSize={9}
              fontFamily="var(--mono)"
            >
              {hertz(value)}
            </text>
          </g>
        ))}

        <path d={geometry.area} fill={theme.processedSoft} />
        <path
          d={geometry.path}
          fill="none"
          stroke={theme.processed}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  );
}
