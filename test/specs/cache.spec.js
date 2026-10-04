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

    // --- The cache must stay bounded: localStorage has a hard quota ---
    const bulkSeed = `
      const now = Date.now();
      const big = {};
      for (let i = 0; i < 3100; i++) big['Filler ' + i] = { score: 70, status: 'FINISHED', timestamp: now - i * 1000 };
      big['Ancient'] = { score: 70, status: 'FINISHED', timestamp: now - 200 * ${DAY} };
      localStorage.setItem('ratingCache', JSON.stringify(big));`;
    const bulk = await newDevice({ seed: bulkSeed });
    await bulk.page.goto(base + '/shows/');
    await bulk.page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });
    await bulk.page.click('.sp-shows-fetch-btn:has-text("Fetch all ratings")');
    await bulk.page.waitForFunction(
      () => [...document.querySelectorAll('.sp-shows-rating')].some((r) => /%$/.test(r.textContent)),
      { timeout: 15000 });
    await bulk.page.waitForTimeout(500);

    const after = await bulk.page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem('ratingCache') || '{}');
      return { count: Object.keys(c).length, hasAncient: 'Ancient' in c, keptNewest: 'Filler 0' in c };
    });
    check('the cache is capped on write', after.count <= 3000, `entries=${after.count}`);
    check('entries far past their TTL are dropped', after.hasAncient === false);
    check('the newest entries are the ones kept', after.keptNewest === true);

    // --- A full quota must be visible, not silent ---
    const quota = await newDevice({
      seed: `
        const realSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === 'ratingCache') { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
          return realSet.call(this, k, v);
        };`,
    });
    await quota.page.goto(base + '/shows/');
    await quota.page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });
    await quota.page.click('.sp-shows-fetch-btn:has-text("Fetch all ratings")');
    await quota.page.waitForFunction(
      () => document.querySelector('.sp-toast')?.textContent.includes('storage is full'),
      { timeout: 15000 }).catch(() => {});
    const toast = await quota.page.evaluate(() => document.querySelector('.sp-toast')?.textContent || '');
    check('a full quota is reported to the user', toast.includes('storage is full'), `toast="${toast}"`);
    check('ratings still render when the cache cannot be written',
      await quota.page.evaluate(() => [...document.querySelectorAll('.sp-shows-rating')].some((r) => /%$/.test(r.textContent))));
  },
};
