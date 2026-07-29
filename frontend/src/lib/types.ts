export type FilterKind = "spectral_gate" | "low_pass" | "high_pass" | "band_pass";
export type Rolloff = "butterworth" | "cosine" | "brickwall";

export interface FilterSettings {
  kind: FilterKind;
  low_cutoff_hz: number;
  high_cutoff_hz: number;
  rolloff: Rolloff;
  order: number;
  transition_hz: number;
  threshold_db: number;
  reduction_db: number;
  time_smoothing: number;
  freq_smoothing: number;
}

export interface ClipInfo {
  clip_id: string;
  filename: string;
  duration_seconds: number;
  sample_rate: number;
  original_sample_rate: number;
  channels: number;
  original_channels: number;
  source_format: string;
  resampled: boolean;
}

export interface AnalysisInfo {
  method: string;
  noise_seconds: number;
  signal_seconds: number;
  separation_db: number;
  reliable: boolean;
  n_fft: number;
  hop_length: number;
  win_length: number;
  frequency_resolution_hz: number;
  nyquist_hz: number;
}

export interface Metrics {
  snr_db: number;
  noise_floor_dbfs: number;
  signal_level_dbfs: number;
  peak_dbfs: number;
}

export interface Waveform {
  min: number[];
  max: number[];
  buckets: number;
}

export interface Spectrogram {
  width: number;
  height: number;
  data: string;
  bandEdgesHz: number[];
  floorDb: number;
  durationSeconds: number;
}

export interface ClipResponse {
  clip: ClipInfo;
  analysis: AnalysisInfo;
  metrics: Metrics;
  waveform: Waveform;
  spectrogram: Spectrogram;
  audio_url: string;
}

export interface ProcessResponse {
  render_id: string;
  audio_url: string;
  settings: FilterSettings;
  metrics: Metrics;
  snr_delta_db: number;
  waveform: Waveform;
  spectrogram: Spectrogram;
  response_curve: { hz: number; gain: number }[] | null;
  elapsed_ms: number;
}

export interface ComparisonEntry {
  kind: FilterKind;
  label: string;
  snr_db: number;
  snr_delta_db: number;
  noise_floor_dbfs: number;
  signal_level_dbfs: number;
  settings: FilterSettings;
}

export interface CompareResponse {
  baseline_snr_db: number;
  reliable: boolean;
  entries: ComparisonEntry[];
  elapsed_ms: number;
}

export interface ServiceConfig {
  max_upload_bytes: number;
  max_duration_seconds: number;
  supported_extensions: string[];
}
