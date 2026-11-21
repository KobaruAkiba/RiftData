import { describeCause, NetworkError } from "./network-error.js";

export { NetworkError } from "./network-error.js";

export const USER_AGENT =
  "RiftData-bot/0.1 (League of Legends esports fan site data pipeline)";

export interface HttpInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  setCookie: string[];
  text: string;
}

export type HttpFn = (url: string, init?: HttpInit) => Promise<HttpResult>;

/** Host and path only: the query string may carry tokens and the body never appears in errors. */
function safeTarget(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname}`;
  } catch {
    return "<invalid url>";
  }
}

/** Performs a request. Never throws on non-2xx; throws NetworkError on a network error or timeout. */
export async function httpRequest(url: string, init: HttpInit = {}): Promise<HttpResult> {
  const method = init.method ?? "GET";
  try {
    const response = await fetch(url, {
      method,
      headers: { ...init.headers, "user-agent": USER_AGENT },
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      status: response.status,
      headers,
      setCookie: response.headers.getSetCookie(),
      text: await response.text(),
    };
  } catch (error) {
    // undici reports only "fetch failed"; the real reason (ECONNRESET, ENOTFOUND, ...) sits in error.cause.
    throw new NetworkError(`${method} ${safeTarget(url)}: ${describeCause(error)}`, { cause: error });
  }
}

/** Waits before the 2nd, 3rd and 4th attempt of a request that failed with a network error. */
export const NETWORK_BACKOFF_MS = [2_000, 5_000, 15_000];

export interface NetworkRetryOptions {
  sleep: (ms: number) => Promise<void>;
  backoffMs?: number[];
}

/**
 * Decorates an http function: retries only on NetworkError (timeouts included, they are NetworkErrors too),
 * rethrowing the last one when the backoff list is exhausted. Any other error propagates at once.
 */
export function withNetworkRetry(http: HttpFn, options: NetworkRetryOptions): HttpFn {
  const backoffMs = options.backoffMs ?? NETWORK_BACKOFF_MS;
  return async (url, init) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await http(url, init);
      } catch (error) {
        const wait = backoffMs[attempt];
        if (!(error instanceof NetworkError) || wait === undefined) throw error;
        await options.sleep(wait);
      }
    }
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
