/* Storage schema migrations.
 * Favorites, overrides and cached ratings are keyed by normalizeTitle(), so a
 * change to the parser must re-key existing data instead of orphaning it. */
module.exports = {
  name: 'schema migrations',
  async run({ check, base, state, newDevice }) {
    // Data written by an older script: keys still carry episode suffixes.
    const legacySeed = `
      const now = Date.now();
      localStorage.setItem('spFavorites', JSON.stringify({
        'Alpha Anime — 05': { originalTitle: 'Alpha Anime — 05', timestamp: now }
      }));
      localStorage.setItem('spSettings', JSON.stringify({
        titleOverrides: { value: { 'Aoi Hana — 03': { id: 101, title: 'Tomb Raider King' } }, timestamp: now }
      }));
      localStorage.setItem('ratingCache', JSON.stringify({
        'Alpha Anime — 05': { score: 77, status: 'FINISHED', timestamp: now }
      }));`;

    const A = await newDevice({ seed: legacySeed });
    await A.page.goto(base + '/shows/');
    await A.page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });
    await A.page.waitForTimeout(500);

    const migrated = await A.page.evaluate(() => ({
      favorites: Object.keys(JSON.parse(localStorage.getItem('spFavorites') || '{}')),
      overrides: Object.keys(JSON.parse(localStorage.getItem('spSettings') || '{}').titleOverrides?.value || {}),
      ratings: Object.keys(JSON.parse(localStorage.getItem('ratingCache') || '{}')),
      version: JSON.parse(localStorage.getItem('gm:spSchemaVersion') || 'null'),
    }));

    check('favorite keys are re-keyed', migrated.favorites.includes('Alpha Anime'), JSON.stringify(migrated.favorites));
    check('override keys are re-keyed', migrated.overrides.includes('Aoi Hana'), JSON.stringify(migrated.overrides));
    check('cached rating keys are re-keyed', migrated.ratings.includes('Alpha Anime'), JSON.stringify(migrated.ratings));
    check('the schema version is recorded', migrated.version === 1, String(migrated.version));

    // The migrated favorite must actually light up in the UI.
    check('the migrated favorite is recognised',
      await A.page.evaluate(() => [...document.querySelectorAll('.sp-shows-star')]
        .some((s) => s.dataset.normalizedTitle === 'Alpha Anime' && s.innerHTML === '★')));

    // A second load must not redo the work.
    await A.page.goto(base + '/shows/');
    await A.page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });
    check('migration is not re-applied once recorded',
      await A.page.evaluate(() => JSON.parse(localStorage.getItem('gm:spSchemaVersion') || 'null') === 1));

    // A fresh install has nothing to migrate but still gets stamped.
    const B = await newDevice();
    await B.page.goto(base + '/shows/');
    await B.page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });
    check('a fresh install is stamped with the current version',
      await B.page.evaluate(() => JSON.parse(localStorage.getItem('gm:spSchemaVersion') || 'null') === 1));

    // --- Sync: an old device must not push stale keys back ---
    const C = await newDevice({ token: 'testtoken' });
    await C.page.goto(base + '/shows/');
    await C.page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });
    await C.page.evaluate(() => document.querySelectorAll('.sp-shows-star')[0].click());
    await C.page.waitForTimeout(4000);

    const payload = state.remotePayload();
    check('the sync payload records its schema version', payload && payload.schemaVersion === 1,
      JSON.stringify(payload && payload.schemaVersion));

    // Simulate an older device overwriting the gist with unversioned, old-format keys.
    await C.page.evaluate(() => {}); // no-op, keeps the page alive
    const gist = Object.values(state.gists)[0];
    gist.files['subsplease-fineenhancer-sync.json'].content = JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      favorites: { 'Beta Show — 12v2': { originalTitle: 'Beta Show — 12v2', timestamp: Date.now() + 1000 } },
      settings: {},
    });

    const D = await newDevice({ token: 'testtoken' });
    await D.page.goto(base + '/shows/');
    await D.page.waitForSelector('.sp-shows-toolbar', { timeout: 10000 });
    await D.page.evaluate(() => window.__gmMenu.find((m) => m.name === 'Sync now').fn());
    await D.page.waitForTimeout(3500);

    const localFavs = await D.page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('spFavorites') || '{}')));
    check('old-format keys pulled from sync are migrated on arrival',
      localFavs.includes('Beta Show') && !localFavs.some((k) => k.includes('—')), JSON.stringify(localFavs));
    check('the migrated favorite shows up in the UI',
      await D.page.evaluate(() => [...document.querySelectorAll('.sp-shows-star')]
        .some((s) => s.dataset.normalizedTitle === 'Beta Show' && s.innerHTML === '★')));
  },
};
