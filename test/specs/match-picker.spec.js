/* The AniList match picker, used to fix titles AniList does not recognise. */
module.exports = {
  name: 'match picker',
  async run({ check, base, state, newDevice }) {
    const { page, errors } = await newDevice();
    await page.goto(base + '/shows/');
    await page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });
    await page.click('.sp-shows-fetch-btn:has-text("Fetch all ratings")');
    await page.waitForFunction(
      () => [...document.querySelectorAll('.sp-shows-rating')].some((r) => r.textContent === 'N/A'),
      { timeout: 15000 });

    check('a genuine miss offers the fix button', (await page.$$('.sp-fix-btn')).length === 1);

    state.anilistRequests = [];
    await page.click('.sp-fix-btn');
    await page.waitForSelector('.sp-match', { timeout: 10000 });
    check('the picker lists AniList candidates', (await page.$$('.sp-match')).length === 2);
    check('candidates show a title', (await page.$eval('.sp-match-title', (el) => el.textContent)) === 'Tomb Raider King');

    await page.click('.sp-match');
    await page.waitForFunction(
      () => /%$/.test([...document.querySelectorAll('.sp-shows-rating')]
        .find((r) => r.dataset.normalizedTitle === 'Aoi Hana')?.textContent || ''),
      { timeout: 10000 }).catch(() => {});

    const resolved = await page.evaluate(() => [...document.querySelectorAll('.sp-shows-rating')]
      .find((r) => r.dataset.normalizedTitle === 'Aoi Hana')?.textContent);
    check('picking a match resolves the rating', resolved === '72%', `got ${resolved}`);
    check('the pinned match is queried by AniList id',
      state.anilistRequests.some((r) => Object.values(r.variables).includes(101)),
      JSON.stringify(state.anilistRequests.map((r) => r.variables)));

    const override = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('spSettings') || '{}').titleOverrides?.value?.['Aoi Hana']);
    check('the override stores the id, not just text', override && override.id === 101, JSON.stringify(override));
    check('the fix button disappears once resolved', (await page.$$('.sp-fix-btn')).length === 0);

    check('no page errors', errors.length === 0, errors.join(' | '));
  },
};
