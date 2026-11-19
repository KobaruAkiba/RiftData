import { start as startCounters } from "./counters.js";
import { start as startLenis } from "./lenis.js";
import { createMotionLifecycle } from "./lifecycle.js";
import { start as startReveals } from "./reveals.js";
import { motionSettings } from "./settings.js";
import { start as startTitles } from "./titles.js";

// Smooth scroll first: the scroll triggers of the other effects sit on top of it.
const lifecycle = createMotionLifecycle([startLenis, startTitles, startCounters, startReveals]);

// Fires on the first load and after every ClientRouter navigation.
document.addEventListener("astro:page-load", () => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  lifecycle.mount(document, motionSettings(reduced));
});

// Fires before the new page replaces the current one.
document.addEventListener("astro:before-swap", () => lifecycle.unmount());
