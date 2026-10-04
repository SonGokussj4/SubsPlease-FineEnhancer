/* Shared test environment: a fake subsplease.org, a fake AniList GraphQL
 * endpoint and a fake GitHub Gist API, plus Tampermonkey (GM_*) stubs so the
 * real userscript runs unmodified inside Chromium. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPT_PATH = path.join(REPO, 'src', 'subsplease-fine-enhancer.user.js');
const readScript = () => fs.readFileSync(SCRIPT_PATH, 'utf8');

const RELEASES_HTML = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><title>SubsPlease</title></head><body>
<table id="schedule-table"><tbody>
<tr class="schedule-widget-item"><td class="schedule-widget-show"><a href="/shows/alpha/">Alpha Anime</a></td><td>13:30</td></tr>
<tr class="schedule-widget-item"><td class="schedule-widget-show"><a href="/shows/beta/">Beta Show</a></td><td>15:00</td></tr>
</tbody></table>
<table id="releases-table"><tbody>
<tr><td class="release-item-time">12:00</td><td><a href="/shows/alpha/" data-preview-image="/img/a.jpg">Alpha Anime — 05</a><div class="badge-wrapper">1080p</div></td></tr>
<tr><td class="release-item-time">11:00</td><td><a href="/shows/beta/" data-preview-image="/img/b.jpg">Beta Show — 12v2</a></td></tr>
<tr><td class="release-item-time">10:00</td><td><a href="/shows/bb/" data-preview-image="/img/c.jpg">Blue Box S2 — 03</a></td></tr>
</tbody></table></body></html>`;

const SHOWS_HTML = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><title>shows</title></head><body>
<div class="all-shows">
<h3>A</h3>
<div><a href="/shows/alpha/" title="Alpha Anime">Alpha Anime</a></div>
<div><a href="/shows/aoi/" title="Aoi Hana">Aoi Hana</a></div>
<h3>B</h3>
<div><a href="/shows/beta/" title="Beta Show">Beta Show</a></div>
<div><a href="/shows/bb/" title="Blue Box S2">Blue Box S2</a></div>
</div></body></html>`;

const sendJson = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

/** Default AniList answer for a search term, so specs share one fixture:
 *   "Aoi …"  -> no match at all (a genuine miss)
 *   "Beta …" -> only meanScore (freshly airing, no averageScore yet)
 *   anything else -> a score derived from the title length
 *   a numeric variable (an id-pinned override) -> a fixed match */
function defaultMedia(value, index) {
  if (typeof value === 'number') return { id: value, averageScore: 72, meanScore: 71, status: 'RELEASING' };
  if (value.startsWith('Aoi')) return null;
  if (value.startsWith('Beta')) return { id: 900 + index, averageScore: null, meanScore: 65, status: 'RELEASING' };
  return { id: 900 + index, averageScore: 60 + (value.length % 40), meanScore: 50, status: 'FINISHED' };
}

/** Start the fake backend. `state` lets a spec inject failures. */
async function startServer() {
  const state = {
    anilistRequests: [],
    gists: {},
    gistCounter: 0,
    maxAliases: Infinity,   // emulate AniList's query-complexity limit
    rateLimitOnce: false,   // next AniList call answers 429 (Retry-After: 1)
    partialErrorOnce: false,// next AniList call answers HTTP 200 + errors[]
    media: defaultMedia,
    searchResults: [
      { id: 101, title: { romaji: 'Tomb Raider King', english: 'Tomb Raider King', native: '盗掘王' },
        format: 'TV', status: 'RELEASING', seasonYear: 2026, averageScore: 72, meanScore: 71 },
      { id: 102, title: { romaji: 'Another Show', english: null, native: null },
        format: 'TV', status: 'FINISHED', seasonYear: 2024, averageScore: 60, meanScore: 60 },
    ],
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(RELEASES_HTML);
    }
    if (p === '/shows/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(SHOWS_HTML);
    }

    if (p === '/fake/anilist') {
      const body = JSON.parse(await readBody(req));
      state.anilistRequests.push(body);

      if (/Page\(perPage/.test(body.query || '')) {
        return sendJson(res, 200, { data: { Page: { media: state.searchResults } } });
      }
      if (state.rateLimitOnce) {
        state.rateLimitOnce = false;
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' });
        return res.end(JSON.stringify({ errors: [{ message: 'Too Many Requests.' }], data: null }));
      }
      if (Object.keys(body.variables).length > state.maxAliases) {
        return sendJson(res, 400, { errors: [{ message: 'Max query complexity of 500 exceeded.' }], data: null });
      }
      if (state.partialErrorOnce) {
        state.partialErrorOnce = false;
        const d = {};
        Object.keys(body.variables).forEach((k) => { d[`m${k.slice(1)}`] = { id: null, averageScore: null, meanScore: null, status: null }; });
        return sendJson(res, 200, { data: d, errors: [{ message: 'Internal partial error.' }] });
      }
      const data = {};
      Object.keys(body.variables).forEach((k) => {
        const i = k.slice(1);
        data[`m${i}`] = state.media(body.variables[k], Number(i));
      });
      return sendJson(res, 200, { data });
    }

    // AniList id -> AniDB id mapping service; "unknown" by default
    if (p.startsWith('/fake/arm')) return sendJson(res, 404, {});

    if (p.startsWith('/fake/gh/')) {
      const gp = p.slice('/fake/gh'.length);
      if (!(req.headers.authorization || '').includes('testtoken')) return sendJson(res, 401, { message: 'Bad credentials' });
      if (req.method === 'GET' && gp === '/gists') return sendJson(res, 200, Object.values(state.gists));
      if (req.method === 'POST' && gp === '/gists') {
        const body = JSON.parse(await readBody(req));
        const id = 'gist' + ++state.gistCounter;
        state.gists[id] = { id, files: body.files };
        return sendJson(res, 201, state.gists[id]);
      }
      const m = gp.match(/^\/gists\/(\w+)$/);
      if (m) {
        const g = state.gists[m[1]];
        if (!g) return sendJson(res, 404, { message: 'Not Found' });
        if (req.method === 'GET') return sendJson(res, 200, g);
        if (req.method === 'PATCH') { Object.assign(g.files, JSON.parse(await readBody(req)).files); return sendJson(res, 200, g); }
      }
      return sendJson(res, 404, { message: 'Not Found' });
    }

    res.writeHead(204);
    res.end();
  });

  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;

  /** The sync gist's current contents, or null before the first sync. */
  state.remotePayload = () => {
    const g = Object.values(state.gists)[0];
    const file = g && g.files['subsplease-fineenhancer-sync.json'];
    return file ? JSON.parse(file.content) : null;
  };

  return { base, state, close: () => new Promise((r) => server.close(r)) };
}

