import { LEAGUEPEDIA_API } from "../lib/sources.js";
import type { ProbeDeps } from "./probe.js";

/** Keeps only the `name=value` pair of each Set-Cookie line; later duplicates of a name win. */
export function cookieHeader(setCookie: string[]): string {
  const pairs = new Map<string, string>();
  for (const line of setCookie) {
    const pair = (line.split(";")[0] ?? "").trim();
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    pairs.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return [...pairs].map(([name, value]) => `${name}=${value}`).join("; ");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Logs in with a Fandom bot password. Returns the Cookie header to send on later requests.
 * Throws if the login result is not "Success". Error messages never include the password.
 * `sleep` is optional: when given, it paces the two login requests.
 */
export async function loginWithBotPassword(
  deps: Pick<ProbeDeps, "http"> & Partial<Pick<ProbeDeps, "sleep">>,
  user: string,
  password: string,
): Promise<string> {
  const tokenRes = await deps.http(`${LEAGUEPEDIA_API}?action=query&meta=tokens&type=login&format=json`);
  const tokenJson = parseJson(tokenRes.text) as { query?: { tokens?: { logintoken?: string } } } | undefined;
  const loginToken = tokenJson?.query?.tokens?.logintoken;
  if (!loginToken) {
    throw new Error(`Leaguepedia login token not found (status ${tokenRes.status})`);
  }

  await deps.sleep?.(2000);

  const body = new URLSearchParams({
    action: "login",
    lgname: user,
    lgpassword: password,
    lgtoken: loginToken,
    format: "json",
  });
  const loginRes = await deps.http(LEAGUEPEDIA_API, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(tokenRes.setCookie),
    },
    body: body.toString(),
  });
  const loginJson = parseJson(loginRes.text) as { login?: { result?: string } } | undefined;
  const result = loginJson?.login?.result;
  if (result !== "Success") {
    throw new Error(`Leaguepedia login failed: ${result ?? `unexpected response (status ${loginRes.status})`}`);
  }

  return cookieHeader([...tokenRes.setCookie, ...loginRes.setCookie]);
}
