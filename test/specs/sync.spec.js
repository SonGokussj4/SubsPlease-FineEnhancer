/* Cross-device sync through a private GitHub Gist. */
module.exports = {
  name: 'gist sync',
  async run({ check, base, state, newDevice }) {
    // --- Device A: star a show, expect it pushed ---
    const A = await newDevice({ token: 'testtoken' });
    await A.page.goto(base + '/');
    await A.page.waitForSelector('.sp-favorite-star', { timeout: 10000 });
    const title = await A.page.$eval('.sp-favorite-star', (el) => el.dataset.normalizedTitle);
    await A.page.click('.sp-favorite-star');
    await A.page.waitForTimeout(5000);

    check('a gist is created on first sync', Object.keys(state.gists).length === 1);
    const remote = () => state.remotePayload();
    check('the favorite is pushed', !!remote().favorites[title]);
    check('ratings are not synced unless opted in', !remote().ratings, JSON.stringify(Object.keys(remote())));

    // --- Device B: a fresh browser sees it (the "work -> home" case) ---
    const B = await newDevice({ token: 'testtoken' });
    await B.page.goto(base + '/');
    await B.page.waitForSelector('.sp-favorite-star', { timeout: 10000 });
    await B.page.waitForFunction(
      (t) => [...document.querySelectorAll('.sp-favorite-star')].some((s) => s.dataset.normalizedTitle === t && s.innerHTML === '★'),
      title, { timeout: 15000 }).catch(() => {});
    check('the favorite arrives on a second device',
      await B.page.$$eval('.sp-favorite-star', (els, t) => els.find((s) => s.dataset.normalizedTitle === t)?.innerHTML === '★', title));

    // --- Unstarring propagates as a tombstone, not a silent drop ---
    await B.page.evaluate((t) => [...document.querySelectorAll('.sp-favorite-star')]
      .find((s) => s.dataset.normalizedTitle === t).click(), title);
    await B.page.waitForTimeout(5000);
    check('removal is pushed as a tombstone', remote().favorites[title]?.removed === true);

    await A.page.reload();
    await A.page.waitForSelector('.sp-favorite-star', { timeout: 10000 });
    await A.page.waitForFunction(
      (t) => [...document.querySelectorAll('.sp-favorite-star')].every((s) => s.dataset.normalizedTitle !== t || s.innerHTML === '☆'),
      title, { timeout: 15000 }).catch(() => {});
    check('the removal reaches the first device back',
      await A.page.$$eval('.sp-favorite-star', (els, t) => els.find((s) => s.dataset.normalizedTitle === t)?.innerHTML === '☆', title));

    // --- Opt-in ratings-cache sync ---
    const seedRatings = `
      localStorage.setItem('ratingCache', JSON.stringify({ 'Shared Show': { score: 88, status: 'FINISHED', timestamp: Date.now() } }));
      localStorage.setItem('spSettings', JSON.stringify({ syncRatings: { value: true, timestamp: Date.now() } }));`;
    const C = await newDevice({ token: 'testtoken', seed: seedRatings });
    await C.page.goto(base + '/shows/');
    await C.page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });
    await C.page.evaluate(() => window.__gmMenu.find((m) => m.name === 'Sync now').fn());
    await C.page.waitForTimeout(3000);
    check('opting in uploads the ratings cache', !!remote().ratings?.['Shared Show'],
      JSON.stringify(Object.keys(remote().ratings || {})));

    const D = await newDevice({
      token: 'testtoken',
      seed: `localStorage.setItem('spSettings', JSON.stringify({ syncRatings: { value: true, timestamp: Date.now() } }));`,
    });
    await D.page.goto(base + '/shows/');
    await D.page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });
    await D.page.evaluate(() => window.__gmMenu.find((m) => m.name === 'Sync now').fn());
    await D.page.waitForTimeout(3000);
    check('another device inherits those cached ratings',
      await D.page.evaluate(() => !!JSON.parse(localStorage.getItem('ratingCache') || '{}')['Shared Show']));

    // --- A bad token must not break the page ---
    const E = await newDevice({ token: 'wrongtoken' });
    await E.page.goto(base + '/');
    await E.page.waitForTimeout(3000);
    check('a rejected token leaves the page working', !!(await E.page.$('.sp-img-wrapper')));
  },
};
