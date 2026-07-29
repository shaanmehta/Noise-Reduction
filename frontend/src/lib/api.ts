import type {
  ClipResponse,
  CompareResponse,
  FilterSettings,
  ProcessResponse,
  ServiceConfig,
} from "./types";

// Empty base means same origin, which is how the single-container deployment
// runs. A split deployment sets VITE_API_BASE_URL to the backend host.
const BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function resolveUrl(path: string): string {
  return path.startsWith("http") ? path : `${BASE}${path}`;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return body.detail;
    // Schema validation failures arrive as a list; surface the first message
    // rather than the raw structure.
    if (Array.isArray(body?.detail) && body.detail[0]?.msg) {
      return `That setting is out of range: ${body.detail[0].msg}.`;
    }
  } catch {
    // Falls through to the generic message below.
  }
  if (response.status === 429) return "Too many requests. Wait a moment and try again.";
  if (response.status >= 500) return "The service ran into a problem. Please try again.";
  return "That request could not be completed.";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(resolveUrl(path), init);
  } catch {
    throw new ApiError("Could not reach the service. Check your connection and try again.", 0);
  }
  if (!response.ok) {
    throw new ApiError(await readError(response), response.status);
  }
  return (await response.json()) as T;
}

export function fetchConfig(): Promise<ServiceConfig> {
  return request<ServiceConfig>("/api/config");
}

export function uploadClip(file: File, signal?: AbortSignal): Promise<ClipResponse> {
  const form = new FormData();
  form.append("file", file);
  return request<ClipResponse>("/api/clips", { method: "POST", body: form, signal });
}

export function createSampleClip(signal?: AbortSignal): Promise<ClipResponse> {
  return request<ClipResponse>("/api/clips/sample", { method: "POST", signal });
}

export function processClip(
  clipId: string,
  settings: FilterSettings,
  signal?: AbortSignal,
): Promise<ProcessResponse> {
  return request<ProcessResponse>(`/api/clips/${clipId}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
    signal,
  });
}

export function compareFilters(
  clipId: string,
  settings: FilterSettings,
  signal?: AbortSignal,
): Promise<CompareResponse> {
  return request<CompareResponse>(`/api/clips/${clipId}/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
    signal,
  });
}
