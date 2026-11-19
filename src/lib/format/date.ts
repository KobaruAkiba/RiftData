const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Giorno in UTC (uguale per ogni visitatore), es. "Nov 14". */
export function formatMatchDay(iso: string | undefined): string | null {
  if (iso === undefined) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : dayFormat.format(date);
}
