/* The /shows/ listing: toolbar, search, favorites filter, colour thresholds. */
const { ratings, SHOWS_RATING } = require('../lib/env');

const visibleItems = (page) =>
  page.$$eval('.sp-shows-item', (els) => els.filter((e) => e.style.display !== 'none').length);

module.exports = {
  name: 'shows page',
  async run({ check, base, state, newDevice }) {
    state.anilistRequests = [];
    const { page, errors } = await newDevice();
    await page.goto(base + '/shows/');
    await page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });

    check('toolbar has a search box', !!(await page.$('.sp-shows-search')));
    check('every show is wrapped', (await page.$$('.sp-shows-item')).length === 4);

    await page.click('.sp-shows-fetch-btn:has-text("Fetch all ratings")');
    await page.waitForFunction(
      () => [...document.querySelectorAll('.sp-shows-rating')].some((r) => /%$/.test(r.textContent)),
      { timeout: 15000 });
    await page.waitForTimeout(700);

    check('one batched request for the whole page', state.anilistRequests.length === 1, `requests=${state.anilistRequests.length}`);
    check('all four titles in that request', Object.keys(state.anilistRequests[0].variables).length === 4);
    check('season marker normalized for the query',
      Object.values(state.anilistRequests[0].variables).includes('Blue Box 2nd Season'));

    const texts = await ratings(page, SHOWS_RATING);
    check('a genuine miss shows N/A', texts['Aoi Hana'] === 'N/A', JSON.stringify(texts));
    check('meanScore is used when averageScore is absent', texts['Beta Show'] === '65%', JSON.stringify(texts));

    // Search filter
    await page.fill('.sp-shows-search', 'alpha');
    await page.waitForTimeout(400);
    check('search narrows the list', (await visibleItems(page)) === 1);
    check('emptied section heading is hidden',
      (await page.$$eval('.all-shows > h3', (els) => els.filter((e) => e.style.display === 'none').length)) === 1);
    await page.fill('.sp-shows-search', '');
    await page.waitForTimeout(400);
    check('clearing the search restores the list', (await visibleItems(page)) === 4);

    // Favorites-only toggle
    await page.evaluate(() => document.querySelectorAll('.sp-shows-star')[2].click());
    await page.click('.sp-shows-fetch-btn:has-text("Favorites only")');
    check('favorites-only shows just the starred show', (await visibleItems(page)) === 1);
    await page.click('.sp-shows-fetch-btn:has-text("Favorites only")');
    check('toggling it off restores the list', (await visibleItems(page)) === 4);

    // Settings dialog + colour thresholds
    await page.evaluate(() => window.__gmMenu.find((m) => m.name === 'Settings').fn());
    check('settings dialog opens', !!(await page.$('.sp-dialog')));
    check('dialog follows the site dark theme',
      (await page.$eval('.sp-dialog', (el) => getComputedStyle(el).backgroundColor)) === 'rgb(38, 38, 43)');
    check('sync section starts collapsed', await page.$eval('#sp-sync-details', (el) => !el.open));
    check('ratings-cache sync is off by default', await page.$eval('#sp-sync-ratings', (el) => el.checked === false));

    const colourOf = (t) => page.evaluate((n) =>
      [...document.querySelectorAll('.sp-shows-rating')].find((r) => r.dataset.normalizedTitle === n)?.style.color, t);
    const before = await colourOf('Beta Show');
    await page.fill('#sp-th-orange', '60');
    await page.click('#sp-save');
    const after = await colourOf('Beta Show');
    check('changing a threshold recolours existing ratings',
      before === 'rgb(204, 136, 0)' && after === 'rgb(0, 204, 102)', `${before} -> ${after}`);

    check('no page errors', errors.length === 0, errors.join(' | '));
  },
};
