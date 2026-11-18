import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { httpRequest, sleep } from "../lib/http.js";
import {
  renderReport,
  runProbe,
  type ProbeDefinition,
  type ProbeDeps,
  type ProbeResult,
} from "./probe.js";

import { corsProbe } from "./cors.js";
import { leaguepediaProbe } from "./leaguepedia.js";
import { livestatsProbe } from "./livestats.js";

/** Probe registry: adding a probe = one import + one array entry. */
export const PROBES: ProbeDefinition[] = [leaguepediaProbe, livestatsProbe, corsProbe];

const DEFAULT_OUT = "docs/superpowers/spikes/2026-11-19-data-sources-report.md";
const SAMPLES_DIR = "spike-samples";

export interface CliArgs {
  only?: string[];
  out: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only" && argv[i + 1]) {
      args.only = argv[++i]!.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (argv[i] === "--out" && argv[i + 1]) {
      args.out = argv[++i]!;
    }
  }
  return args;
}

function buildDeps(): ProbeDeps {
  return {
    http: httpRequest,
    sleep,
    saveSample: async (name, data) => {
      await mkdir(SAMPLES_DIR, { recursive: true });
      await writeFile(`${SAMPLES_DIR}/${name}.json`, JSON.stringify(data, null, 2) + "\n");
    },
    env: {
      leaguepediaUser: process.env.LEAGUEPEDIA_BOT_USER,
      leaguepediaPassword: process.env.LEAGUEPEDIA_BOT_PASSWORD,
    },
  };
}

async function main(): Promise<void> {
  const { only, out } = parseArgs(process.argv.slice(2));
  const selected = only ? PROBES.filter((p) => only.includes(p.id)) : PROBES;
  const deps = buildDeps();
  const results: ProbeResult[] = [];
  for (const probe of selected) {
    results.push(await runProbe(probe, deps));
  }
  const report = renderReport(results, new Date());
  await mkdir(dirname(resolve(out)), { recursive: true });
  await writeFile(out, report);
  console.log(report);
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 0;
  });
}