/* Tampermonkey API stubs. Skipped in frames and wherever storage is blocked,
 * mirroring how the real script behaves when injected into sub-frames. */
const gmStub = (base) => `
  try { window.localStorage.getItem('x'); } catch (e) { window.__gmSkip = true; }
  if (window !== window.top) window.__gmSkip = true;
  if (!window.__gmSkip) {
    window.__gmMenu = [];
    window.__openedTabs = [];
    window.GM_getValue = (k, d) => { const v = localStorage.getItem('gm:' + k); return v === null ? d : JSON.parse(v); };
    window.GM_setValue = (k, v) => localStorage.setItem('gm:' + k, JSON.stringify(v));
    window.GM_deleteValue = (k) => localStorage.removeItem('gm:' + k);
    window.GM_registerMenuCommand = (name, fn) => window.__gmMenu.push({ name, fn });
    window.GM_addStyle = () => {};
    window.GM_openInTab = (u) => window.__openedTabs.push(u);
    window.GM_xmlhttpRequest = (opts) => {
      let url = opts.url;
      if (url.includes('graphql.anilist.co')) url = '${base}/fake/anilist';
      else if (url.includes('arm.haglund.dev')) url = '${base}/fake/arm';
      else if (url.includes('api.github.com')) url = '${base}/fake/gh' + new URL(opts.url).pathname + (new URL(opts.url).search || '');
      fetch(url, { method: opts.method || 'GET', headers: opts.headers, body: opts.data })
        .then(async (r) => {
          let h = ''; r.headers.forEach((v, k) => { h += k + ': ' + v + '\\r\\n'; });
          opts.onload && opts.onload({ status: r.status, responseText: await r.text(), responseHeaders: h });
        })
        .catch((e) => opts.onerror && opts.onerror(e));
    };
  }
`;

const wrapScript = (script) => `
  if (!window.__gmSkip) {
    const run = () => {
      try { (function () { ${script} })(); }
      catch (e) { console.error('USERSCRIPT ERROR: ' + e.message + '\\n' + e.stack); }
    };
    if (document.documentElement) run();
    else new MutationObserver((m, o) => { if (document.documentElement) { o.disconnect(); run(); } }).observe(document, { childList: true });
  }
`;

/** A fresh browser context ("device") with the userscript installed.
 * `seed` runs before the script, for pre-populating localStorage. */
async function newDevice(browser, base, { token, seed } = {}) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(gmStub(base));
  if (token) await ctx.addInitScript(`try { localStorage.setItem('gm:spSyncToken', ${JSON.stringify(JSON.stringify(token))}); } catch (e) {}`);
  if (seed) await ctx.addInitScript(`try { ${seed} } catch (e) {}`);
  await ctx.addInitScript(wrapScript(readScript()));

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !t.includes('net::') && !t.includes('Failed to load resource')) errors.push(t);
  });
  return { ctx, page, errors };
}

/** Rating badge text keyed by normalized title. */
const ratings = (page, selector) => page.evaluate((s) => Object.fromEntries(
  [...document.querySelectorAll(s)].map((el) => [el.dataset.normalizedTitle, el.textContent])), selector);

const SHOWS_RATING = '.sp-shows-rating';
const RELEASE_RATING = '.sp-title span[data-normalized-title]';

module.exports = {
  REPO, SCRIPT_PATH, readScript, startServer, newDevice, ratings,
  SHOWS_RATING, RELEASE_RATING, defaultMedia,
};
