/** Transport-level failure (DNS, reset, connect or request timeout): no HTTP response was received. */
export class NetworkError extends Error {
  override name = "NetworkError";
}

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  cause?: unknown;
}

const MAX_CAUSE_DEPTH = 5;

/** One chain link as `message [CODE]`. Falls back to the name when the message is empty (AggregateError). */
function describeLink(link: ErrorLike): string {
  const message = typeof link.message === "string" && link.message !== "" ? link.message : String(link.name ?? "Error");
  const code = typeof link.code === "string" ? link.code : undefined;
  return code && !message.includes(code) ? `${message} [${code}]` : message;
}

/** Walks `error.cause` (bounded, cycle-safe) and describes every link, outermost first. */
export function causeChain(error: unknown): string[] {
  const links: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current) && links.length < MAX_CAUSE_DEPTH) {
    seen.add(current);
    links.push(typeof current === "object" ? describeLink(current as ErrorLike) : String(current));
    current = typeof current === "object" ? (current as ErrorLike).cause : undefined;
  }
  return links;
}

/** The whole cause chain on one line, e.g. `fetch failed <- read ECONNRESET [ECONNRESET]`. */
export function describeCause(error: unknown): string {
  return causeChain(error).join(" <- ");
}
