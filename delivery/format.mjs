// Small text formats shared by the texts and the weekly email (Phase 7).

const PER = { year: '/yr', month: '/mo', hour: '/hr' };
const money = (n, cur) => {
  if (n == null) return null;
  const sym = cur === 'USD' || cur == null ? '$' : `${cur} `;
  return n >= 1000 ? `${sym}${Math.round(n / 1000)}K` : `${sym}${n}`;
};

/** "$140K–$175K/yr", "from $140K/yr", or "pay not posted". Never an estimate. */
export function payText(pay) {
  if (!pay || (pay.min == null && pay.max == null)) return 'pay not posted';
  const per = PER[pay.interval] ?? '';
  const lo = money(pay.min, pay.currency);
  const hi = money(pay.max, pay.currency);
  if (lo && hi) return lo === hi ? `${lo}${per}` : `${lo}–${hi}${per}`;
  return lo ? `from ${lo}${per}` : `up to ${hi}${per}`;
}

/** "$15M", "$1.6B", "$650K"; a missing amount says so. */
export function usd(n) {
  if (n == null) return 'amount not given';
  if (n >= 1e9) return `$${+(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${n >= 1e7 ? Math.round(n / 1e6) : +(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n / 1e3)}K`;
}
