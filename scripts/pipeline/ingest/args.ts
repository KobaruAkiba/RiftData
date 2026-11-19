export interface IngestArgs {
  full: boolean;
  years?: number[];
}

/** `--full` rebuilds every edition; `--year 2026,2025` (or repeated) limits the run to those years. */
export function parseIngestArgs(argv: string[]): IngestArgs {
  let full = false;
  const years: number[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--full") {
      full = true;
    } else if (argv[i] === "--year" && argv[i + 1]) {
      for (const part of argv[++i]!.split(",")) {
        const year = Number(part.trim());
        if (!Number.isInteger(year)) throw new Error(`Invalid --year value: "${part}"`);
        years.push(year);
      }
    }
  }
  return { full, ...(years.length > 0 ? { years } : {}) };
}
