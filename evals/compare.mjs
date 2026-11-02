// Pure comparison logic for calibration: no file or network access, fully testable.

/** The facts that decide a tier, pulled from a full facts object. */
export function keyFactsOf(facts) {
  const { posting, judgment: j, company } = facts;
  const pay = posting.pay;
  return {
    family: j.role_family?.value ?? null,
    shape: j.role_shape?.value ?? null,
    fit: j.fit?.value ?? null,
    company_status: company.status ?? null,
    pay_top: pay && pay.interval === 'year' ? (pay.max ?? pay.min ?? null) : null,
    traps: [...(j.traps || []).map((t) => t.trap)].sort(),
    red_flags: [...new Set((j.red_flags || []).map((r) => r.flag))].sort(),
    years_min: j.years_required?.min ?? null,
    work_model: j.work_model?.value ?? null,
    back_office: Boolean(j.back_office?.value),
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Compare one case.
 * @param {object} label      { tier, key_facts?, key_facts_confirmed? }
 * @param {object} facts      extracted facts (snapshot)
 * @param {object} result     decideTier() output for those facts
 * @returns {{ match: boolean, kind: 'match'|'extraction'|'rule'|'unconfirmed', diffs: string[] }}
 */
export function compareCase(label, facts, result) {
  if (result.tier === label.tier) return { match: true, kind: 'match', diffs: [] };
  if (!label.key_facts || !label.key_facts_confirmed) {
    return { match: false, kind: 'unconfirmed', diffs: ['key facts not confirmed yet, so the miss cannot be classified'] };
  }
  const got = keyFactsOf(facts);
  const diffs = Object.entries(label.key_facts)
    .filter(([k, want]) => !same(want, got[k]))
    .map(([k, want]) => `${k}: expected ${JSON.stringify(want)}, extracted ${JSON.stringify(got[k])}`);
  return { match: false, kind: diffs.length ? 'extraction' : 'rule', diffs };
}

/** Summary line, e.g. "9/12 match (75%) · 2 AI misreads · 1 rule miss". */
export function summarize(rows) {
  const n = rows.length;
  const m = rows.filter((r) => r.cmp.match).length;
  const count = (k) => rows.filter((r) => r.cmp.kind === k).length;
  const parts = [`${m}/${n} match (${n ? Math.round((100 * m) / n) : 0}%)`];
  if (count('extraction')) parts.push(`${count('extraction')} AI misread(s)`);
  if (count('rule')) parts.push(`${count('rule')} rule miss(es)`);
  if (count('unconfirmed')) parts.push(`${count('unconfirmed')} unclassified (facts unconfirmed)`);
  return parts.join(' · ');
}
