import { causeChain } from "../lib/network-error.js";

/**
 * Reports a fatal CLI error on stderr and flags the process as failed.
 * Prints `Name: message`, then the cause chain with error codes (undici hides the real reason in `cause`).
 * The stack is added only when env DEBUG is set.
 */
export function reportFatal(error: unknown): void {
  if (!(error instanceof Error)) {
    console.error(String(error));
  } else {
    console.error(`${error.name}: ${error.message}`);
    // The first link is the error itself, already printed above.
    for (const link of causeChain(error).slice(1)) console.error(`  caused by: ${link}`);
    if (process.env.DEBUG && error.stack) console.error(error.stack);
  }
  process.exitCode = 1;
}
