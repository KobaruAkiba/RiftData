import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { reportFatal } from "../../scripts/pipeline/cli.js";
import { NetworkError } from "../../scripts/lib/network-error.js";

let lines: string[];
let previousExitCode: typeof process.exitCode;

beforeEach(() => {
  lines = [];
  previousExitCode = process.exitCode;
  vi.spyOn(console, "error").mockImplementation((line: unknown) => void lines.push(String(line)));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = previousExitCode;
});

function networkFailure(): NetworkError {
  const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  const fetchFailed = new TypeError("fetch failed", { cause: reset });
  return new NetworkError("GET host/path: fetch failed <- read ECONNRESET", { cause: fetchFailed });
}

test("prints name, message and the cause chain, and sets exit code 1", () => {
  vi.stubEnv("DEBUG", "");
  reportFatal(networkFailure());
  expect(lines).toEqual([
    "NetworkError: GET host/path: fetch failed <- read ECONNRESET",
    "  caused by: fetch failed",
    "  caused by: read ECONNRESET",
  ]);
  expect(process.exitCode).toBe(1);
});

test("adds the stack only when DEBUG is set", () => {
  vi.stubEnv("DEBUG", "1");
  reportFatal(new Error("boom"));
  expect(lines[0]).toBe("Error: boom");
  expect(lines.join("\n")).toContain("at ");
});

test("handles non-Error values", () => {
  reportFatal("plain");
  expect(lines).toEqual(["plain"]);
  expect(process.exitCode).toBe(1);
});
