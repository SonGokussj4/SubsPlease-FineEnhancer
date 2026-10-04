/* How the script behaves when AniList misbehaves. Each of these was a real bug
 * that showed up as ratings silently settling on N/A. */
const { ratings, SHOWS_RATING } = require('../lib/env');

module.exports = {
  name: 'AniList resilience',
  async run({ check, base, state, newDevice }) {
    // --- Query-complexity rejection: fall back to one-by-one, never cache the miss ---
    state.maxAliases = 2;
    state.anilistRequests = [];
    const A = await newDevice();
    await A.page.goto(base + '/shows/');
    await A.page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });
    await A.page.click('.sp-shows-fetch-btn:has-text("Fetch all ratings")');
    await A.page.waitForFunction(
      () => [...document.querySelectorAll('.sp-shows-rating')].filter((r) => /%$/.test(r.textContent)).length >= 3,
      { timeout: 25000 }).catch(() => {});
    const texts = await ratings(A.page, SHOWS_RATING);
    check('a rejected batch still resolves via single requests',
      /%$/.test(texts['Alpha Anime'] || '') && texts['Aoi Hana'] === 'N/A', JSON.stringify(texts));
    check('a rejected response is never cached as "not found"',
      await A.page.evaluate(() => typeof JSON.parse(localStorage.getItem('ratingCache') || '{}')['Alpha Anime']?.score === 'number'));
    state.maxAliases = Infinity;

    // --- HTTP 429: wait out Retry-After and retry ---
    state.rateLimitOnce = true;
    const B = await newDevice();
    await B.page.goto(base + '/shows/');
    await B.page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });
    await B.page.evaluate(() => [...document.querySelectorAll('.sp-shows-rating')]
      .find((r) => r.dataset.normalizedTitle === 'Alpha Anime').click());
    await B.page.waitForFunction(
      () => /%$/.test([...document.querySelectorAll('.sp-shows-rating')]
        .find((r) => r.dataset.normalizedTitle === 'Alpha Anime')?.textContent || ''),
      { timeout: 15000 }).catch(() => {});
    check('a 429 is retried after Retry-After', await B.page.evaluate(
      () => /%$/.test([...document.querySelectorAll('.sp-shows-rating')]
        .find((r) => r.dataset.normalizedTitle === 'Alpha Anime')?.textContent || '')));

    // --- HTTP 200 carrying a GraphQL errors[] is a failure, not a miss ---
    state.partialErrorOnce = true;
    const C = await newDevice();
    await C.page.goto(base + '/shows/');
    await C.page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });
    await C.page.click('.sp-shows-fetch-btn:has-text("Fetch all ratings")');
    await C.page.waitForFunction(
      () => [...document.querySelectorAll('.sp-shows-rating')].filter((r) => /%$/.test(r.textContent)).length >= 2,
      { timeout: 25000 }).catch(() => {});
    check('a 200 with errors[] is retried, not cached as N/A',
      await C.page.evaluate(() => typeof JSON.parse(localStorage.getItem('ratingCache') || '{}')['Alpha Anime']?.score === 'number'));

    // --- The queue must never wedge: it once stayed "running" after a throw ---
    const D = await newDevice();
    await D.page.goto(base + '/shows/');
    await D.page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });
    await D.page.evaluate(() => document.querySelectorAll('.sp-shows-rating')[0].click());
    await D.page.waitForTimeout(1500);
    state.anilistRequests = [];
    await D.page.evaluate(() => {
      localStorage.removeItem('ratingCache');
      document.querySelectorAll('.sp-shows-rating')[1].click();
    });
    await D.page.waitForTimeout(1500);
    check('the queue still accepts work after an earlier run', state.anilistRequests.length >= 1,
      `requests=${state.anilistRequests.length}`);
  },
};
