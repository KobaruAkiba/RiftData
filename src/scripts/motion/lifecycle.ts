import type { MotionSettings } from "./settings.js";

/** Starts one effect on a page and returns the function that undoes it. */
export type MotionStarter = (root: ParentNode, settings: MotionSettings) => () => void;

export interface MotionLifecycle {
  mount(root: ParentNode, settings: MotionSettings): void;
  unmount(): void;
  /** Number of effects currently running. */
  readonly active: number;
}

/**
 * Owns the cleanups of the effects of the current page.
 * Mounting twice without an unmount in between cleans up first, so effects never stack.
 * One failing starter or cleanup must not stop the others: the page stays usable without it.
 */
export function createMotionLifecycle(starters: MotionStarter[]): MotionLifecycle {
  let cleanups: Array<() => void> = [];

  function unmount(): void {
    // Reverse order: later effects may depend on earlier ones (e.g. triggers on top of smooth scroll).
    const pending = cleanups.reverse();
    cleanups = [];
    for (const cleanup of pending) {
      try {
        cleanup();
      } catch (error) {
        console.error("Motion cleanup failed", error);
      }
    }
  }

  function mount(root: ParentNode, settings: MotionSettings): void {
    unmount();
    for (const start of starters) {
      try {
        cleanups.push(start(root, settings));
      } catch (error) {
        console.error("Motion effect failed to start", error);
      }
    }
  }

  return {
    mount,
    unmount,
    get active() {
      return cleanups.length;
    },
  };
}
