/**
 * Exponential backoff with equal jitter.
 *
 * Attempts 0, 1, 2... produce ceilings base, 2*base, 4*base up to cap. The
 * delay returned for a ceiling is uniformly distributed in [ceiling/2, ceiling].
 *
 * Full jitter (uniform in [0, ceiling]) looks fairer but is worse here: many
 * viewers that lost the same publisher tend to fail together, and full jitter
 * lets a share of them retry at almost T=0, which recreates the spike. Equal
 * jitter keeps the spread and a real floor.
 */
export function createBackoff({ baseMs = 500, capMs = 8000, random = Math.random } = {}) {
  let attempt = 0;

  const ceilingFor = (n) => Math.min(capMs, baseMs * 2 ** n);

  return {
    next() {
      const ceiling = ceilingFor(attempt);
      attempt += 1;
      return Math.round(ceiling / 2 + random() * (ceiling / 2));
    },
    peek() {
      return ceilingFor(attempt);
    },
    reset() {
      attempt = 0;
    },
    get attempt() {
      return attempt;
    },
  };
}
