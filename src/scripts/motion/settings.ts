export interface MotionSettings {
  smoothScroll: boolean;
  splitTitles: boolean;
  countUp: boolean;
  staggerReveal: boolean;
  /** No script reads this flag: the page-transition cut lives in global.css behind
   *  `@media (prefers-reduced-motion: reduce)`. It is here so the settings mirror every effect. */
  diagonalTransition: boolean;
}

/** Reduced motion turns every effect off; the page stays complete and static. */
export function motionSettings(prefersReducedMotion: boolean): MotionSettings {
  const enabled = !prefersReducedMotion;
  return {
    smoothScroll: enabled,
    splitTitles: enabled,
    countUp: enabled,
    staggerReveal: enabled,
    diagonalTransition: enabled,
  };
}
