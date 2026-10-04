/* Rating cache behaviour: status-based TTLs and silent background refresh. */
const { ratings, SHOWS_RATING } = require('../lib/env');

const DAY = 24 * 60 * 60 * 1000;

module.exports = {
  name: 'rating cache',
  async run({ check, base, newDevice }) {
    // A finished show keeps its score for a week; an airing one goes stale in 12h.
    const seed = `
      const old = Date.now() - 3 * ${DAY};
      localStorage.setItem('ratingCache', JSON.stringify({
        'Alpha Anime': { score: 80, status: 'FINISHED', timestamp: old },
        'Beta Show':   { score: 55, status: 'RELEASING', timestamp: old }
      }));`;
    const { page, errors } = await newDevice({ seed });
    await page.goto(base + '/shows/');
    await page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });

    const texts = await ratings(page, SHOWS_RATING);
    check('a 3-day-old finished entry is still fresh (7d TTL)', texts['Alpha Anime'] === '80%', JSON.stringify(texts));
    check('a stale airing entry still shows its cached score', texts['Beta Show'] === '55%', JSON.stringify(texts));

    // Refreshing must not blank the badge: record every value it takes.
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.sp-shows-rating')].find((r) => r.dataset.normalizedTitle === 'Beta Show');
      window.__seen = [el.textContent];
      new MutationObserver(() => window.__seen.push(el.textContent))
        .observe(el, { childList: true, characterData: true, subtree: true });
      el.click();
    });
    await page.waitForTimeout(2500);
    const seen = await page.evaluate(() => window.__seen);
    check('a background refresh never blanks the score to "…"', !seen.includes('…'), JSON.stringify(seen));
    check('the refresh lands on a score', /%$/.test(seen[seen.length - 1] || ''), JSON.stringify(seen));

    check('no page errors', errors.length === 0, errors.join(' | '));
  },
};
