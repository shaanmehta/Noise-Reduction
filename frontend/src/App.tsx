import { useCallback, useEffect, useRef, useState } from "react";

import { ComparePanel } from "./components/ComparePanel";
import { Dropzone } from "./components/Dropzone";
import { FilterControls } from "./components/FilterControls";
import { MeasurementPanel } from "./components/MeasurementPanel";
import { Panel } from "./components/Panel";
import { ResponseCurve } from "./components/ResponseCurve";
import { SpectrogramScope } from "./components/SpectrogramScope";
import { Transport } from "./components/Transport";
import { WaveformScope } from "./components/WaveformScope";
import { useAbPlayer } from "./hooks/useAbPlayer";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import * as api from "./lib/api";
import { DEFAULT_SETTINGS, filterDefinition } from "./lib/filters";
import { channelLabel, hertz } from "./lib/format";
import type {
  ClipResponse,
  CompareResponse,
  FilterKind,
  FilterSettings,
  ProcessResponse,
  ServiceConfig,
} from "./lib/types";

type View = "waveform" | "spectrogram";

const PROCESS_DEBOUNCE_MS = 200;

export function App() {
  const [config, setConfig] = useState<ServiceConfig | null>(null);
  const [clip, setClip] = useState<ClipResponse | null>(null);
  const [settings, setSettings] = useState<FilterSettings>(DEFAULT_SETTINGS);
  const [result, setResult] = useState<ProcessResponse | null>(null);
  const [comparison, setComparison] = useState<CompareResponse | null>(null);
  // Waveform first: it is the view people recognise, and the difference
  // between source and processed reads immediately.
  const [view, setView] = useState<View>("waveform");

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
      setLoading(true);
      setError(null);
      api
        .uploadClip(file)
        .then((next) => {
          setClip(next);
          setResult(null);
          setComparison(null);
          setSettings((current) => ({
            ...current,
            high_cutoff_hz: Math.min(
              current.high_cutoff_hz,
              Math.max(next.analysis.nyquist_hz - 200, 500),
            ),
            low_cutoff_hz: Math.min(current.low_cutoff_hz, Math.max(next.analysis.nyquist_hz / 4, 100)),
          }));
        })
        .catch((cause) => {
          setError(cause instanceof api.ApiError ? cause.message : "That file could not be loaded.");
          setClip(null);
          setResult(null);
        })
        .finally(() => setLoading(false));
    },
    [config],
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
    if (!result) return;
    const anchor = document.createElement("a");
    anchor.href = api.resolveUrl(result.audio_url);
    // Always the same name, whatever was uploaded. The service renders WAV.
    anchor.download = "Processed-Audio.wav";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [result]);

  const duration = clip?.clip.duration_seconds ?? 0;
  const showingProcessed = player.side === "b" && Boolean(result);
  const definition = filterDefinition(settings.kind);

  return (
    <div className="shell">
      <header className="masthead">
        <h1 className="masthead__mark">
          Noise<span>Reduce</span>
        </h1>
        <p className="masthead__tagline">Clean up noisy audio in your browser.</p>
      </header>

      <div className="workbench">
        <div className="column">
          <Panel index="01" title="Add audio" active={!clip}>
            <div className="stack">
              <Dropzone config={config} busy={loading} compact={Boolean(clip)} onFile={handleFile} />

              {error ? (
                <p className="notice notice--error" role="alert">
                  <span className="notice__tag">Error</span>
                  <span>{error}</span>
                </p>
              ) : null}

              {clip ? (
                <p className="filemeta">
                  <strong>{clip.clip.filename}</strong>
                  <span>
                    {channelLabel(clip.clip.channels, clip.clip.original_channels)} /{" "}
                    {clip.clip.sample_rate.toLocaleString()} Hz / {duration.toFixed(2)} s
                  </span>
                </p>
              ) : null}
            </div>
          </Panel>

          {clip ? (
            <Panel index="02" title="Choose a filter" status={definition.shortLabel}>
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
          <Panel
            index="03"
            title="Listen and compare"
            status={processing ? "Working" : undefined}
            flush
          >
            {clip ? (
              <>
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

                <div className="scope__bar">
                  <span className="scope__showing" data-side={player.side}>
                    Showing {showingProcessed ? "processed" : "source"} audio
                  </span>
                  <span className="segmented segmented--plain">
                    <button
                      type="button"
                      className={`segmented__option${view === "waveform" ? " segmented__option--active" : ""}`}
                      onClick={() => setView("waveform")}
                      aria-pressed={view === "waveform"}
                    >
                      Waveform
                    </button>
                    <button
                      type="button"
                      className={`segmented__option${view === "spectrogram" ? " segmented__option--active" : ""}`}
                      onClick={() => setView("spectrogram")}
                      aria-pressed={view === "spectrogram"}
                    >
                      Spectrum
                    </button>
                  </span>
                </div>

                {view === "waveform" ? (
                  <WaveformScope
                    data={showingProcessed ? result!.waveform : clip.waveform}
                    reference={clip.waveform}
                    processed={showingProcessed}
                    duration={duration}
                    position={player.position}
                    busy={processing}
                    onSeek={player.seek}
                  />
                ) : (
                  <SpectrogramScope
                    data={showingProcessed ? result!.spectrogram : clip.spectrogram}
                    duration={duration}
                    position={player.position}
                    busy={processing}
                    onSeek={player.seek}
                  />
                )}

                <div className="scope__axis">
                  <span>0:00</span>
                  <span>
                    {view === "spectrogram" ? `Pitch, up to ${hertz(clip.analysis.nyquist_hz)}` : "Loudness"}
                  </span>
                  <span>{duration.toFixed(2)} s</span>
                </div>
              </>
            ) : (
              <p className="empty">Add a file to see it here.</p>
            )}
          </Panel>

          {clip ? (
            <>
              <Panel index="04" title="Results">
                <MeasurementPanel
                  source={clip.metrics}
                  processed={result?.metrics ?? null}
                  side={player.side}
                  reliable={clip.analysis.reliable}
                  separationDb={clip.analysis.separation_db}
                  canDownload={Boolean(result)}
                  onDownload={download}
                />
              </Panel>

              <Panel index="05" title="What the filter removes" flush>
                <ResponseCurve
                  points={result?.response_curve ?? null}
                  nyquist={clip.analysis.nyquist_hz}
                />
              </Panel>

              <Panel index="06" title="Try every filter">
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
        </div>
      </div>
    </div>
  );
}
