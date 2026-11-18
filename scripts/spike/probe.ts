import type { HttpInit, HttpResult } from "../lib/http.js";

export type ProbeId = "leaguepedia" | "livestats" | "cors";
export type Verdict = "ok" | "partial" | "blocked" | "fail";

export interface ProbeOutcome {
  verdict: Verdict;
  summary: string;
  details: string[];
}

export interface ProbeResult extends ProbeOutcome {
  id: ProbeId;
  question: string;
}

export interface ProbeDeps {
  http: (url: string, init?: HttpInit) => Promise<HttpResult>;
  sleep: (ms: number) => Promise<void>;
  /** Writes spike-samples/<name>.json */
  saveSample: (name: string, data: unknown) => Promise<void>;
  env: { leaguepediaUser?: string; leaguepediaPassword?: string };
}

export interface ProbeDefinition {
  id: ProbeId;
  question: string;
  run: (deps: ProbeDeps) => Promise<ProbeOutcome>;
}

/** Runs a probe; any thrown error becomes a `fail` verdict so the report is always written. */
export async function runProbe(def: ProbeDefinition, deps: ProbeDeps): Promise<ProbeResult> {
  try {
    const outcome = await def.run(deps);
    return { id: def.id, question: def.question, ...outcome };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: def.id, question: def.question, verdict: "fail", summary: message, details: [] };
  }
}

/** Escapes characters that would break a Markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderReport(results: ProbeResult[], generatedAt: Date): string {
  const lines = [
    "# RiftData — Spike fonti dati",
    "",
    `Generato: ${generatedAt.toISOString()}`,
    "",
    "| Sonda | Domanda | Esito | Sintesi |",
    "|---|---|---|---|",
    ...results.map(
      (r) => `| ${r.id} | ${cell(r.question)} | ${r.verdict} | ${cell(r.summary)} |`,
    ),
  ];
  for (const r of results) {
    lines.push("", `## ${r.id}`, "");
    lines.push(...r.details.map((d) => `- ${d}`));
  }
  return lines.join("\n") + "\n";
}
