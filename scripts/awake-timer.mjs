// A timeout that counts only time the Mac was awake (D130). Node's own timers keep counting while
// the Mac sleeps (lid closed), so a 2-hour step limit could run out in a few minutes of real work.
// A tick every 30 s measures elapsed time; a gap far longer than one tick means the Mac slept, and
// that gap is counted as sleep, not as work.

export const TICK_MS = 30_000;
export const SLEEP_GAP_MS = 120_000; // a tick that arrives 2+ minutes late = the Mac was asleep

/**
 * Call `onFire` once `ms` of awake time has passed. Returns { clear(), sleptMs(), awakeMs() }.
 * The interval is unref'd, so it never keeps a finished process alive.
 */
export function awakeTimeout(ms, onFire, { tickMs: tickMax = TICK_MS, gapMs = SLEEP_GAP_MS, now = Date.now, every = setInterval, stop = clearInterval } = {}) {
  const tickMs = Math.max(1, Math.min(tickMax, ms)); // a short limit is checked as often as it needs
  let last = now();
  let awake = 0;
  let slept = 0;
  let fired = false;
  const tick = () => {
    const t = now();
    const d = t - last;
    last = t;
    if (d > gapMs) { awake += tickMs; slept += d - tickMs; } else awake += d;
    if (!fired && awake >= ms) { fired = true; stop(h); onFire(); }
  };
  const h = every(tick, tickMs);
  h?.unref?.();
  return {
    clear: () => { tick(); fired = true; stop(h); },
    sleptMs: () => slept,
    awakeMs: () => awake,
  };
}
