import type { HttpResult } from "../lib/http.js";
import { LOLESPORTS_API, LOLESPORTS_PUBLIC_KEY, WORLDS_LEAGUE_ID } from "../lib/sources.js";
import type { ProbeDefinition, ProbeDeps, ProbeOutcome } from "./probe.js";

export const TEST_ORIGIN = "https://riftdata.pages.dev";

export interface CorsVerdict {
  allowed: boolean;
  reason: string;
}

const REQUEST_GAP_MS = 500;
const CORS_HEADERS = [
  "access-control-allow-origin",
  "access-control-allow-headers",
  "access-control-allow-methods",
];

function originAllowed(value: string | undefined, origin: string): boolean {
  return value === "*" || value === origin;
}

function headersAllowed(value: string | undefined): boolean {
  if (value === undefined) return false;
  const list = value.split(",").map((h) => h.trim().toLowerCase());
  return list.includes("*") || list.includes("x-api-key");
}

/** Mimics the browser: the first unmet condition decides why the response is unreadable. */
export function evaluateCors(preflight: HttpResult, get: HttpResult, origin: string): CorsVerdict {
  if (preflight.status < 200 || preflight.status > 299) {
    return { allowed: false, reason: `preflight status ${preflight.status} is not 2xx` };
  }
  if (!originAllowed(preflight.headers["access-control-allow-origin"], origin)) {
    return { allowed: false, reason: `preflight access-control-allow-origin is not * nor ${origin}` };
  }
  if (!headersAllowed(preflight.headers["access-control-allow-headers"])) {
    return { allowed: false, reason: "preflight access-control-allow-headers does not allow x-api-key" };
  }
  if (!originAllowed(get.headers["access-control-allow-origin"], origin)) {
    return { allowed: false, reason: `GET access-control-allow-origin is not * nor ${origin}` };
  }
  return { allowed: true, reason: "all CORS conditions met" };
}

function describeHeaders(label: string, res: HttpResult): string {
  const received = CORS_HEADERS.map((h) => `${h}=${res.headers[h] ?? "(missing)"}`).join(", ");
  return `${label} ${res.status}: ${received}`;
}

async function probeEndpoint(
  deps: ProbeDeps,
  path: string,
): Promise<{ verdict: CorsVerdict; details: string[] }> {
  const url = `${LOLESPORTS_API}/${path}`;
  const preflight = await deps.http(url, {
    method: "OPTIONS",
    headers: {
      origin: TEST_ORIGIN,
      "access-control-request-method": "GET",
      "access-control-request-headers": "x-api-key",
    },
  });
  await deps.sleep(REQUEST_GAP_MS);
  const get = await deps.http(url, {
    headers: { origin: TEST_ORIGIN, "x-api-key": LOLESPORTS_PUBLIC_KEY },
  });
  await deps.sleep(REQUEST_GAP_MS);
  const verdict = evaluateCors(preflight, get, TEST_ORIGIN);
  return {
    verdict,
    details: [
      `${path} -> allowed=${verdict.allowed} (${verdict.reason})`,
      describeHeaders(`${path} OPTIONS`, preflight),
      describeHeaders(`${path} GET`, get),
    ],
  };
}

async function run(deps: ProbeDeps): Promise<ProbeOutcome> {
  const paths = ["getLive?hl=en-US", `getSchedule?hl=en-US&leagueId=${WORLDS_LEAGUE_ID}`];
  const details: string[] = [];
  const blocked: string[] = [];
  for (const path of paths) {
    const result = await probeEndpoint(deps, path);
    details.push(...result.details);
    if (!result.verdict.allowed) blocked.push(`${path.split("?")[0]}: ${result.verdict.reason}`);
  }
  if (blocked.length === 0) {
    return { verdict: "ok", summary: "Browser CORS allowed on getLive and getSchedule", details };
  }
  return { verdict: "blocked", summary: blocked.join("; "), details };
}

export const corsProbe: ProbeDefinition = {
  id: "cors",
  question: "Can a visitor's browser read the lolesports schedule directly (CORS with x-api-key)?",
  run,
};
