import { useId, useState } from "react";

/**
 * Plain-language background on the method, hidden by default.
 *
 * The tool should be usable without reading anything, but the mathematics is
 * the interesting part, so it is one click away rather than absent.
 */
export function Explainer() {
  const [open, setOpen] = useState(false);
  const identifier = useId();

  return (
    <div className="stack">
      <button
        type="button"
        className="disclosure__toggle"
        aria-expanded={open}
        aria-controls={identifier}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          className={`disclosure__caret${open ? " disclosure__caret--open" : ""}`}
          width="8"
          height="8"
          viewBox="0 0 8 8"
          aria-hidden="true"
        >
          <polygon points="1,0 7,4 1,8" fill="currentColor" />
        </svg>
        {open ? "Hide the method" : "How this works"}
      </button>

      {open ? (
        <div className="prose" id={identifier}>
          <h3>Sound as a sum of frequencies</h3>
          <p>
            Any sound can be described two ways. The obvious one is a pressure value at each instant,
            which is what a waveform draws. The other, which Fourier established, is as a sum of pure
            tones, each with its own frequency, amplitude and phase. The two descriptions hold exactly
            the same information, and either can be converted into the other without loss.
          </p>
          <p>
            The second description is far more useful for removing noise, because noise and signal
            usually overlap heavily in time but much less in frequency. Hiss occupies the top of the
            spectrum, mains hum sits at a fixed low frequency, speech concentrates in a band roughly
            between 100 Hz and 8 kHz. Separating things that overlap in time but not in frequency is
            hard in one description and straightforward in the other.
          </p>

          <h3>Why a single transform is not enough</h3>
          <p>
            Transforming an entire recording at once gives the frequencies present somewhere in it, but
            discards when each occurred. That is useless for audio, where everything changes constantly.
            The short-time Fourier transform solves this by cutting the signal into short overlapping
            windows, a few tens of milliseconds each, and transforming every window separately. The
            result is a grid of numbers: how much energy at each frequency, at each moment. That grid is
            the spectrogram displayed above, and it is what every control here modifies.
          </p>
          <p>
            Window length is a genuine trade-off, not a tuning detail. Long windows resolve frequency
            precisely but blur events together in time; short windows locate events precisely but
            smear frequency. This tool picks a window near 43 ms and scales it to whatever sample rate
            your file uses, which is the usual compromise for speech and music.
          </p>

          <h3>Filtering as multiplication</h3>
          <p>
            Once audio is in that form, filtering is multiplication. Each cell of the grid is scaled by
            a gain between zero and one, then the grid is transformed back into a waveform. The four
            filters differ only in how they compute that gain.
          </p>
          <p>
            The three band filters use a gain that depends on frequency alone: keep what is below a
            cutoff, above it, or between two. The <strong>spectral gate</strong> is the more interesting
            one. It first finds a stretch of the recording where little is happening, measures the
            average level of each frequency band there, and treats that as the noise floor. Then, for
            every cell in the grid, it asks whether the energy meaningfully exceeds that floor. Cells
            that do are kept, cells that do not are attenuated. Because the decision is made separately
            at each moment and each frequency, it can strip steady background noise out from between the
            things you want to hear, rather than cutting a band away wholesale.
          </p>

          <h3>Why the edges are soft</h3>
          <p>
            An abrupt cutoff, keeping everything on one side and nothing on the other, seems like the
            obvious approach and sounds noticeably wrong. A sharp edge in frequency corresponds to a
            long oscillating ripple in time, so a hard cut smears each transient into audible ringing.
            The default roll-off is a Butterworth response, flat across the passband and sloping away
            smoothly, and the gate blurs its own decisions across neighbouring cells for the same reason.
            The brick wall option is included so the difference can be heard.
          </p>

          <h3>Measuring the result</h3>
          <p>
            Signal-to-noise ratio compares the power of the wanted signal against the power of the
            background, expressed in decibels on a logarithmic scale: every 10 dB is a tenfold ratio.
            Computing it requires knowing which parts of a recording are noise and which are signal,
            which the tool determines by measuring energy over short frames, taking the quietest
            stretches as the noise reference and the loudest as the signal reference.
          </p>
          <p>
            Those same two windows are then reused, sample for sample, to measure the processed audio.
            That is what makes the before and after figures comparable: both describe the same instants
            of the same recording. When a clip has no genuinely quiet passage there is no honest noise
            reference to be had, and the tool says so rather than quoting a number it cannot support.
          </p>
        </div>
      ) : null}
    </div>
  );
}
