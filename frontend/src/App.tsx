import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ComparePanel } from "./components/ComparePanel";
import { Dropzone } from "./components/Dropzone";
import { Explainer } from "./components/Explainer";
import { FilterControls } from "./components/FilterControls";
import { Panel, Readout } from "./components/Panel";
import { ResponseCurve } from "./components/ResponseCurve";
import { SpectrogramScope } from "./components/SpectrogramScope";
import { Transport } from "./components/Transport";
import { WaveformScope } from "./components/WaveformScope";
import { useAbPlayer } from "./hooks/useAbPlayer";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import * as api from "./lib/api";
import { DEFAULT_SETTINGS, filterDefinition } from "./lib/filters";
import { channelLabel, decibels, hertz, methodLabel, signedDecibels } from "./lib/format";
import { theme } from "./lib/theme";
import type {
  ClipResponse,
  CompareResponse,
  FilterKind,
  FilterSettings,
  ProcessResponse,
  ServiceConfig,
} from "./lib/types";

type View = "spectrogram" | "waveform";

const PROCESS_DEBOUNCE_MS = 200;

export function App() {
  const [config, setConfig] = useState<ServiceConfig | null>(null);
  const [clip, setClip] = useState<ClipResponse | null>(null);
  const [settings, setSettings] = useState<FilterSettings>(DEFAULT_SETTINGS);
  const [result, setResult] = useState<ProcessResponse | null>(null);
  const [comparison, setComparison] = useState<CompareResponse | null>(null);
  const [view, setView] = useState<View>("spectrogram");

  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processAbort = useRef<AbortController | null>(null);
  const compareAbort = useRef<AbortController | null>(null);
  const settled = useDebouncedValue(settings, PROCESS_DEBOUNCE_MS);

  const sourceUrl = clip ? api.resolveUrl(clip.audio_url) : null;
  const processedUrl = result ? api.resolveUrl(result.audio_url) : null;
  const player = useAbPlayer(sourceUrl, processedUrl);

  useEffect(() => {
    api.fetchConfig().then(setConfig).catch(() => undefined);
  }, []);

  const adoptClip = useCallback((next: ClipResponse) => {
    setClip(next);
    setResult(null);
    setComparison(null);
    setError(null);
    // Start the band filters somewhere sensible for this clip rather than at a
    // fixed frequency that might sit above its Nyquist limit.
    setSettings((current) => ({
      ...current,
      high_cutoff_hz: Math.min(current.high_cutoff_hz, Math.max(next.analysis.nyquist_hz - 200, 500)),
      low_cutoff_hz: Math.min(current.low_cutoff_hz, Math.max(next.analysis.nyquist_hz / 4, 100)),
    }));
  }, []);

  const load = useCallback(
    async (task: () => Promise<ClipResponse>) => {
      setLoading(true);
      setError(null);
      try {
        adoptClip(await task());
      } catch (cause) {
        setError(cause instanceof api.ApiError ? cause.message : "That file could not be loaded.");
        setClip(null);
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [adoptClip],
  );

  const handleFile = useCallback(
    (file: File) => {
      if (config && file.size > config.max_upload_bytes) {
        setError(
          `That file is ${Math.round(file.size / (1024 * 1024))} MB. The limit is ${Math.round(
            config.max_upload_bytes / (1024 * 1024),
          )} MB.`,
        );
        return;
      }
      void load(() => api.uploadClip(file));
    },
    [config, load],
  );

  // Reprocess whenever the settled settings or the clip change. In-flight
  // requests are cancelled so a fast slider drag cannot deliver stale results
  // out of order.
  useEffect(() => {
    if (!clip) return;
    processAbort.current?.abort();
    const controller = new AbortController();
    processAbort.current = controller;

    setProcessing(true);
    api
      .processClip(clip.clip.clip_id, settled, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setResult(next);
          setError(null);
        }
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof api.ApiError ? cause.message : "Processing failed. Try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setProcessing(false);
      });

    return () => controller.abort();
  }, [clip, settled]);

  const runComparison = useCallback(() => {
    if (!clip) return;
    compareAbort.current?.abort();
    const controller = new AbortController();
    compareAbort.current = controller;
    setComparing(true);
    api
      .compareFilters(clip.clip.clip_id, settings, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setComparison(next);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof api.ApiError ? cause.message : "The comparison could not be run.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setComparing(false);
      });
  }, [clip, settings]);

  const download = useCallback(() => {
    if (!result || !clip) return;
    const anchor = document.createElement("a");
    anchor.href = api.resolveUrl(result.audio_url);
    const base = clip.clip.filename.replace(/\.[^.]+$/, "") || "audio";
    anchor.download = `${base}-${settings.kind.replace("_", "-")}.wav`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [result, clip, settings.kind]);

  const snr = result?.metrics.snr_db ?? clip?.metrics.snr_db ?? 0;
  const delta = result?.snr_delta_db ?? 0;
  const definition = filterDefinition(settings.kind);
  const duration = clip?.clip.duration_seconds ?? 0;

  const status = useMemo(() => {
    if (loading) return "Reading";
    if (processing) return "Processing";
    if (result) return `${result.elapsed_ms.toFixed(0)} ms`;
    return null;
  }, [loading, processing, result]);

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <div className="masthead__title">
            <span className="masthead__mark">
              Noise<span>Reduce</span>
            </span>
            <span className="masthead__rule" aria-hidden="true" />
          </div>
          <p className="masthead__tagline">
            Noise reduction by short-time Fourier transform. Upload audio, shape the spectrum, and
            measure what changed.
          </p>
        </div>
        <div className="masthead__meta">
          {clip ? (
            <>
              <div>{clip.clip.filename}</div>
              <div>
                {clip.clip.sample_rate.toLocaleString()} Hz / {channelLabel(clip.clip.channels)} /{" "}
                {duration.toFixed(2)} s
              </div>
            </>
          ) : (
            <div>No clip loaded</div>
          )}
        </div>
      </header>

      <div className="workbench">
        <div className="column">
          <Panel index="01" title="Source" status={loading ? "Reading" : undefined}>
            <div className="stack">
              <Dropzone config={config} busy={loading} compact={Boolean(clip)} onFile={handleFile} />
              <button
                type="button"
                className="button button--wide"
                onClick={() => void load(() => api.createSampleClip())}
                disabled={loading}
              >
                {clip ? "Reload demonstration clip" : "Load demonstration clip"}
              </button>

              {error ? (
                <p className="notice notice--error" role="alert">
                  <span className="notice__tag">Error</span>
                  <span>{error}</span>
                </p>
              ) : null}

              {clip ? (
                <div>
                  <Readout label="Sample rate" value={`${clip.clip.sample_rate.toLocaleString()} Hz`} />
                  {clip.clip.resampled ? (
                    <Readout
                      label="Resampled from"
                      value={`${clip.clip.original_sample_rate.toLocaleString()} Hz`}
                      dim
                    />
                  ) : null}
                  <Readout label="Channels" value={channelLabel(clip.clip.channels)} />
                  <Readout label="Duration" value={`${duration.toFixed(2)} s`} />
                  <Readout label="Window" value={`${clip.analysis.n_fft} pt`} dim />
                  <Readout label="Hop" value={`${clip.analysis.hop_length} pt`} dim />
                  <Readout
                    label="Bin width"
                    value={`${clip.analysis.frequency_resolution_hz.toFixed(2)} Hz`}
                    dim
                  />
                </div>
              ) : null}
            </div>
          </Panel>

          {clip ? (
            <Panel index="02" title="Filter" status={definition.shortLabel}>
              <FilterControls
                settings={settings}
                nyquist={clip.analysis.nyquist_hz}
                disabled={loading}
                onChange={setSettings}
              />
            </Panel>
          ) : null}
        </div>

        <div className="column">
          <Panel index="03" title="Analysis" status={status ?? undefined} flush>
            {clip ? (
              <>
                <div className="scope__legend">
                  <span className="scope__key">
                    <span className="scope__swatch" style={{ background: theme.source }} />
                    Source
                  </span>
                  <span className="scope__key">
                    <span className="scope__swatch" style={{ background: theme.processed }} />
                    Processed
                  </span>
                  <span style={{ marginLeft: "auto" }}>
                    <span className="segmented" style={{ border: "none" }}>
                      <button
                        type="button"
                        className={`segmented__option${view === "spectrogram" ? " segmented__option--active" : ""}`}
                        onClick={() => setView("spectrogram")}
                        aria-pressed={view === "spectrogram"}
                      >
                        Spectrogram
                      </button>
                      <button
                        type="button"
                        className={`segmented__option${view === "waveform" ? " segmented__option--active" : ""}`}
                        onClick={() => setView("waveform")}
                        aria-pressed={view === "waveform"}
                      >
                        Waveform
                      </button>
                    </span>
                  </span>
                </div>

                {view === "spectrogram" ? (
                  <SpectrogramScope
                    data={result?.spectrogram ?? clip.spectrogram}
                    duration={duration}
                    position={player.position}
                    busy={processing}
                    onSeek={player.seek}
                  />
                ) : (
                  <WaveformScope
                    source={clip.waveform}
                    processed={result?.waveform ?? null}
                    duration={duration}
                    position={player.position}
                    busy={processing}
                    onSeek={player.seek}
                  />
                )}

                <div className="scope__axis">
                  <span>0.00 s</span>
                  <span>
                    {view === "spectrogram"
                      ? `Log frequency to ${hertz(clip.analysis.nyquist_hz)}`
                      : "Amplitude, full scale"}
                  </span>
                  <span>{duration.toFixed(2)} s</span>
                </div>

                <Transport
                  playing={player.playing}
                  position={player.position}
                  duration={duration}
                  side={player.side}
                  ready={player.ready}
                  hasProcessed={Boolean(result)}
                  onToggle={player.toggle}
                  onSelectSide={player.selectSide}
                  onSeek={player.seek}
                />
              </>
            ) : (
              <p className="field__note" style={{ padding: "var(--s6) var(--s4)", textAlign: "center" }}>
                Load a clip to see its spectrum. Nothing you upload is stored: audio is held in memory
                for the length of your session and discarded.
              </p>
            )}
          </Panel>

          {clip ? (
            <>
              <Panel
                index="04"
                title="Measurement"
                status={clip.analysis.reliable ? undefined : "Unverified"}
              >
                <div className="stack">
                  <div className="gauge">
                    <div>
                      <div
                        className="gauge__value"
                        style={{ color: result ? theme.processed : theme.source }}
                      >
                        {decibels(snr)}
                        <span className="gauge__unit">dB</span>
                      </div>
                      <div className="gauge__caption">Signal to noise</div>
                    </div>
                    {result ? (
                      <div
                        className={`gauge__delta ${delta >= 0 ? "gauge__delta--up" : "gauge__delta--down"}`}
                      >
                        {signedDecibels(delta)} dB
                        <div className="gauge__caption" style={{ color: "var(--text-faint)" }}>
                          vs source
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {!clip.analysis.reliable ? (
                    <p className="notice">
                      <span className="notice__tag">Note</span>
                      <span>
                        No clearly quiet passage was found in this clip, so the quiet and loud
                        references differ by only {decibels(clip.analysis.separation_db)} dB. The figures
                        still track relative change, but treat them as indicative.
                      </span>
                    </p>
                  ) : null}

                  <div>
                    <Readout label="Source signal to noise" value={`${decibels(clip.metrics.snr_db)} dB`} />
                    <Readout
                      label="Noise floor"
                      value={`${decibels(result?.metrics.noise_floor_dbfs ?? clip.metrics.noise_floor_dbfs)} dBFS`}
                    />
                    <Readout
                      label="Signal level"
                      value={`${decibels(result?.metrics.signal_level_dbfs ?? clip.metrics.signal_level_dbfs)} dBFS`}
                    />
                    <Readout label="Reference detection" value={methodLabel(clip.analysis.method)} dim />
                    <Readout
                      label="Reference windows"
                      value={`${clip.analysis.noise_seconds.toFixed(2)} s / ${clip.analysis.signal_seconds.toFixed(2)} s`}
                      dim
                    />
                  </div>

                  <button
                    type="button"
                    className="button button--wide button--accent"
                    onClick={download}
                    disabled={!result}
                  >
                    Download processed audio
                  </button>
                </div>
              </Panel>

              <Panel index="05" title="Filter response" flush>
                <ResponseCurve
                  points={result?.response_curve ?? null}
                  nyquist={clip.analysis.nyquist_hz}
                />
              </Panel>

              <Panel index="06" title="Filter comparison">
                <ComparePanel
                  comparison={comparison}
                  activeKind={settings.kind}
                  busy={comparing}
                  onRun={runComparison}
                  onSelect={(kind: FilterKind) => setSettings((current) => ({ ...current, kind }))}
                />
              </Panel>
            </>
          ) : null}

          <Panel index={clip ? "07" : "04"} title="Method">
            <Explainer />
          </Panel>
        </div>
      </div>

      <footer className="colophon">
        <span>Short-time Fourier transform / spectral masking / inverse transform</span>
        <span>Audio is processed in memory and never written to disk</span>
      </footer>
    </div>
  );
}
