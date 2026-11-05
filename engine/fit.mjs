// "Could they use a deployment strategist?" (Phase 6, D75). The research step reports facts
// with evidence; this code turns them into the Radar's Deployment fit. Same principle as
// tiering (D4): the model reads, code decides. The fit never changes a role's tier.
//
//   Strong    — already hiring for deployment roles, or: sells to businesses, AI is the product,
//               enterprise customers, and rollout takes real setup per customer.
//   Possible  — sells to businesses, and AI is the product or rollout takes real setup.
//   Unlikely  — sells to consumers, or neither AI-first nor hands-on to roll out.
//   Unclear   — the facts aren't known yet.

export const FIT_LABELS = ['Strong', 'Possible', 'Unlikely', 'Unclear'];

const mark = (v) => (v === true ? '✓' : v === false ? '✗' : '?');

/**
 * entry: a company record (ai_native, fit_facts { sells_to_businesses, enterprise_customers,
 * hands_on_rollout }: { value, evidence }). openDeployment: open deployment-family postings.
 * Returns { fit, reason }, or null when the company was never researched with these questions.
 */
export function deploymentFit(entry, { openDeployment = 0 } = {}) {
  const f = entry?.fit_facts;
  if (!f) return null;
  const b2b = f.sells_to_businesses?.value ?? null;
  const ent = f.enterprise_customers?.value ?? null;
  const rollout = f.hands_on_rollout?.value ?? null;
  const ai = entry.ai_native ?? null;
  const facts = `Sells to businesses ${mark(b2b)} · AI is the product ${mark(ai)} · enterprise customers ${mark(ent)} · setup per customer ${mark(rollout)}`;
  const quote = [f.hands_on_rollout?.evidence, f.sells_to_businesses?.evidence].find(Boolean);
  const why = (lead) => [lead, facts, quote ? `"${String(quote).slice(0, 200)}"` : null].filter(Boolean).join('. ');

  if (openDeployment > 0) return { fit: 'Strong', reason: why(`Hiring now: ${openDeployment} open deployment role${openDeployment === 1 ? '' : 's'}`) };
  if (b2b === false) return { fit: 'Unlikely', reason: why('Sells to consumers') };
  if (ai === false && rollout === false) return { fit: 'Unlikely', reason: why('Not AI-first and self-serve to roll out') };
  if (b2b === true && ai === true && ent === true && rollout === true) return { fit: 'Strong', reason: why('Enterprise AI product with hands-on rollout') };
  if (b2b === true && (ai === true || rollout === true)) return { fit: 'Possible', reason: why('Business customers, partly matches') };
  return { fit: 'Unclear', reason: why('Not enough known yet') };
}
