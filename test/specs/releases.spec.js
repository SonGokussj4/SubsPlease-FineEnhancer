/* The releases listing: thumbnails, batched rating fetches, favorites, toast. */
const { ratings, RELEASE_RATING } = require('../lib/env');

module.exports = {
  name: 'releases page',
  async run({ check, base, state, newDevice }) {
    state.anilistRequests = [];
    const { page, errors } = await newDevice();
    await page.goto(base + '/');
    await page.waitForSelector('.sp-img-wrapper', { timeout: 10000 });

    check('thumbnails built for every row', (await page.$$('.sp-img-wrapper')).length === 3);

    await page.waitForFunction(
      () => [...document.querySelectorAll('.sp-title span[data-normalized-title]')].every((s) => s.textContent !== '…'),
      { timeout: 20000 }).catch(() => {});
    const texts = await ratings(page, RELEASE_RATING);
    check('every rating resolves', Object.values(texts).every((t) => t && t !== '…'), JSON.stringify(texts));

    // Regression: addImages() used to fetch per row, firing ~20 parallel
    // requests on load and tripping AniList's rate limit.
    const maxAliases = Math.max(...state.anilistRequests.map((r) => Object.keys(r.variables).length), 0);
    check('fetches are batched, not one per row',
      state.anilistRequests.length <= 2 && maxAliases > 1,
      `requests=${state.anilistRequests.length} maxAliases=${maxAliases}`);

    check('status pill is rendered', !!(await page.$('.sp-toast')));

    // Favorites
    const title = await page.$eval('.sp-favorite-star', (el) => el.dataset.normalizedTitle);
    await page.click('.sp-favorite-star');
    check('star fills in when favorited', await page.$eval('.sp-favorite-star', (el) => el.innerHTML === '★'));
    check('row is highlighted when favorited', (await page.$$('.sp-favorite')).length > 0);
    await page.click('.sp-favorite-star');
    check('star empties again when unfavorited', await page.$eval('.sp-favorite-star', (el) => el.innerHTML === '☆'));
    check('favorite key is the normalized title', !!title && !/\d+$/.test(title), title);

    // Schedule widget shares the favorites store
    check('schedule rows get their own stars', (await page.$$('.sp-schedule-favorite-star')).length === 2);

    check('no page errors', errors.length === 0, errors.join(' | '));
  },
};
