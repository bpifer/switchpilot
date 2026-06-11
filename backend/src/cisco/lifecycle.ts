interface LifecycleEntry {
  eos: string | null;  // End of Sale date (ISO)
  eol: string | null;  // End of Life / End of Support date (ISO)
  recommendedRelease?: string;
}

// Model prefix → lifecycle dates.  Patterns are matched longest-first.
// Sources: Cisco EoL/EoS bulletins (public).
const LIFECYCLE: Array<[string, LifecycleEntry]> = [
  // === Catalyst 2900 ===
  ['WS-C2924',    { eos: '2004-08-26', eol: '2009-08-26' }],
  ['WS-C2948',    { eos: '2004-08-26', eol: '2009-08-26' }],

  // === Catalyst 2960 (original) ===
  ['WS-C2960-',   { eos: '2016-01-31', eol: '2021-01-31' }],
  ['WS-C2960S-',  { eos: '2016-01-31', eol: '2021-01-31' }],
  ['WS-C2960P-',  { eos: '2016-01-31', eol: '2021-01-31' }],
  ['WS-C2960C-',  { eos: '2016-01-31', eol: '2021-01-31' }],

  // === Catalyst 2960X / 2960XR ===
  ['WS-C2960XR-', { eos: '2022-10-29', eol: '2027-10-29', recommendedRelease: '15.2(7)E10' }],
  ['WS-C2960X-',  { eos: '2022-01-31', eol: '2027-01-31', recommendedRelease: '15.2(7)E10' }],

  // === Catalyst 2960L ===
  ['WS-C2960L-',  { eos: '2024-09-30', eol: '2029-09-30', recommendedRelease: '15.2(7)E10' }],

  // === Catalyst 2960CX / 3560CX (compact) ===
  ['WS-C2960CX-', { eos: '2024-09-30', eol: '2029-09-30', recommendedRelease: '15.2(7)E10' }],
  ['WS-C3560CX-', { eos: '2024-09-30', eol: '2029-09-30', recommendedRelease: '15.2(7)E10' }],

  // === Catalyst 3550 ===
  ['WS-C3550-',   { eos: '2007-09-28', eol: '2012-09-28' }],

  // === Catalyst 3560 ===
  ['WS-C3560E-',  { eos: '2013-08-10', eol: '2018-08-10' }],
  ['WS-C3560V2-', { eos: '2013-08-10', eol: '2018-08-10' }],
  ['WS-C3560X-',  { eos: '2017-07-28', eol: '2022-07-28' }],
  ['WS-C3560-',   { eos: '2013-08-10', eol: '2018-08-10' }],

  // === Catalyst 3750 ===
  ['WS-C3750E-',  { eos: '2013-08-10', eol: '2018-08-10' }],
  ['WS-C3750V2-', { eos: '2013-08-10', eol: '2018-08-10' }],
  ['WS-C3750X-',  { eos: '2017-07-28', eol: '2022-07-28' }],
  ['WS-C3750G-',  { eos: '2013-08-10', eol: '2018-08-10' }],
  ['WS-C3750-',   { eos: '2013-08-10', eol: '2018-08-10' }],

  // === Catalyst 3650 ===
  ['WS-C3650-',   { eos: '2020-10-31', eol: '2025-10-31', recommendedRelease: '16.12.9' }],

  // === Catalyst 3850 ===
  ['WS-C3850-',   { eos: '2021-10-31', eol: '2026-10-31', recommendedRelease: '16.12.9' }],

  // === Catalyst 4500 ===
  ['WS-C4500X-',  { eos: '2022-01-31', eol: '2027-01-31', recommendedRelease: '03.11.07E' }],
  ['WS-C4507R',   { eos: '2015-07-31', eol: '2020-07-31' }],
  ['WS-C4510R',   { eos: '2015-07-31', eol: '2020-07-31' }],
  ['WS-C4503',    { eos: '2008-06-10', eol: '2013-06-10' }],
  ['WS-C4506',    { eos: '2015-07-31', eol: '2020-07-31' }],

  // === Catalyst 6500 ===
  ['WS-C6504',    { eos: '2014-08-01', eol: '2019-08-01' }],
  ['WS-C6506',    { eos: '2014-08-01', eol: '2019-08-01' }],
  ['WS-C6509',    { eos: '2014-08-01', eol: '2019-08-01' }],
  ['WS-C6513',    { eos: '2014-08-01', eol: '2019-08-01' }],
  ['WS-C6516',    { eos: '2014-08-01', eol: '2019-08-01' }],

  // === Catalyst 9200 ===
  ['C9200L-',     { eos: null, eol: null, recommendedRelease: '17.12.3' }],
  ['C9200-',      { eos: null, eol: null, recommendedRelease: '17.12.3' }],
  ['C9200CX-',    { eos: null, eol: null, recommendedRelease: '17.12.3' }],

  // === Catalyst 9300 ===
  ['C9300X-',     { eos: null, eol: null, recommendedRelease: '17.12.3' }],
  ['C9300L-',     { eos: null, eol: null, recommendedRelease: '17.12.3' }],
  ['C9300-',      { eos: null, eol: null, recommendedRelease: '17.12.3' }],

  // === Catalyst 9400 ===
  ['C9404R',      { eos: null, eol: null, recommendedRelease: '17.12.3' }],
  ['C9407R',      { eos: null, eol: null, recommendedRelease: '17.12.3' }],
  ['C9410R',      { eos: null, eol: null, recommendedRelease: '17.12.3' }],

  // === Catalyst 9500 ===
  ['C9500-',      { eos: null, eol: null, recommendedRelease: '17.12.3' }],
  ['C9500H-',     { eos: null, eol: null, recommendedRelease: '17.12.3' }],

  // === Catalyst 9600 ===
  ['C9606R',      { eos: null, eol: null, recommendedRelease: '17.12.3' }],
  ['C9610R',      { eos: null, eol: null, recommendedRelease: '17.12.3' }],

  // === Nexus 3000 ===
  ['N3K-C3',      { eos: null, eol: null }],

  // === Nexus 5000 / 5500 / 5600 ===
  ['N56-',        { eos: '2018-04-30', eol: '2023-04-30' }],
  ['N55-',        { eos: '2018-04-30', eol: '2023-04-30' }],
  ['N5K-C5',      { eos: '2018-04-30', eol: '2023-04-30' }],

  // === Nexus 7000 ===
  ['N7K-C7',      { eos: '2023-04-30', eol: '2028-04-30' }],

  // === Nexus 9000 ===
  ['N9K-C9',      { eos: null, eol: null, recommendedRelease: '10.3(5)M' }],
];

/** Lookup lifecycle dates for a model string. Matches on longest prefix first. */
export function lookupLifecycle(model: string): LifecycleEntry | null {
  if (!model) return null;
  const upper = model.toUpperCase().trim();
  let best: LifecycleEntry | null = null;
  let bestLen = 0;
  for (const [prefix, entry] of LIFECYCLE) {
    const p = prefix.toUpperCase();
    if (upper.startsWith(p) && p.length > bestLen) {
      best = entry;
      bestLen = p.length;
    }
  }
  return best;
}

/** Returns days until EOL from today. Negative = already past EOL. */
export function daysUntilEol(eolDate: string | null): number | null {
  if (!eolDate) return null;
  return Math.round((new Date(eolDate).getTime() - Date.now()) / 86_400_000);
}
