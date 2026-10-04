/* Pure-function tests for normalizeTitle — the single source of truth for
 * cache, favorites and override keys. No browser needed. */
const vm = require('vm');
const { readScript } = require('../lib/env');

/** Pull normalizeTitle (and the regexes it closes over) out of the userscript. */
function loadNormalizeTitle() {
  const src = readScript();
  const consts = [...new Set([...src.matchAll(/^const _[A-Z_]+ = .*$/gm)].map((m) => m[0]))];
  const fn = src.match(/^function normalizeTitle\(raw\)[\s\S]*?\n}/m);
  if (!consts.length || !fn) {
    throw new Error('Could not extract normalizeTitle from the userscript — update test/specs/title.spec.js');
  }
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(`${consts.join('\n')}\n${fn[0]}\nglobalThis.__fn = normalizeTitle;`, ctx);
  return ctx.__fn;
}

const CASES = [
  ['Kusuriya no Hitorigoto — 05', 'Kusuriya no Hitorigoto', 'plain episode'],
  ['Sousou no Frieren — 12.5', 'Sousou no Frieren', 'decimal/recap episode'],
  ['Show — 01 + 02', 'Show', 'mixed episode pair'],
  ['Show — 12.5-13', 'Show', 'mixed range'],
  ['Show — 01-24', 'Show', 'batch range'],
  ['Show — 03v2', 'Show', 'version marker'],
  ['Show — OVA', 'Show', 'OVA special'],
  ['Show — OAD', 'Show', 'OAD special'],
  ['Show — SP1', 'Show', 'numbered special'],
  ['Show — Movie', 'Show', 'movie'],
  ['Show — Recap', 'Show', 'recap'],
  ['Show (Batch)', 'Show', 'batch suffix'],
  ['Show (END)', 'Show', 'trailing note'],
  ["Show [Director's Cut]", 'Show', 'bracketed note'],
  ['Blue Box (2024)', 'Blue Box (2024)', 'disambiguating year is kept'],
  ['Show S2 — 03', 'Show 2nd Season', 'season marker'],
  ['Show S3', 'Show 3rd Season', 'bare season marker'],
  ['Show S11', 'Show 11th Season', '11th, not 11st'],
  ['Show S12', 'Show 12th Season', '12th, not 12nd'],
  ['Show S13', 'Show 13th Season', '13th, not 13rd'],
  ['Show   with\n  wrapped   title — 01', 'Show with wrapped title', 'whitespace collapsed'],
];

module.exports = {
  name: 'title parsing',
  browser: false,
  async run({ check }) {
    const normalizeTitle = loadNormalizeTitle();
    for (const [input, expected, label] of CASES) {
      const got = normalizeTitle(input);
      check(`${label}: ${JSON.stringify(input)}`, got === expected, `got ${JSON.stringify(got)}, want ${JSON.stringify(expected)}`);
    }
    // Keys must be stable: normalizing twice changes nothing.
    const unstable = CASES.map(([i]) => normalizeTitle(i)).filter((t) => normalizeTitle(t) !== t);
    check('normalization is idempotent', unstable.length === 0, unstable.join(', '));
  },
};
