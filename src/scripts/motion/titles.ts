import { gsap, ScrollTrigger, SplitText } from "./gsap.js";
import type { MotionStarter } from "./lifecycle.js";
import { safeStart } from "./safe-start.js";
import { readMotionTokens } from "./tokens.js";

export const start: MotionStarter = (root, settings) => {
  const titles = Array.from(root.querySelectorAll<HTMLElement>("[data-split]"));
  if (!settings.splitTitles || titles.length === 0) return () => {};

  const { base, fast, easeOut } = readMotionTokens();

  return safeStart((onCleanup) => {
    // The context is registered before anything is built, so a failure still reverts what exists.
    const ctx = gsap.context(() => {});
    onCleanup(() => ctx.revert());

    ctx.add(() => {
      for (const title of titles) {
        // Words are kept as units so a title never breaks in the middle of a word.
        // Nested elements (the accent year) stay in place: SplitText only wraps their text.
        const split = SplitText.create(title, { type: "words,chars" });
        onCleanup(() => split.revert());

        // from() hides the characters right away; the tween waits for the title to come into view.
        const reveal = gsap.from(split.chars, {
          opacity: 0,
          yPercent: 60,
          duration: base,
          ease: easeOut,
          stagger: fast / 8,
          paused: true,
        });
        ScrollTrigger.create({ trigger: title, start: "top 92%", once: true, onEnter: () => reveal.play() });
      }
    });
  });
};
