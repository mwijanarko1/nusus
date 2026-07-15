import { NususError } from "./errors.js";

export type FetchLike = typeof fetch;

export type TransportOptions = {
  baseUrl?: string;
  fetch?: FetchLike;
  timeout?: number;
};

const retryAfterSeconds = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
};

export const createTransport = ({
  baseUrl = "https://api.turath.io/",
  fetch: fetcher = globalThis.fetch,
  timeout = 10_000,
}: TransportOptions = {}) => {
  if (typeof fetcher !== "function") {
    throw new NususError("INVALID_ARGUMENT", "A fetch implementation is required");
  }
  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new NususError("INVALID_ARGUMENT", "timeout must be a non-negative number");
  }

  return async <T>(path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> => {
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer = timeout ? setTimeout(() => controller.abort(new Error("Request timed out")), timeout) : undefined;

    try {
      if (controller.signal.aborted) throw controller.signal.reason;
      const response = await fetcher(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        const code = response.status === 404 ? "NOT_FOUND" : response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR";
        throw new NususError(code, `Turath request failed with HTTP ${response.status}`, {
          status: response.status,
          url: url.href,
          retryAfter: retryAfterSeconds(response.headers.get("retry-after")),
        });
      }
      try {
        return (await response.json()) as T;
      } catch (cause) {
        throw new NususError("INVALID_RESPONSE", "Turath returned invalid JSON", { url: url.href, cause });
      }
    } catch (cause) {
      if (cause instanceof NususError) throw cause;
      if (controller.signal.aborted) {
        throw new NususError("ABORTED", signal?.aborted ? "Request aborted" : "Request timed out", {
          url: url.href,
          cause,
        });
      }
      throw new NususError("HTTP_ERROR", "Turath request failed", { url: url.href, cause });
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  };
};
