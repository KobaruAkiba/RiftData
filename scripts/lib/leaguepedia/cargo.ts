import type { HttpResult } from "../http.js";
import { LEAGUEPEDIA_API } from "../sources.js";

export interface CargoQuery {
  tables: string;
  fields: string;
  where?: string;
  limit?: number;
  orderBy?: string;
  offset?: number;
}

export type CargoOutcome =
  | { kind: "ok"; rows: Record<string, string>[] }
  | { kind: "rate_limited" }
  | { kind: "blocked"; status: number }
  | { kind: "error"; message: string };

export function buildCargoUrl(q: CargoQuery): string {
  const params = new URLSearchParams({ action: "cargoquery", format: "json", tables: q.tables, fields: q.fields });
  if (q.where !== undefined) params.set("where", q.where);
  if (q.limit !== undefined) params.set("limit", String(q.limit));
  if (q.orderBy !== undefined) params.set("order_by", q.orderBy);
  if (q.offset !== undefined) params.set("offset", String(q.offset));
  return `${LEAGUEPEDIA_API}?${params.toString()}`;
}

/** Quotes a value for a Cargo `where` clause: double quotes, with `"` and `\` escaped by `\`. */
export function cargoString(value: string): string {
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

interface CargoBody {
  cargoquery?: unknown;
  error?: { code?: string; info?: string };
}

/**
 * Maps an HTTP response to a Cargo outcome. Leaguepedia can answer 200 with an error body
 * (e.g. `ratelimited`), so the body is inspected before declaring success.
 */
export function classifyCargoResponse(res: HttpResult): CargoOutcome {
  if (res.status === 429) return { kind: "rate_limited" };
  if ([401, 402, 403].includes(res.status)) return { kind: "blocked", status: res.status };

  let body: CargoBody;
  try {
    const parsed: unknown = JSON.parse(res.text);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    body = parsed as CargoBody;
  } catch {
    return { kind: "error", message: `non-JSON response (status ${res.status})` };
  }

  if (body.error?.code === "ratelimited") return { kind: "rate_limited" };
  if (res.status === 200 && Array.isArray(body.cargoquery)) {
    const rows = (body.cargoquery as { title: Record<string, string> }[]).map((entry) => entry.title);
    return { kind: "ok", rows };
  }
  const info = body.error?.info ? `: ${body.error.info}` : "";
  return { kind: "error", message: `status ${res.status}${info}` };
}
