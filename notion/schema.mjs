// Notion database layouts (D27). Pipeline-owned properties are overwritten on every
// sync; candidate-owned ones (OWNED_BY_YOU) are set only when a page is created and
// never touched again. Company Radar's editable fields are read back (D26).

import { JOBS_V7 } from '../packs/notion.mjs';

const opts = (names, color = 'default') => ({ options: names.map((name) => ({ name, color: typeof color === 'function' ? color(name) : color })) });
const tierColor = { S: 'purple', A: 'blue', B: 'green', C: 'gray', Excluded: 'red', 'Walk-away': 'brown' };

export const STATUS_OPTIONS = ['To review', 'Interested', 'Applied', 'Interviewing', 'Offer', 'Passed', 'Closed'];
export const COMPANY_STATUS = ['exceptional', 'strong', 'not_strong', 'unknown'];

export const RADAR_TITLE = 'Company Radar';
export const JOBS_TITLE = 'Job Postings';

export function radarProperties() {
  return {
    Name: { title: {} },
    Status: { select: opts(COMPANY_STATUS, (n) => ({ exceptional: 'purple', strong: 'green', not_strong: 'gray', unknown: 'default' })[n]) },
    Verified: { checkbox: {} },
    Watch: { checkbox: {} },
    'AI-native': { checkbox: {} },
    Stage: { select: {} },
    'Last raise': { rich_text: {} },
    Investors: { rich_text: {} },
    'What they do': { rich_text: {} },
    Parent: { rich_text: {} },
    'Excluded as': { multi_select: {} },
    Reason: { rich_text: {} },
    Sources: { rich_text: {} },
    Origin: { select: opts(['research', 'watchlist', 'you']) },
    'First seen': { date: {} },
    'Open postings': { number: {} },
    'Open deployment postings': { number: {} },
    ...RADAR_V6,
  };
}

// Phase 6 (D73): funding, leaders, NYC presence and deployment fit. Added to an existing
// Company Radar by ensureRadarColumns; all written by the kit, none are yours to edit.
export const FIT_OPTIONS = ['Strong', 'Possible', 'Unlikely', 'Unclear'];
export const FOUND_VIA = ['Form D', 'News', 'Job board', 'You'];
export const RADAR_V6 = {
  'Deployment fit': { select: opts(FIT_OPTIONS, (n) => ({ Strong: 'green', Possible: 'yellow', Unlikely: 'gray', Unclear: 'default' })[n]) },
  'Fit reason': { rich_text: {} },
  'Funding amount': { number: { format: 'dollar' } },
  'Funding date': { date: {} },
  'Funding source': { url: {} },
  'Found via': { select: opts(FOUND_VIA, (n) => ({ 'Form D': 'blue', News: 'purple', 'Job board': 'default', You: 'green' })[n]) },
  Leaders: { rich_text: {} },
  'NYC presence': { select: opts(['Yes', 'No', 'Unknown'], (n) => ({ Yes: 'green', No: 'gray', Unknown: 'default' })[n]) },
  'NYC evidence': { rich_text: {} },
  'Careers page': { url: {} },
};

export function jobsProperties(radarDataSourceId) {
  return {
    Role: { title: {} },
    Company: { relation: { data_source_id: radarDataSourceId, type: 'dual_property', dual_property: {} } },
    Tier: { select: opts(Object.keys(tierColor), (n) => tierColor[n]) },
    Why: { rich_text: {} },
    Flags: { multi_select: {} },
    Family: { select: {} },
    Shape: { select: opts(['strategic', 'mixed', 'tactical', 'unclear']) },
    Fit: { select: opts(['strong', 'possible', 'weak', 'unclear']) },
    'GM path': { checkbox: {} },
    'Product path': { checkbox: {} },
    'Back office': { checkbox: {} },
    'Pay min': { number: { format: 'dollar' } },
    'Pay max': { number: { format: 'dollar' } },
    'Pay source': { select: {} },
    Locations: { rich_text: {} },
    NYC: { checkbox: {} },
    'Work model': { select: {} },
    'Office days': { number: {} },
    'Years asked': { number: {} },
    Posted: { date: {} },
    'Date added': { date: {} },
    'Last seen': { date: {} },
    Live: { checkbox: {} },
    Board: { select: {} },
    URL: { url: {} },
    Key: { rich_text: {} },
    Status: { select: opts(STATUS_OPTIONS) },
    Favorite: { checkbox: {} },
    Notes: { rich_text: {} },
    ...JOBS_V7,
  };
}

/** Properties the candidate owns: set on create, never overwritten by sync. */
export const OWNED_BY_YOU = {
  // 'Prep pack' is the kit's, but written only by scripts/packs.mjs, never by the posting sync.
  jobs: ['Status', 'Favorite', 'Notes', 'Make pack'],
  radar: ['Status', 'Verified', 'Watch', 'AI-native'],
};
