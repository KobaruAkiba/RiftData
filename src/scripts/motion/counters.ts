import { gsap, ScrollTrigger } from "./gsap.js";
import type { MotionStarter } from "./lifecycle.js";
import { safeStart } from "./safe-start.js";
import { readMotionTokens } from "./tokens.js";

/** Decimals of the target ("12.5" has 1), so intermediate values keep the same format. */
function decimalsOf(target: string): number {
  return (target.split(".")[1] ?? "").length;
}

export const start: MotionStarter = (root, settings) => {
  const counters = Array.from(root.querySelectorAll<HTMLElement>("[data-count-to]"));
  if (!settings.countUp || counters.length === 0) return () => {};

  const { slow, easeOut } = readMotionTokens();

  return safeStart((onCleanup) => {
    // The context is registered before anything is built, so a failure still reverts what exists.
    const ctx = gsap.context(() => {});
    onCleanup(() => ctx.revert());

    const tweens: gsap.core.Tween[] = [];
    // Printing must show the final values even if the counters have not come into view.
    const finishAll = () => tweens.forEach((tween) => tween.progress(1));
    window.addEventListener("beforeprint", finishAll);
    onCleanup(() => window.removeEventListener("beforeprint", finishAll));

    ctx.add(() => {
      for (const counter of counters) {
        const targetText = counter.dataset.countTo ?? "";
        const target = Number(targetText);
        if (targetText === "" || !Number.isFinite(target)) continue;

        const decimals = decimalsOf(targetText);
        const original = counter.textContent;

        // Registered before the counter is touched: a failure from here on puts it back.
        // Screen readers get the final value once, from a visually hidden copy, instead of
        // every intermediate number of the animated text.
        const spoken = document.createElement("span");
        spoken.className = "visually-hidden";
        spoken.textContent = original;
        onCleanup(() => {
          spoken.remove();
          counter.removeAttribute("aria-hidden");
          counter.style.minWidth = "";
          counter.textContent = original;
        });

        // Fixing the width to the final one keeps the layout still while the digits grow.
        counter.style.minWidth = `${counter.getBoundingClientRect().width}px`;
        counter.setAttribute("aria-hidden", "true");
        counter.after(spoken);

        const render = (value: number) => {
          counter.textContent = value.toFixed(decimals);
        };
        const state = { value: target };
        const count = gsap.from(state, {
          value: 0,
          duration: slow,
          ease: easeOut,
          paused: true,
          onUpdate: () => render(state.value),
        });
        tweens.push(count);
        render(0);
        ScrollTrigger.create({ trigger: counter, start: "top 95%", once: true, onEnter: () => count.play() });
      }
    });
  });
};
