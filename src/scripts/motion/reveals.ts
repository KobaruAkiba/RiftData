import { gsap, ScrollTrigger } from "./gsap.js";
import type { MotionStarter } from "./lifecycle.js";
import { safeStart } from "./safe-start.js";
import { readMotionTokens } from "./tokens.js";

const REVEAL_OFFSET_PX = 24;

export const start: MotionStarter = (root, settings) => {
  const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
  if (!settings.staggerReveal || rows.length === 0) return () => {};

  const { base, fast, easeOut } = readMotionTokens();
  const stagger = fast / 4;

  return safeStart((onCleanup) => {
    // The context is registered before anything is built, so a failure still reverts what exists.
    const ctx = gsap.context(() => {});
    onCleanup(() => ctx.revert());

    ctx.add(() => {
      // One paused from() per row hides it right away; no initial state lives in the CSS.
      const tweens = new Map(
        rows.map((row) => [
          row,
          gsap.from(row, { opacity: 0, y: REVEAL_OFFSET_PX, duration: base, ease: easeOut, paused: true }),
        ]),
      );
      // Rows that enter the viewport together are played with a stagger.
      ScrollTrigger.batch(rows, {
        start: "top 94%",
        once: true,
        onEnter: (batch) => {
          batch.forEach((row, index) => {
            tweens.get(row as HTMLElement)?.delay(index * stagger).play();
          });
        },
      });
    });
  });
};
