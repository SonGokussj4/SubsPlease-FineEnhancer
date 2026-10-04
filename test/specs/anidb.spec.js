/* The AniDB badge: wordmark, colours and the search URL format. */
module.exports = {
  name: 'anidb badge',
  async run({ check, base, newDevice }) {
    const { page, errors } = await newDevice();
    await page.goto(base + '/');
    await page.waitForSelector('.sp-anidb-link', { timeout: 10000 });
    await page.waitForTimeout(1200);

    const info = await page.evaluate(() => {
      const a = document.querySelector('.sp-anidb-link');
      const ani = a.querySelector('.sp-anidb-ani');
      const db = a.querySelector('.sp-anidb-db');
      return {
        text: a.textContent,
        href: a.href,
        target: a.target,
        rel: a.rel,
        aniColor: ani && getComputedStyle(ani).color,
        dbColor: db && getComputedStyle(db).color,
        background: getComputedStyle(a).backgroundImage,
      };
    });

    check('the badge reads "aniDB"', info.text === 'aniDB', info.text);
    check('it links to the animedb.pl search endpoint',
      info.href.startsWith('https://anidb.net/perl-bin/animedb.pl?'), info.href);
    check('the query uses the expected parameters and "+" for spaces',
      info.href === 'https://anidb.net/perl-bin/animedb.pl?adb.search=Alpha+Anime&show=animelist&do.search=search', info.href);
    check('"ani" uses the light wordmark colour', info.aniColor === 'rgb(233, 238, 245)', info.aniColor);
    check('"DB" uses the AniDB orange', info.dbColor === 'rgb(243, 156, 33)', info.dbColor);
    check('the badge sits on the navy plate', info.background.includes('linear-gradient'), info.background);
    check('it opens in a new tab safely', info.target === '_blank' && info.rel.includes('noopener'), `${info.target} / ${info.rel}`);

    check('no page errors', errors.length === 0, errors.join(' | '));
  },
};
