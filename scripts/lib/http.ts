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

/** Performs a request. Never throws on non-2xx; throws only on network error or timeout. */
export async function httpRequest(url: string, init: HttpInit = {}): Promise<HttpResult> {
  const response = await fetch(url, {
    method: init.method ?? "GET",
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
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
