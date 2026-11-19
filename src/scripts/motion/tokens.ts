import { CustomEase } from "./gsap.js";

export interface MotionTokens {
  /** Durations in seconds. */
  fast: number;
  base: number;
  slow: number;
  easeOut: gsap.EaseFunction;
}

function readToken(styles: CSSStyleDeclaration, name: string): string {
  const value = styles.getPropertyValue(name).trim();
  if (value === "") throw new Error(`Missing design token ${name}`);
  return value;
}

/** "180ms" or "0.18s" to seconds. */
function toSeconds(value: string): number {
  const seconds = value.endsWith("ms") ? parseFloat(value) / 1000 : parseFloat(value);
  if (!Number.isFinite(seconds)) throw new Error(`Invalid duration token "${value}"`);
  return seconds;
}

/** "cubic-bezier(0.16, 1, 0.3, 1)" to a GSAP ease; CustomEase reads the four control values. */
function toEase(id: string, value: string): gsap.EaseFunction {
  const match = /^cubic-bezier\(([^)]+)\)$/.exec(value);
  if (match?.[1] === undefined) throw new Error(`Invalid easing token "${value}"`);
  return CustomEase.create(id, match[1]);
}

// Tokens are the same on every page, so they are read (and the ease registered) once per session.
let cached: MotionTokens | undefined;

/** Reads durations and easing from tokens.css: the stylesheet stays the only source of truth. */
export function readMotionTokens(root: HTMLElement = document.documentElement): MotionTokens {
  if (cached !== undefined) return cached;
  const styles = getComputedStyle(root);
  cached = {
    fast: toSeconds(readToken(styles, "--duration-fast")),
    base: toSeconds(readToken(styles, "--duration-base")),
    slow: toSeconds(readToken(styles, "--duration-slow")),
    easeOut: toEase("rd-ease-out", readToken(styles, "--ease-out")),
  };
  return cached;
}
