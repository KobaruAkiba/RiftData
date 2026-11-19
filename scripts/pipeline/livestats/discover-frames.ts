import { MAX_FIXTURE_BYTES } from "./discover-io.js";

/* Frame thinning so that large feed responses fit the fixture size cap. */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

export function withFrames(raw: unknown, pick: (frames: unknown[]) => unknown[]): unknown {
  if (!isRec(raw) || !Array.isArray(raw.frames)) return raw;
  return { ...raw, frames: pick(raw.frames) };
}

/** Every `stride`-th frame, always keeping the last one. */
export function thin(frames: unknown[], stride: number): unknown[] {
  return frames.filter((_, i) => i % stride === 0 || i === frames.length - 1);
}

const size = (v: unknown): number => Buffer.byteLength(JSON.stringify(v));

/** Smallest stride at which every response fits the fixture cap. */
export function strideFor(responses: unknown[]): number {
  for (let stride = 1; ; stride++) {
    if (responses.every((r) => size(withFrames(r, (f) => thin(f, stride))) < MAX_FIXTURE_BYTES - 1000)) return stride;
  }
}
