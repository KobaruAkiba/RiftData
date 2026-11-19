import { expect, test } from "vitest";
import { buildNav } from "../../src/lib/nav/sections.js";

test("nav lists the four sections with only the featured Worlds available", () => {
  expect(buildNav(2026)).toEqual([
    { label: "Worlds 2026", href: "/" },
    { label: "Leagues", href: null },
    { label: "Teams", href: null },
    { label: "Worlds History", href: null },
  ]);
});
