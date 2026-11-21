import { expect, test } from "vitest";
import { causeChain, describeCause, NetworkError } from "../../scripts/lib/network-error.js";

function undiciLike(): TypeError {
  const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  return new TypeError("fetch failed", { cause: reset });
}

test("describeCause walks the cause chain and adds codes missing from the message", () => {
  expect(describeCause(undiciLike())).toBe("fetch failed <- read ECONNRESET");
  const timeout = Object.assign(new Error("connect timed out"), { code: "UND_ERR_CONNECT_TIMEOUT" });
  expect(describeCause(new TypeError("fetch failed", { cause: timeout }))).toBe(
    "fetch failed <- connect timed out [UND_ERR_CONNECT_TIMEOUT]",
  );
});

test("an AggregateError with an empty message is described by name and code", () => {
  const agg = Object.assign(new AggregateError([]), { code: "ETIMEDOUT" });
  expect(describeCause(agg)).toBe("AggregateError [ETIMEDOUT]");
});

test("causeChain is bounded and cycle-safe", () => {
  const a: Error & { cause?: unknown } = new Error("a");
  a.cause = a;
  expect(causeChain(a)).toEqual(["a"]);
});

test("NetworkError keeps its name, message and cause", () => {
  const cause = undiciLike();
  const error = new NetworkError("GET host/path: fetch failed <- read ECONNRESET", { cause });
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("NetworkError");
  expect(error.message).toBe("GET host/path: fetch failed <- read ECONNRESET");
  expect(error.cause).toBe(cause);
});
