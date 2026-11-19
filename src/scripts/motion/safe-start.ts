export type Cleanup = () => void;

/**
 * Builds an effect step by step. `onCleanup` registers an undo step as soon as the matching
 * change exists, so if a later step throws, everything done so far is undone before the error
 * is rethrown: the page is never left with content hidden by half-built animations.
 * On success it returns one cleanup that runs the registered steps in reverse order.
 */
export function safeStart(build: (onCleanup: (undo: Cleanup) => void) => void): Cleanup {
  const steps: Cleanup[] = [];

  const undoAll: Cleanup = () => {
    // Run every step even if one fails; report the first failure at the end.
    let firstError: unknown;
    let failed = false;
    for (const undo of steps.splice(0).reverse()) {
      try {
        undo();
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
    if (failed) throw firstError;
  };

  try {
    build((undo) => steps.push(undo));
  } catch (error) {
    try {
      undoAll();
    } catch (cleanupError) {
      console.error("Motion partial cleanup failed", cleanupError);
    }
    throw error;
  }
  return undoAll;
}
