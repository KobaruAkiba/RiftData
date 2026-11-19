import { expect, test, vi } from "vitest";
import { motionSettings } from "../../src/scripts/motion/settings.js";
import { createMotionLifecycle } from "../../src/scripts/motion/lifecycle.js";
import { safeStart } from "../../src/scripts/motion/safe-start.js";

test("full motion enables every effect", () => {
  expect(Object.values(motionSettings(false)).every(Boolean)).toBe(true);
});

test("reduced motion disables every effect", () => {
  expect(motionSettings(true)).toEqual({
    smoothScroll: false,
    splitTitles: false,
    countUp: false,
    staggerReveal: false,
    diagonalTransition: false,
  });
});

test("remounting cleans up the previous page before starting again", () => {
  const cleanups = [vi.fn(), vi.fn()];
  const starters = cleanups.map((c) => vi.fn(() => c));
  const life = createMotionLifecycle(starters);
  life.mount({} as ParentNode, motionSettings(false));
  life.mount({} as ParentNode, motionSettings(false)); // navigation without before-swap
  expect(cleanups.map((c) => c.mock.calls.length)).toEqual([1, 1]);
  expect(starters.map((s) => s.mock.calls.length)).toEqual([2, 2]);
  expect(life.active).toBe(2);
  life.unmount();
  life.unmount();
  expect(cleanups.map((c) => c.mock.calls.length)).toEqual([2, 2]);
  expect(life.active).toBe(0);
});

test("a starter that throws does not stop the others, and cleanups run in reverse order", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const order: string[] = [];
  const life = createMotionLifecycle([
    () => () => order.push("first"),
    () => {
      throw new Error("boom");
    },
    () => () => order.push("third"),
  ]);
  life.mount({} as ParentNode, motionSettings(false));
  expect(life.active).toBe(2);
  expect(errors).toHaveBeenCalledTimes(1);
  life.unmount();
  expect(order).toEqual(["third", "first"]);
  expect(life.active).toBe(0);
  errors.mockRestore();
});

test("safeStart undoes the steps built so far when the build throws, then rethrows", () => {
  const undone: string[] = [];
  const failure = new Error("split failed");
  expect(() =>
    safeStart((onCleanup) => {
      onCleanup(() => undone.push("context"));
      onCleanup(() => undone.push("counter"));
      throw failure;
    }),
  ).toThrow(failure);
  expect(undone).toEqual(["counter", "context"]);
});

test("safeStart returns one cleanup that undoes every step once, in reverse order", () => {
  const undone: string[] = [];
  const cleanup = safeStart((onCleanup) => {
    onCleanup(() => undone.push("a"));
    onCleanup(() => undone.push("b"));
  });
  expect(undone).toEqual([]);
  cleanup();
  cleanup();
  expect(undone).toEqual(["b", "a"]);
});

test("safeStart keeps undoing when one step fails and still reports the failure", () => {
  const undone: string[] = [];
  const cleanup = safeStart((onCleanup) => {
    onCleanup(() => undone.push("a"));
    onCleanup(() => {
      throw new Error("revert failed");
    });
  });
  expect(cleanup).toThrow("revert failed");
  expect(undone).toEqual(["a"]);
});
