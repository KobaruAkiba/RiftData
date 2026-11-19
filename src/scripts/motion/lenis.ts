import Lenis from "lenis";
import { gsap, ScrollTrigger } from "./gsap.js";
import type { MotionStarter } from "./lifecycle.js";

// GSAP's default lag smoothing, restored on cleanup.
const DEFAULT_LAG_THRESHOLD = 500;
const DEFAULT_LAG_ADJUSTED = 33;

export const start: MotionStarter = (_root, settings) => {
  if (!settings.smoothScroll) return () => {};

  const lenis = new Lenis();
  // Lenis drives the scroll position; ScrollTrigger must be told on every Lenis tick.
  lenis.on("scroll", ScrollTrigger.update);
  // GSAP's ticker is the single animation clock. It passes seconds, Lenis wants milliseconds.
  const tick = (time: number) => lenis.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);

  return () => {
    gsap.ticker.remove(tick);
    gsap.ticker.lagSmoothing(DEFAULT_LAG_THRESHOLD, DEFAULT_LAG_ADJUSTED);
    lenis.destroy();
  };
};
