// ==UserScript==
// @name         SubsPlease Fine Enhancer
// @namespace    https://github.com/SonGokussj4/tampermonkey-subsplease-FineEnhancer
// @version      1.6.3
// @description  Adds image previews and AniList ratings to SubsPlease release listings. Click ratings to refresh. Settings via menu commands. Manage favorites with visual highlights, filter/search on /shows/, and sync favorites + settings across devices via a private GitHub Gist.
// @author       SonGokussj4
// @license      MIT
// @match        https://subsplease.org/*
// @grant        GM_xmlhttpRequest
// @connect      graphql.anilist.co
// @connect      api.github.com
// @connect      gist.githubusercontent.com
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

/* ------------------------------------------------------------------
 * CONFIG & CONSTANTS
 * ---------------------------------------------------------------- */
const DEBOUNCE_TIMER = 300; // ms
const CACHE_KEY = 'ratingCache';
const FAVORITES_KEY = 'spFavorites';
const SETTINGS_KEY = 'spSettings';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const SHOWS_ANY_LINK_SELECTOR = 'a[href^="/shows/"][title]';
const SHOWS_LINK_SELECTOR = 'a[href^="/shows/"][title]:not(.sp-shows-processed)';
const SHOWS_HEADING_SELECTOR = 'h3';
const ANILIST_BATCH_SIZE = 5; // titles per GraphQL request (larger batches can trip AniList's query complexity limit; rejected batches auto-split)
const ANILIST_BATCH_DELAY_MS = 1200; // pause between batched requests
const SYNC_FILENAME = 'subsplease-fineenhancer-sync.json';
const SYNC_TOKEN_KEY = 'spSyncToken';
const SYNC_GIST_ID_KEY = 'spSyncGistId';
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // keep deletion markers 90 days

// Menu commands for quick settings
GM_registerMenuCommand('Settings', showSettingsDialog);
GM_registerMenuCommand('Sync now', () => syncNow(true));

/* ------------------------------------------------------------------
 * UTILITY FUNCTIONS
 * ---------------------------------------------------------------- */

/** Simple debounce wrapper */
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/** Normalize anime title:
 * - Remove episode markers like "— 01" / "- 03"
 * - Remove episode ranges like "— 01-24"
 * - Remove version markers like "— 01v2"
 * - Remove "(Batch)" or other bracketed notes at the end
 */
function normalizeTitle(raw) {
  return raw
    .replace(/\s*\(Batch\)$/i, '') // remove "(Batch)" suffix
    .replace(/\s*[–—-]\s*\d+(?:[vV]\d+)?(?:\s*-\s*\d+(?:[vV]\d+)?)?$/i, '')
    .replace(/\s+S(\d+)$/i, (_, n) => {
      const i = parseInt(n, 10);
      const sfx = [, 'st', 'nd', 'rd'][i] ?? 'th';
      return ` ${i}${sfx} Season`;
    })
    .trim();
}

/** Convert milliseconds → "Xh Ym" */
function msToTime(ms) {
  let totalSeconds = Math.floor(ms / 1000);
  let hours = Math.floor(totalSeconds / 3600);
  let minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

/** Normalize CSS size input into "NNpx" */
function normalizeSize(raw) {
  if (typeof raw === 'number') return raw + 'px';
  if (typeof raw === 'string') {
    raw = raw.trim();
    if (/^\d+$/.test(raw)) return raw + 'px';
    if (/^\d+px$/.test(raw)) return raw;
  }
  return '64px';
}

/** User-configurable score thresholds: ≤gray → gray, ≤red → red,
 * ≤orange → orange, above → green */
const DEFAULT_RATING_THRESHOLDS = { gray: 39, red: 49, orange: 74 };

function getRatingThresholds() {
  const t = getSetting('ratingColors', null) || {};
  return {
    gray: Number.isFinite(+t.gray) ? +t.gray : DEFAULT_RATING_THRESHOLDS.gray,
    red: Number.isFinite(+t.red) ? +t.red : DEFAULT_RATING_THRESHOLDS.red,
    orange: Number.isFinite(+t.orange) ? +t.orange : DEFAULT_RATING_THRESHOLDS.orange,
  };
}

/** Return a color for a given AniList score (0–100) */
function getRatingColor(score) {
  if (typeof score !== 'number') return '#999';
  const t = getRatingThresholds();
  if (score <= t.gray) return '#888888';
  if (score <= t.red) return '#cc4444';
  if (score <= t.orange) return '#cc8800';
  return '#00cc66';
}

/* ------------------------------------------------------------------
 * RATING CACHE (in-memory copy, write-through to localStorage)
 * ---------------------------------------------------------------- */

let _ratingCacheMem = null;

function readRatingCache() {
  if (_ratingCacheMem) return _ratingCacheMem;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    _ratingCacheMem = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('Failed to parse rating cache, clearing it.', e);
    localStorage.removeItem(CACHE_KEY);
    _ratingCacheMem = {};
  }
  return _ratingCacheMem;
}

function writeRatingCache(cache) {
  _ratingCacheMem = cache;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.error('Failed to write rating cache.', e);
  }
}

/* ------------------------------------------------------------------
 * SETTINGS (synced, timestamped)
 * ---------------------------------------------------------------- */

function getSettingsRaw() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (e) {
    console.error('Failed to parse settings:', e);
  }
  // Migrate legacy imageSize stored in GM values
  const legacy = normalizeSize(GM_getValue('imageSize', '64px'));
  return { imageSize: { value: legacy, timestamp: 0 } };
}

function saveSettingsRaw(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

function getSetting(name, def) {
  const s = getSettingsRaw();
  return s[name]?.value ?? def;
}

function setSetting(name, value) {
  const s = getSettingsRaw();
  s[name] = { value, timestamp: Date.now() };
  saveSettingsRaw(s);
  scheduleSync();
}

function applySettingsSideEffects() {
  const thumbSize = normalizeSize(getSetting('imageSize', '64px'));
  document.documentElement.style.setProperty('--sp-thumb-size', thumbSize);
  // Color thresholds may have changed (e.g. synced from another device)
  if (typeof rerenderAllRatings === 'function') rerenderAllRatings();
}

/* ------------------------------------------------------------------
 * ELEMENT REGISTRY (favorites/ratings visuals)
 * ---------------------------------------------------------------- */

const mediaRegistry = new Map();
const ratingFetches = new Map();

function getMediaEntry(normalizedTitle) {
  let entry = mediaRegistry.get(normalizedTitle);
  if (!entry) {
    entry = {
      releaseWrappers: new Set(),
      releaseStars: new Set(),
      ratingSpans: new Set(),
      scheduleRows: new Set(),
      scheduleStars: new Set(),
      showsWrappers: new Set(),
      showsStars: new Set(),
      primaryTitle: null,
    };
    mediaRegistry.set(normalizedTitle, entry);
  }
  return entry;
}

function pruneDisconnected(set) {
  for (const node of set) {
    if (!node.isConnected) {
      set.delete(node);
    }
  }
}

function styleStar(star, isFav) {
  star.innerHTML = isFav ? '★' : '☆';
  star.style.color = isFav ? '#ffd700' : '#666';
  star.title = isFav ? 'Click to remove favorite' : 'Click to add favorite';
}

function applyFavoriteVisuals(normalizedTitle, isFav) {
  const entry = getMediaEntry(normalizedTitle);

  pruneDisconnected(entry.releaseWrappers);
  for (const wrapper of entry.releaseWrappers) {
    wrapper.classList.toggle('sp-favorite', isFav);
  }

  pruneDisconnected(entry.releaseStars);
  for (const star of entry.releaseStars) styleStar(star, isFav);

  pruneDisconnected(entry.scheduleRows);
  for (const row of entry.scheduleRows) {
    row.classList.toggle('sp-schedule-favorite', isFav);
  }

  pruneDisconnected(entry.scheduleStars);
  for (const star of entry.scheduleStars) styleStar(star, isFav);

  pruneDisconnected(entry.showsWrappers);
  for (const wrapper of entry.showsWrappers) {
    wrapper.classList.toggle('sp-shows-favorite', isFav);
  }

  pruneDisconnected(entry.showsStars);
  for (const star of entry.showsStars) styleStar(star, isFav);
}

function refreshFavoriteVisuals(normalizedTitle) {
  const favorites = getFavorites();
  const isFav = !!favorites[normalizedTitle];
  applyFavoriteVisuals(normalizedTitle, isFav);
  return isFav;
}

function registerReleaseElements(normalizedTitle, { wrapper, star, ratingSpan, originalTitle }) {
  const entry = getMediaEntry(normalizedTitle);
  if (wrapper) entry.releaseWrappers.add(wrapper);
  if (star) entry.releaseStars.add(star);
  if (ratingSpan) entry.ratingSpans.add(ratingSpan);
  if (originalTitle && !entry.primaryTitle) entry.primaryTitle = originalTitle;
  refreshFavoriteVisuals(normalizedTitle);
}

function registerScheduleElements(normalizedTitle, { row, star, originalTitle }) {
  const entry = getMediaEntry(normalizedTitle);
  if (row) entry.scheduleRows.add(row);
  if (star) entry.scheduleStars.add(star);
  if (originalTitle && !entry.primaryTitle) entry.primaryTitle = originalTitle;
  refreshFavoriteVisuals(normalizedTitle);
}

function registerShowsElements(normalizedTitle, { wrapper, star, ratingSpan, originalTitle }) {
  const entry = getMediaEntry(normalizedTitle);
  if (wrapper) entry.showsWrappers.add(wrapper);
  if (star) entry.showsStars.add(star);
  if (ratingSpan) entry.ratingSpans.add(ratingSpan);
  if (originalTitle && !entry.primaryTitle) entry.primaryTitle = originalTitle;
  refreshFavoriteVisuals(normalizedTitle);
}

/* ------------------------------------------------------------------
 * FAVORITES MANAGEMENT
 * ---------------------------------------------------------------- */

/** Get all favorite records, including deletion tombstones (for sync) */
function getFavoritesRaw() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('Failed to parse favorites:', e);
    return {};
  }
}

function saveFavoritesRaw(favorites) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch (e) {
    console.error('Failed to save favorites:', e);
  }
}

/** Get active (non-deleted) favorites */
function getFavorites() {
  const raw = getFavoritesRaw();
  const active = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (entry && !entry.removed) active[key] = entry;
  }
  return active;
}

/** Check if a show is favorited */
function isFavorite(title) {
  const entry = getFavoritesRaw()[normalizeTitle(title)];
  return !!entry && !entry.removed;
}

/** Toggle favorite status of a show. Deletions become timestamped
 * tombstones so they merge correctly across synced devices. */
function toggleFavorite(title) {
  const normalizedTitle = normalizeTitle(title);
  const favorites = getFavoritesRaw();
  const current = favorites[normalizedTitle];
  let isFav;

  if (current && !current.removed) {
    favorites[normalizedTitle] = {
      originalTitle: current.originalTitle || title,
      removed: true,
      timestamp: Date.now(),
    };
    isFav = false;
  } else {
    favorites[normalizedTitle] = {
      originalTitle: title,
      timestamp: Date.now(),
    };
    isFav = true;
  }

  saveFavoritesRaw(favorites);
  applyFavoriteVisuals(normalizedTitle, isFav);
  applyShowsFilter();
  scheduleSync();
  return isFav;
}

/** Clear all favorites (as tombstones, so the clear also syncs) */
function clearAllFavorites() {
  if (!confirm('Are you sure you want to clear all favorites? This cannot be undone.')) return;
  const favorites = getFavoritesRaw();
  const now = Date.now();
  for (const [key, entry] of Object.entries(favorites)) {
    if (entry && !entry.removed) {
      favorites[key] = { originalTitle: entry.originalTitle, removed: true, timestamp: now };
      applyFavoriteVisuals(key, false);
    }
  }
  saveFavoritesRaw(favorites);
  applyShowsFilter();
  scheduleSync();
}

/** Add favorite star to the time column */
function addFavoriteStar(cell, titleText, normalizedTitle) {
  // Find the table row and the time cell
  const row = cell.closest('tr');
  if (!row) return;

  const timeCell = row.querySelector('.release-item-time');
  if (!timeCell) return;

  // Create favorite star
  const favoriteSpan = document.createElement('span');
  favoriteSpan.className = 'sp-favorite-star';
  favoriteSpan.style.cursor = 'pointer';
  favoriteSpan.style.userSelect = 'none';
  favoriteSpan.innerHTML = '☆';
  favoriteSpan.style.color = '#666';
  favoriteSpan.title = 'Click to toggle favorite';
  favoriteSpan.dataset.title = titleText;
  favoriteSpan.dataset.normalizedTitle = normalizedTitle;

  favoriteSpan.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(titleText);
  });

  // Position the star at the top-right of the time cell
  timeCell.style.position = 'relative';
  timeCell.appendChild(favoriteSpan);

  return favoriteSpan;
}

/* ------------------------------------------------------------------
 * ANILIST FETCH + CACHE
 * ---------------------------------------------------------------- */

/** Perform AniList GraphQL request */
function gmFetchAniList(query, variables) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'POST',
      url: 'https://graphql.anilist.co',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      data: JSON.stringify({ query, variables }),
      onload: (response) => {
        try {
          resolve({ status: response.status, json: JSON.parse(response.responseText) });
        } catch (e) {
          reject(e);
        }
      },
      onerror: reject,
    });
  });
}

function ratingResultFromCacheEntry(entry) {
  const timestamp = entry?.timestamp ?? 0;
  const stale = Date.now() - timestamp >= CACHE_TTL_MS;
  return {
    score: entry && Object.prototype.hasOwnProperty.call(entry, 'score') ? entry.score : null,
    cached: true,
    stale,
    timestamp,
    expires: timestamp + CACHE_TTL_MS,
  };
}

/** Fetch AniList ratings for several titles in ONE GraphQL request
 * (aliased Media fields). items: [{ normalizedTitle, sourceTitle }].
 * Returns Map normalizedTitle → rating result. */
async function fetchAniListRatingsBatch(items) {
  const now = Date.now();
  const results = new Map();
  if (!items.length) return results;

  const params = items.map((_, i) => `$s${i}: String`).join(', ');
  const fields = items.map((_, i) => `m${i}: Media(search: $s${i}, type: ANIME) { averageScore meanScore }`).join('\n');
  const query = `query (${params}) {\n${fields}\n}`;
  const overrides = getSetting('titleOverrides', {}) || {};
  const variables = {};
  items.forEach((it, i) => {
    variables[`s${i}`] = overrides[it.normalizedTitle] || it.normalizedTitle;
  });

  try {
    console.log(`AniList: fetching ${items.length} rating(s) in one request`);
    const { status, json } = await gmFetchAniList(query, variables);

    // A whole-request rejection (complexity limit, rate limit, server error)
    // comes back with data missing/null. Never cache that as "not found" —
    // split the batch until it fits, or fail the single item visibly.
    if (!json?.data || status === 429 || status >= 500) {
      const msg = json?.errors?.map((e) => e.message).join('; ') || `HTTP ${status}`;
      if (items.length > 1) {
        console.warn(`AniList rejected a batch of ${items.length} (${msg}) — splitting in half`);
        const mid = Math.ceil(items.length / 2);
        const first = await fetchAniListRatingsBatch(items.slice(0, mid));
        await new Promise((r) => setTimeout(r, ANILIST_BATCH_DELAY_MS));
        const second = await fetchAniListRatingsBatch(items.slice(mid));
        return new Map([...first, ...second]);
      }
      throw new Error(`AniList request failed: ${msg}`);
    }

    const cache = readRatingCache();
    items.forEach((it, i) => {
      // averageScore appears only after enough votes; fall back to meanScore
      // so freshly airing shows get a rating instead of N/A.
      // A null alias alongside a valid data object is a real "not found".
      const media = json.data[`m${i}`];
      const score = media?.averageScore ?? media?.meanScore ?? null;
      cache[it.normalizedTitle] = { score, timestamp: now };
      results.set(it.normalizedTitle, {
        score,
        cached: false,
        stale: false,
        timestamp: now,
        expires: now + CACHE_TTL_MS,
      });
    });
    writeRatingCache(cache);
  } catch (err) {
    console.error('AniList batch fetch failed:', err);
    const cache = readRatingCache();
    items.forEach((it) => {
      const entry = cache[it.normalizedTitle];
      const fallback = entry
        ? { ...ratingResultFromCacheEntry(entry), failed: true }
        : { score: null, cached: false, stale: false, timestamp: now, expires: now + CACHE_TTL_MS, failed: true };
      results.set(it.normalizedTitle, fallback);
    });
  }
  return results;
}

/** Fetch a single AniList rating, with caching (6h TTL) */
async function fetchAniListRating(title, forceRefresh = false) {
  const cleanTitle = normalizeTitle(title);
  const entry = readRatingCache()[cleanTitle];

  if (entry && !forceRefresh) {
    return ratingResultFromCacheEntry(entry);
  }

  const results = await fetchAniListRatingsBatch([{ normalizedTitle: cleanTitle, sourceTitle: title }]);
  return results.get(cleanTitle);
}

/* ------------------------------------------------------------------
 * RATING BADGE HANDLING
 * ---------------------------------------------------------------- */

function getCachedRatingData(normalizedTitle) {
  const entry = readRatingCache()[normalizedTitle];
  if (!entry) return null;
  return { ...ratingResultFromCacheEntry(entry), failed: false };
}

function renderRatingSpan(span, data) {
  if (!span || !span.isConnected) return;

  if (data.loading) {
    span.textContent = '…';
    span.style.color = '#999';
    span.title = data.message || 'Loading rating…';
    return;
  }

  const hasScore = typeof data.score === 'number';

  if (!hasScore) {
    span.textContent = 'N/A';
    span.style.color = '#999';

    if (data.failed) {
      span.title = 'Connection error — click to retry';
    } else if (data.cached && data.stale) {
      const age = Date.now() - (data.timestamp ?? Date.now());
      span.title = `Not found on AniList (${msToTime(age)} old)\nRefreshing… Click to force refresh`;
    } else {
      span.title = 'Not found on AniList — click to retry';
    }
    span.title += '\nRight-click: set a custom AniList search title';
    return;
  }

  span.textContent = `${data.score}%`;
  span.style.color = getRatingColor(data.score);

  if (!data.cached) {
    span.title = data.failed ? 'AniList fetch failed\nClick to retry' : 'Fresh from AniList\nClick to refresh';
    return;
  }

  const now = Date.now();
  const ageMs = now - (data.timestamp ?? now);

  if (data.stale) {
    span.title = data.failed
      ? `Refresh failed — showing cached rating\nClick to retry`
      : `Using cached rating (${msToTime(ageMs)} old)\nRefreshing… Click to force refresh`;
    return;
  }

  const remaining = Math.max(0, (data.expires ?? data.timestamp + CACHE_TTL_MS) - now);
  span.title = data.failed
    ? `Refresh failed — showing cached (expires in ${msToTime(remaining)})\nClick to retry`
    : `Loaded from cache (expires in ${msToTime(remaining)})\nClick to refresh`;
}

/** Re-render every known rating badge from cache (e.g. after the color
 * thresholds change) */
function rerenderAllRatings() {
  for (const key of mediaRegistry.keys()) {
    const data = getCachedRatingData(key);
    if (data) renderRatingForTitle(key, data);
  }
}

/** Ask for a custom AniList search title for shows whose SubsPlease
 * romanization AniList doesn't know (e.g. Korean series). Synced. */
function promptTitleOverride(normalizedTitle) {
  const overrides = { ...(getSetting('titleOverrides', {}) || {}) };
  const current = overrides[normalizedTitle] || '';
  const input = prompt(
    `Custom AniList search title for:\n"${normalizedTitle}"\n\nUseful when AniList uses a different romanization (e.g. Korean shows).\nLeave empty to remove the override.`,
    current,
  );
  if (input === null) return;
  const trimmed = input.trim();
  if (trimmed) {
    overrides[normalizedTitle] = trimmed;
  } else {
    delete overrides[normalizedTitle];
  }
  setSetting('titleOverrides', overrides);

  const cache = readRatingCache();
  delete cache[normalizedTitle];
  writeRatingCache(cache);
  ensureRatingForTitle(normalizedTitle, null, true);
}

function attachRatingSpanHandlers(span, normalizedTitle) {
  span.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    promptTitleOverride(normalizedTitle);
  });
}

function renderRatingForTitle(normalizedTitle, data) {
  const entry = getMediaEntry(normalizedTitle);
  pruneDisconnected(entry.ratingSpans);
  for (const span of entry.ratingSpans) {
    renderRatingSpan(span, data);
  }
}

function setRefreshingState(normalizedTitle) {
  const entry = getMediaEntry(normalizedTitle);
  pruneDisconnected(entry.ratingSpans);
  for (const span of entry.ratingSpans) {
    span.title = 'Refreshing rating…';
  }
}

function ensureRatingForTitle(normalizedTitle, originalTitle, force = false) {
  const cachedData = getCachedRatingData(normalizedTitle);

  if (cachedData) {
    renderRatingForTitle(normalizedTitle, cachedData);
  } else {
    renderRatingForTitle(normalizedTitle, { loading: true });
  }

  const shouldFetch = force || !cachedData || cachedData.stale;
  if (!shouldFetch) {
    return Promise.resolve(cachedData);
  }

  setRefreshingState(normalizedTitle);

  if (ratingFetches.has(normalizedTitle)) {
    return ratingFetches.get(normalizedTitle);
  }

  const entry = getMediaEntry(normalizedTitle);
  const sourceTitle = originalTitle || entry.primaryTitle || normalizedTitle;

  const fetchPromise = fetchAniListRating(sourceTitle, true)
    .then((result) => {
      renderRatingForTitle(normalizedTitle, result);
      return result;
    })
    .catch((err) => {
      console.error('Failed to refresh rating:', err);
      const fallback = cachedData || {
        score: null,
        cached: false,
        stale: false,
        timestamp: Date.now(),
        expires: Date.now() + CACHE_TTL_MS,
        failed: true,
      };
      renderRatingForTitle(normalizedTitle, { ...fallback, failed: true });
      throw err;
    })
    .finally(() => {
      ratingFetches.delete(normalizedTitle);
    });

  ratingFetches.set(normalizedTitle, fetchPromise);
  return fetchPromise;
}

/** Attach rating badge to a title */
function addRatingToTitle(titleDiv, titleText, normalizedTitle) {
  const ratingSpan = document.createElement('span');
  ratingSpan.style.marginLeft = '8px';
  ratingSpan.style.cursor = 'pointer';
  ratingSpan.textContent = '…';
  ratingSpan.dataset.normalizedTitle = normalizedTitle;
  titleDiv.appendChild(ratingSpan);

  ratingSpan.addEventListener('click', (e) => {
    e.stopPropagation();
    ensureRatingForTitle(normalizedTitle, titleText, true);
  });
  attachRatingSpanHandlers(ratingSpan, normalizedTitle);

  return ratingSpan;
}

/* ------------------------------------------------------------------
 * GIST SYNC (favorites + settings across devices)
 * ---------------------------------------------------------------- */

let _syncInFlight = false;
let _syncStatus = { state: 'idle', message: 'Not configured', time: null };
const _syncStatusListeners = new Set();

function setSyncStatus(state, message) {
  _syncStatus = { state, message, time: Date.now() };
  for (const cb of _syncStatusListeners) {
    try {
      cb(_syncStatus);
    } catch (e) {
      /* listener gone */
    }
  }
}

function getSyncToken() {
  return GM_getValue(SYNC_TOKEN_KEY, '');
}

function ghApi(method, path, token, body) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method,
      url: path.startsWith('http') ? path : 'https://api.github.com' + path,
      headers: {
        Authorization: 'token ' + token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      data: body ? JSON.stringify(body) : undefined,
      onload: (res) => {
        if (res.status >= 200 && res.status < 300) {
          try {
            resolve(res.responseText ? JSON.parse(res.responseText) : null);
          } catch (e) {
            resolve(res.responseText);
          }
        } else {
          reject(new Error(`GitHub API ${res.status} on ${method} ${path}`));
        }
      },
      onerror: () => reject(new Error('Network error reaching GitHub')),
    });
  });
}

function buildSyncPayload(favorites, settings) {
  return { version: 1, updatedAt: Date.now(), favorites, settings };
}

/** Find the sync gist among the user's gists, or create a private one. */
async function findOrCreateGist(token) {
  let gistId = GM_getValue(SYNC_GIST_ID_KEY, '');
  if (gistId) return gistId;

  const gists = await ghApi('GET', '/gists?per_page=100', token);
  const found = (gists || []).find((g) => g.files && g.files[SYNC_FILENAME]);
  if (found) {
    GM_setValue(SYNC_GIST_ID_KEY, found.id);
    return found.id;
  }

  const created = await ghApi('POST', '/gists', token, {
    description: 'SubsPlease FineEnhancer sync data',
    public: false,
    files: {
      [SYNC_FILENAME]: {
        content: JSON.stringify(buildSyncPayload(getFavoritesRaw(), getSettingsRaw()), null, 2),
      },
    },
  });
  GM_setValue(SYNC_GIST_ID_KEY, created.id);
  return created.id;
}

/** Merge two {key: {timestamp, ...}} maps — newest timestamp wins per key. */
function mergeTimestamped(local, remote) {
  const merged = { ...local };
  for (const [key, remoteEntry] of Object.entries(remote || {})) {
    if (!remoteEntry || typeof remoteEntry !== 'object') continue;
    const localEntry = merged[key];
    if (!localEntry || (remoteEntry.timestamp || 0) > (localEntry.timestamp || 0)) {
      merged[key] = remoteEntry;
    }
  }
  return merged;
}

/** Drop deletion tombstones older than TOMBSTONE_TTL_MS. */
function pruneTombstones(favorites) {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  for (const [key, entry] of Object.entries(favorites)) {
    if (entry?.removed && (entry.timestamp || 0) < cutoff) {
      delete favorites[key];
    }
  }
  return favorites;
}

/** Two-way sync: pull remote gist, merge by timestamp, apply locally,
 * push back if anything differs. */
async function syncNow(manual = false) {
  const token = getSyncToken();
  if (!token) {
    setSyncStatus('idle', 'Not configured — add a GitHub token in Settings');
    if (manual) showSettingsDialog();
    return;
  }
  if (_syncInFlight) return;
  _syncInFlight = true;
  setSyncStatus('syncing', 'Syncing…');

  try {
    const gistId = await findOrCreateGist(token);
    const gist = await ghApi('GET', `/gists/${gistId}`, token);
    const file = gist?.files?.[SYNC_FILENAME];

    let remote = {};
    if (file) {
      let content = file.content;
      if (file.truncated && file.raw_url) {
        content = await ghApi('GET', file.raw_url, token);
        if (typeof content !== 'string') content = JSON.stringify(content);
      }
      try {
        remote = JSON.parse(content) || {};
      } catch (e) {
        console.error('Sync: remote gist content is not valid JSON, treating as empty.', e);
      }
    }

    const beforeFavs = JSON.stringify(getFavoritesRaw());
    const mergedFavorites = pruneTombstones(mergeTimestamped(getFavoritesRaw(), remote.favorites));
    const mergedSettings = mergeTimestamped(getSettingsRaw(), remote.settings);

    saveFavoritesRaw(mergedFavorites);
    saveSettingsRaw(mergedSettings);
    applySettingsSideEffects();
    for (const key of Object.keys(mergedFavorites)) {
      refreshFavoriteVisuals(key);
    }
    applyShowsFilter();
    if (beforeFavs !== JSON.stringify(mergedFavorites)) {
      console.log('Sync: favorites updated from remote.');
    }

    const localComparable = JSON.stringify({ favorites: mergedFavorites, settings: mergedSettings });
    const remoteComparable = JSON.stringify({
      favorites: remote.favorites || {},
      settings: remote.settings || {},
    });
    if (localComparable !== remoteComparable) {
      await ghApi('PATCH', `/gists/${gistId}`, token, {
        files: {
          [SYNC_FILENAME]: {
            content: JSON.stringify(buildSyncPayload(mergedFavorites, mergedSettings), null, 2),
          },
        },
      });
    }

    const favCount = Object.values(mergedFavorites).filter((f) => f && !f.removed).length;
    setSyncStatus('ok', `Synced ✓ (${favCount} favorites)`);
  } catch (err) {
    console.error('Sync failed:', err);
    setSyncStatus('error', `Sync failed: ${err.message}`);
    if (manual) alert(`SubsPlease Fine Enhancer sync failed:\n${err.message}`);
  } finally {
    _syncInFlight = false;
  }
}

const scheduleSync = debounce(() => syncNow(false), 2500);

function disconnectSync() {
  GM_deleteValue(SYNC_TOKEN_KEY);
  GM_deleteValue(SYNC_GIST_ID_KEY);
  setSyncStatus('idle', 'Not configured — add a GitHub token in Settings');
}

/* ------------------------------------------------------------------
 * EXPORT / IMPORT
 * ---------------------------------------------------------------- */

function exportData() {
  const payload = buildSyncPayload(getFavoritesRaw(), getSettingsRaw());
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = SYNC_FILENAME;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importDataFromText(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (e) {
    alert('Import failed: file is not valid JSON.');
    return;
  }
  const favorites = pruneTombstones(mergeTimestamped(getFavoritesRaw(), payload.favorites));
  const settings = mergeTimestamped(getSettingsRaw(), payload.settings);
  saveFavoritesRaw(favorites);
  saveSettingsRaw(settings);
  applySettingsSideEffects();
  for (const key of Object.keys(favorites)) refreshFavoriteVisuals(key);
  applyShowsFilter();
  scheduleSync();
  const count = Object.values(favorites).filter((f) => f && !f.removed).length;
  alert(`Import complete — ${count} favorites total.`);
}

/* ------------------------------------------------------------------
 * IMAGE PREVIEW + STYLES
 * ---------------------------------------------------------------- */

function initScheduleFavorites() {
  const rows = document.querySelectorAll('#schedule-table tr.schedule-widget-item:not(.sp-schedule-processed)');
  if (!rows.length) return;

  rows.forEach((row) => {
    row.classList.add('sp-schedule-processed');
    const showCell = row.querySelector('.schedule-widget-show');
    const link = showCell?.querySelector('a');
    if (!showCell || !link) return;

    showCell.classList.add('sp-schedule-show');

    const titleText = link.textContent.trim();
    const normalizedTitle = normalizeTitle(titleText);

    const star = document.createElement('span');
    star.className = 'sp-schedule-favorite-star';
    star.innerHTML = '☆';
    star.style.cursor = 'pointer';
    star.style.userSelect = 'none';
    star.title = 'Click to toggle favorite';
    star.dataset.title = titleText;
    star.dataset.normalizedTitle = normalizedTitle;

    star.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFavorite(titleText);
    });

    showCell.appendChild(star);

    registerScheduleElements(normalizedTitle, { row, star, originalTitle: titleText });
  });
}

/** Inject styles (only once) */
function ensureStyles() {
  if (document.getElementById('sp-styles')) return;
  const css = `
    #releases-table td .sp-img-wrapper {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 6px 0;
      transition: all 0.3s ease;
      border-radius: 8px;
      position: relative;
    }
    .sp-thumb {
      width: var(--sp-thumb-size, 64px);
      height: auto;
      object-fit: cover;
      border-radius: 6px;
      flex-shrink: 0;
      transition: all 0.3s ease;
    }
    .sp-text {
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
    }
    .sp-title {
      font-weight: 600;
      margin-bottom: 4px;
    }
    .sp-badges {
      margin-top: 6px;
    }
    .sp-favorite {
      background: linear-gradient(90deg,
        rgba(255, 215, 0, 0.2) 0%,
        rgba(255, 215, 0, 0.14) 35%,
        rgba(255, 215, 0, 0.08) 70%,
        rgba(255, 215, 0, 0.03) 100%);
      border-left: 3px solid rgba(255, 215, 0, 0.75);
      padding-left: 10px;
      margin-left: -3px;
      box-shadow: 0 3px 12px rgba(255, 215, 0, 0.18);
    }
    .sp-favorite::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: linear-gradient(to bottom,
        rgba(255, 215, 0, 0.95) 0%,
        rgba(255, 215, 0, 0.45) 50%,
        rgba(255, 215, 0, 0.95) 100%);
      border-radius: 1px;
    }
    .sp-favorite .sp-thumb {
      box-shadow: 0 4px 12px rgba(255, 215, 0, 0.3);
      border: 1px solid rgba(255, 215, 0, 0.45);
    }
    .sp-favorite:hover {
      background: linear-gradient(90deg,
        rgba(255, 215, 0, 0.24) 0%,
        rgba(255, 215, 0, 0.16) 35%,
        rgba(255, 215, 0, 0.1) 70%,
        rgba(255, 215, 0, 0.04) 100%);
    }
    .sp-favorite-star {
      position: absolute;
      top: 5px;
      right: 5px;
      font-size: 18px;
      padding: 2px;
      z-index: 10;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
      transition: all 0.2s ease;
      opacity: 0.7;
      line-height: 1;
    }
    .sp-favorite-star:hover {
      opacity: 1;
      transform: scale(1.15);
    }
    .release-item-time {
      position: relative;
    }
    .sp-schedule-show {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: space-between;
    }
    .sp-schedule-show a {
      flex: 1;
    }
    .sp-schedule-favorite {
      background: linear-gradient(90deg,
        rgba(255, 215, 0, 0.18) 0%,
        rgba(255, 215, 0, 0.1) 65%,
        rgba(255, 215, 0, 0.05) 100%);
      border-left: 3px solid rgba(255, 215, 0, 0.7);
    }
    .sp-schedule-favorite .schedule-widget-show a {
      font-weight: 600;
    }
    .sp-schedule-favorite-star {
      font-size: 18px;
      padding: 2px;
      line-height: 1;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
      opacity: 0.75;
      transition: all 0.2s ease;
      color: #666;
    }
    .sp-schedule-favorite-star:hover {
      opacity: 1;
      transform: scale(1.15);
    }
    .sp-shows-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .sp-shows-star {
      cursor: pointer;
      font-size: 15px;
      padding: 1px;
      line-height: 1;
      opacity: 0.7;
      user-select: none;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
      transition: all 0.2s ease;
      color: #666;
    }
    .sp-shows-star:hover {
      opacity: 1;
      transform: scale(1.15);
    }
    .sp-shows-rating {
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      opacity: 1;
      line-height: 1;
    }
    .sp-shows-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin: 0 0 12px;
      padding: 8px;
      border-radius: 8px;
      background: linear-gradient(90deg, rgba(255, 215, 0, 0.08) 0%, rgba(255, 215, 0, 0.02) 100%);
      border: 1px solid rgba(255, 215, 0, 0.25);
    }
    .sp-shows-search {
      flex: 1 1 160px;
      min-width: 140px;
      font-size: 13px;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid rgba(255, 215, 0, 0.45);
      background: rgba(0, 0, 0, 0.15);
      color: inherit;
      outline: none;
    }
    .sp-shows-search:focus {
      border-color: rgba(255, 215, 0, 0.8);
    }
    .sp-shows-fetch-btn {
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: #f0d27a;
      background: rgba(255, 215, 0, 0.1);
      border: 1px solid rgba(255, 215, 0, 0.45);
      border-radius: 999px;
      padding: 3px 10px;
      line-height: 1.3;
      transition: all 0.15s ease;
    }
    .sp-shows-fetch-btn:hover {
      background: rgba(255, 215, 0, 0.2);
      transform: translateY(-1px);
    }
    .sp-shows-fetch-btn.sp-active {
      background: rgba(255, 215, 0, 0.35);
      color: #fff;
    }
    .sp-shows-favorite {
      background: rgba(255, 215, 0, 0.12);
      border-radius: 3px;
      padding: 1px 3px;
    }
    .sp-shows-favorite a {
      font-weight: 600;
    }
    .sp-modal {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 9999;
    }
    .sp-dialog {
      background: #fff;
      color: #222;
      border: 1px solid #ccc;
      border-radius: 8px;
      padding: 20px;
      width: 380px;
      max-height: 85vh;
      overflow-y: auto;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
      font-size: 14px;
    }
    [data-theme="dark"] .sp-dialog {
      background: #26262b;
      color: #e8e8e8;
      border-color: #444;
    }
    .sp-dialog h4 {
      margin: 0 0 12px;
      font-size: 16px;
    }
    .sp-dialog label {
      display: block;
      margin: 14px 0 6px;
      font-weight: bold;
    }
    .sp-dialog select,
    .sp-dialog input[type="password"],
    .sp-dialog input[type="text"] {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      border-radius: 5px;
      border: 1px solid #bbb;
      background: inherit;
      color: inherit;
    }
    .sp-dialog .sp-muted {
      color: #888;
      font-size: 12.5px;
      margin: 4px 0 8px;
    }
    .sp-dialog .sp-row {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .sp-btn {
      border: none;
      border-radius: 5px;
      padding: 8px 14px;
      cursor: pointer;
      font-size: 14px;
      color: #fff;
      background: #6c757d;
    }
    .sp-btn:hover { filter: brightness(1.1); }
    .sp-btn.sp-primary { background: #007bff; }
    .sp-btn.sp-danger { background: #dc3545; }
    .sp-sync-status {
      margin-top: 6px;
      font-size: 12.5px;
    }
    .sp-sync-status.ok { color: #00cc66; }
    .sp-sync-status.error { color: #cc4444; }
    .sp-sync-status.syncing { color: #cc8800; }
    .sp-version {
      font-size: 11px;
      font-weight: normal;
      color: #888;
      margin-left: 6px;
    }
    .sp-thresholds {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-wrap: wrap;
      font-size: 13px;
    }
    .sp-thresholds input[type="number"] {
      width: 52px;
      padding: 4px 6px;
      border-radius: 5px;
      border: 1px solid #bbb;
      background: inherit;
      color: inherit;
      margin-right: 6px;
    }
    .sp-dot {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .sp-sync-details {
      margin-top: 16px;
      border: 1px solid rgba(128, 128, 128, 0.35);
      border-radius: 6px;
      padding: 8px 10px;
    }
    .sp-sync-details summary {
      cursor: pointer;
      user-select: none;
      font-size: 13.5px;
    }
    .sp-sync-details[open] summary {
      margin-bottom: 8px;
    }
    .sp-muted-inline {
      color: #888;
      font-size: 12px;
      margin-left: 4px;
    }
    .sp-footer {
      margin-top: 18px;
      justify-content: flex-end;
      border-top: 1px solid rgba(128, 128, 128, 0.25);
      padding-top: 12px;
    }
    `;
  const style = document.createElement('style');
  style.id = 'sp-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------
 * SHOWS PAGE (/shows/)
 * ---------------------------------------------------------------- */

const _showsQueue = [];
const _showsQueued = new Map();
let _showsQueueIndex = 0;
let _showsQueueRunning = false;
const _showsFilter = { text: '', favoritesOnly: false };

function queueShowsRatingFetch(normalizedTitle, originalTitle, force = false) {
  const existing = _showsQueued.get(normalizedTitle);
  if (existing) {
    if (force) existing[2] = true;
    return;
  }
  const entry = [normalizedTitle, originalTitle, !!force];
  _showsQueued.set(normalizedTitle, entry);
  _showsQueue.push(entry);
}

/** Drain the queue in batches of ANILIST_BATCH_SIZE — one GraphQL
 * request per batch instead of one per title. */
async function _runShowsQueue() {
  if (_showsQueueRunning) return;
  _showsQueueRunning = true;
  while (_showsQueueIndex < _showsQueue.length) {
    const batch = [];
    while (batch.length < ANILIST_BATCH_SIZE && _showsQueueIndex < _showsQueue.length) {
      batch.push(_showsQueue[_showsQueueIndex++]);
    }

    const toFetch = [];
    for (const [normalizedTitle, originalTitle, force] of batch) {
      const cached = getCachedRatingData(normalizedTitle);
      if (cached && !cached.stale && !force) {
        renderRatingForTitle(normalizedTitle, cached);
      } else {
        renderRatingForTitle(normalizedTitle, { loading: true });
        toFetch.push({ normalizedTitle, sourceTitle: originalTitle || normalizedTitle });
      }
    }

    if (toFetch.length) {
      const results = await fetchAniListRatingsBatch(toFetch);
      for (const it of toFetch) {
        renderRatingForTitle(it.normalizedTitle, results.get(it.normalizedTitle));
      }
    }

    for (const [normalizedTitle] of batch) {
      _showsQueued.delete(normalizedTitle);
    }

    if (toFetch.length && _showsQueueIndex < _showsQueue.length) {
      await new Promise((r) => setTimeout(r, ANILIST_BATCH_DELAY_MS));
    }
  }
  _showsQueue.length = 0;
  _showsQueueIndex = 0;
  _showsQueued.clear();
  _showsQueueRunning = false;
}

function assignShowsSectionKeys(container) {
  let currentSection = '#';
  // querySelectorAll returns nodes in document order, which lets us map each link to the latest heading.
  const nodes = container.querySelectorAll(`${SHOWS_HEADING_SELECTOR}, ${SHOWS_ANY_LINK_SELECTOR}`);
  nodes.forEach((node) => {
    if (node.matches(SHOWS_HEADING_SELECTOR)) {
      currentSection = node.textContent.trim() || '#';
      return;
    }
    node.dataset.spSectionKey = currentSection;
  });
}

/** Show/hide entries on /shows/ based on the search text and the
 * favorites-only toggle. Also hides section headings left empty. */
function applyShowsFilter() {
  const container = document.querySelector('.all-shows');
  if (!container) return;

  const text = _showsFilter.text.toLowerCase();
  const favoritesOnly = _showsFilter.favoritesOnly;
  const favorites = getFavorites();
  const sectionVisible = new Map();

  container.querySelectorAll('.sp-shows-item').forEach((wrapper) => {
    const link = wrapper.querySelector(SHOWS_ANY_LINK_SELECTOR);
    if (!link) return;
    const titleText = link.getAttribute('title') || link.textContent.trim();
    const normalizedTitle = normalizeTitle(titleText);
    const matchesText = !text || titleText.toLowerCase().includes(text);
    const matchesFav = !favoritesOnly || !!favorites[normalizedTitle];
    const visible = matchesText && matchesFav;
    wrapper.style.display = visible ? '' : 'none';

    const section = link.dataset.spSectionKey || '#';
    sectionVisible.set(section, (sectionVisible.get(section) || false) || visible);
  });

  const filterActive = !!text || favoritesOnly;
  container.querySelectorAll(`:scope > ${SHOWS_HEADING_SELECTOR}`).forEach((heading) => {
    const section = heading.textContent.trim() || '#';
    heading.style.display = filterActive && !sectionVisible.get(section) ? 'none' : '';
  });
}

function buildShowsToolbar(container) {
  if (container.querySelector('.sp-shows-toolbar')) return;

  const toolbar = document.createElement('div');
  toolbar.className = 'sp-shows-toolbar';

  const addButton = (label, onClick) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sp-shows-fetch-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    toolbar.appendChild(btn);
    return btn;
  };

  const enqueueByFilter = (predicate) => {
    const links = container.querySelectorAll(SHOWS_ANY_LINK_SELECTOR);
    links.forEach((link) => {
      if (!predicate(link)) return;
      const titleText = link.getAttribute('title') || link.textContent.trim();
      const normalizedTitle = normalizeTitle(titleText);
      const cachedData = getCachedRatingData(normalizedTitle);
      // Skip only fresh entries that actually have a score — cached
      // "not found" (null) entries get retried so they aren't stuck as N/A
      if (cachedData && !cachedData.stale && typeof cachedData.score === 'number') return;
      queueShowsRatingFetch(normalizedTitle, titleText, true);
    });
    _runShowsQueue();
  };

  // Search box
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'sp-shows-search';
  search.placeholder = 'Filter shows…';
  search.addEventListener(
    'input',
    debounce(() => {
      _showsFilter.text = search.value.trim();
      applyShowsFilter();
    }, 150),
  );
  toolbar.appendChild(search);

  // Favorites-only toggle
  const favBtn = addButton('★ Favorites only', () => {
    _showsFilter.favoritesOnly = !_showsFilter.favoritesOnly;
    favBtn.classList.toggle('sp-active', _showsFilter.favoritesOnly);
    applyShowsFilter();
  });

  addButton('Fetch all ratings', () => enqueueByFilter(() => true));

  const headings = [...new Set(
    [...container.querySelectorAll(`:scope > ${SHOWS_HEADING_SELECTOR}`)]
      .map((h) => h.textContent.trim())
      .filter((v) => v),
  )];

  headings.forEach((section) => {
    addButton(section, () => enqueueByFilter((link) => (link.dataset.spSectionKey || '') === section));
  });

  container.insertBefore(toolbar, container.firstChild);
}

/** Add favorites and ratings to the /shows/ listing */
function initShowsPage() {
  ensureStyles();
  const container = document.querySelector('.all-shows');
  if (!container) return;

  const links = container.querySelectorAll(SHOWS_LINK_SELECTOR);
  if (!links.length) return;

  assignShowsSectionKeys(container);

  buildShowsToolbar(container);

  links.forEach((link) => {
    link.classList.add('sp-shows-processed');

    const titleText = link.getAttribute('title') || link.textContent.trim();
    const normalizedTitle = normalizeTitle(titleText);

    // Wrap the link so we can append star + rating inline
    const wrapper = document.createElement('span');
    wrapper.className = 'sp-shows-item';
    link.parentNode.insertBefore(wrapper, link);
    wrapper.appendChild(link);

    // Favorite star
    const star = document.createElement('span');
    star.className = 'sp-shows-star';
    star.innerHTML = '☆';
    star.style.color = '#666';
    star.title = 'Click to toggle favorite';
    star.dataset.normalizedTitle = normalizedTitle;
    star.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFavorite(titleText);
    });

    // Rating badge
    const ratingSpan = document.createElement('span');
    ratingSpan.className = 'sp-shows-rating';
    // '–' = not fetched yet; only an actual AniList miss renders 'N/A'
    ratingSpan.textContent = '–';
    ratingSpan.style.color = '#777';
    ratingSpan.title = 'Rating not fetched yet — click to fetch';
    ratingSpan.dataset.normalizedTitle = normalizedTitle;
    ratingSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      queueShowsRatingFetch(normalizedTitle, titleText, true);
      _runShowsQueue();
    });
    attachRatingSpanHandlers(ratingSpan, normalizedTitle);

    wrapper.appendChild(star);
    wrapper.appendChild(ratingSpan);

    registerShowsElements(normalizedTitle, { wrapper, star, ratingSpan, originalTitle: titleText });

    // Render from cache immediately; auto-fetch only for favorites
    const cachedData = getCachedRatingData(normalizedTitle);
    if (cachedData && !cachedData.stale) {
      renderRatingForTitle(normalizedTitle, cachedData);
    } else if (isFavorite(titleText)) {
      queueShowsRatingFetch(normalizedTitle, titleText, false);
    }
  });

  applyShowsFilter();
  _runShowsQueue();
}

/** Attach images + ratings to release table */
function addImages() {
  ensureStyles();
  initScheduleFavorites();
  applySettingsSideEffects();

  const links = document.querySelectorAll('#releases-table a[data-preview-image]:not(.processed)');
  links.forEach((link) => {
    if (!link || link.classList.contains('processed')) return;
    link.classList.add('processed');

    const imgUrl = link.getAttribute('data-preview-image') || '';
    const cell = link.closest('td');
    if (!cell) return;

    // Build wrapper layout
    const wrapper = document.createElement('div');
    wrapper.className = 'sp-img-wrapper';

    const img = document.createElement('img');
    img.className = 'sp-thumb';
    img.src = imgUrl;
    img.loading = 'lazy';
    img.alt = link.textContent.trim() || 'preview';

    const textDiv = document.createElement('div');
    textDiv.className = 'sp-text';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'sp-title';
    titleDiv.appendChild(link);

    const titleText = link.textContent.trim();
    const normalizedTitle = normalizeTitle(titleText);

    // Add favorite star to time column
    const star = addFavoriteStar(cell, titleText, normalizedTitle);

    const ratingSpan = addRatingToTitle(titleDiv, titleText, normalizedTitle);

    const badge = cell.querySelector('.badge-wrapper');
    if (badge) {
      badge.classList.add('sp-badges');
      textDiv.appendChild(titleDiv);
      textDiv.appendChild(badge);
    } else {
      textDiv.appendChild(titleDiv);
    }

    wrapper.appendChild(img);
    wrapper.appendChild(textDiv);

    cell.innerHTML = '';
    cell.appendChild(wrapper);

    registerReleaseElements(normalizedTitle, { wrapper, star, ratingSpan, originalTitle: titleText });
    ensureRatingForTitle(normalizedTitle, titleText, false);
  });
}

/* ------------------------------------------------------------------
 * SETTINGS DIALOG
 * ---------------------------------------------------------------- */

/** Modal to change script settings */
function showSettingsDialog() {
  ensureStyles();
  const existing = document.getElementById('settingsModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'settingsModal';
  modal.className = 'sp-modal';

  const dialog = document.createElement('div');
  dialog.className = 'sp-dialog';

  const favoritesCount = Object.keys(getFavorites()).length;
  const hasToken = !!getSyncToken();
  const thresholds = getRatingThresholds();
  const syncSummary = hasToken
    ? (_syncStatus.state === 'ok' ? '🟢 connected' : _syncStatus.state === 'error' ? '🔴 error' : '⚪ configured')
    : '⚪ off';

  dialog.innerHTML = `
    <h4>SubsPlease Fine Enhancer <span class="sp-version">v1.6.3</span></h4>

    <label for="sp-image-size">Image preview size</label>
    <select id="sp-image-size">
      <option value="64px">Small (64px)</option>
      <option value="128px">Medium (128px)</option>
      <option value="225px">Large (225px)</option>
    </select>

    <label>Rating colors</label>
    <div class="sp-thresholds">
      <span class="sp-dot" style="background:#888888"></span> ≤ <input type="number" id="sp-th-gray" min="0" max="100" value="${thresholds.gray}">
      <span class="sp-dot" style="background:#cc4444"></span> ≤ <input type="number" id="sp-th-red" min="0" max="100" value="${thresholds.red}">
      <span class="sp-dot" style="background:#cc8800"></span> ≤ <input type="number" id="sp-th-orange" min="0" max="100" value="${thresholds.orange}">
      <span class="sp-dot" style="background:#00cc66"></span> above
    </div>
    <div class="sp-muted">Score boundaries for gray / red / orange; green above the last one.</div>

    <label>Favorites (${favoritesCount})</label>
    <div class="sp-row">
      <button type="button" class="sp-btn" id="sp-export">Export</button>
      <button type="button" class="sp-btn" id="sp-import">Import</button>
      <button type="button" class="sp-btn sp-danger" id="sp-clear-favs">Clear all</button>
    </div>

    <details class="sp-sync-details" id="sp-sync-details">
      <summary><b>Sync</b> — GitHub Gist <span class="sp-muted-inline">${syncSummary}</span></summary>
      <div class="sp-muted">
        Favorites and settings sync across devices through a private Gist.
        Create a token with only the <b>gist</b> scope
        (github.com → Settings → Developer settings → Personal access tokens)
        and paste it here on each device.
      </div>
      <input type="password" id="sp-sync-token" placeholder="${hasToken ? '••••••••  (token saved)' : 'ghp_… or github_pat_…'}" autocomplete="off">
      <div class="sp-sync-status" id="sp-sync-status"></div>
      <div class="sp-row">
        <button type="button" class="sp-btn sp-primary" id="sp-sync-now">Sync now</button>
        <button type="button" class="sp-btn sp-danger" id="sp-sync-disconnect" ${hasToken ? '' : 'disabled'}>Disconnect</button>
      </div>
    </details>

    <div class="sp-row sp-footer">
      <button type="button" class="sp-btn sp-primary" id="sp-save">Save</button>
      <button type="button" class="sp-btn" id="sp-close">Close</button>
    </div>
  `;

  modal.appendChild(dialog);
  document.body.appendChild(modal);

  const $ = (id) => dialog.querySelector(id);
  $('#sp-image-size').value = normalizeSize(getSetting('imageSize', '64px'));

  const statusEl = $('#sp-sync-status');
  const renderStatus = (status) => {
    if (!statusEl.isConnected) return;
    statusEl.textContent = status.message;
    statusEl.className = `sp-sync-status ${status.state}`;
  };
  renderStatus(_syncStatus);
  _syncStatusListeners.add(renderStatus);

  const close = () => {
    _syncStatusListeners.delete(renderStatus);
    modal.remove();
  };

  const saveToken = () => {
    const token = $('#sp-sync-token').value.trim();
    if (token) {
      GM_setValue(SYNC_TOKEN_KEY, token);
      GM_deleteValue(SYNC_GIST_ID_KEY); // re-resolve gist for the new token
    }
    return token;
  };

  $('#sp-save').onclick = () => {
    setSetting('imageSize', $('#sp-image-size').value);
    const clamp = (id, def) => {
      const v = parseInt($(id).value, 10);
      return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : def;
    };
    setSetting('ratingColors', {
      gray: clamp('#sp-th-gray', DEFAULT_RATING_THRESHOLDS.gray),
      red: clamp('#sp-th-red', DEFAULT_RATING_THRESHOLDS.red),
      orange: clamp('#sp-th-orange', DEFAULT_RATING_THRESHOLDS.orange),
    });
    applySettingsSideEffects();
    rerenderAllRatings();
    const token = saveToken();
    close();
    if (token) syncNow(true);
  };

  $('#sp-close').onclick = close;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  $('#sp-sync-now').onclick = () => {
    saveToken();
    syncNow(true);
  };

  $('#sp-sync-disconnect').onclick = () => {
    disconnectSync();
    renderStatus(_syncStatus);
    $('#sp-sync-token').value = '';
    $('#sp-sync-token').placeholder = 'ghp_… or github_pat_…';
    $('#sp-sync-disconnect').disabled = true;
  };

  $('#sp-export').onclick = exportData;

  $('#sp-import').onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => importDataFromText(String(reader.result));
      reader.readAsText(file);
    };
    input.click();
  };

  $('#sp-clear-favs').onclick = () => {
    close();
    clearAllFavorites();
  };
}

/* ------------------------------------------------------------------
 * ENTRYPOINT: Mutation observer
 * ---------------------------------------------------------------- */
(function () {
  'use strict';

  const isShowsPage = location.pathname === '/shows/';
  const init = isShowsPage ? initShowsPage : addImages;
  const selector = isShowsPage ? SHOWS_LINK_SELECTOR : 'a[data-preview-image]:not(.processed)';
  const debouncedInit = debounce(init, DEBOUNCE_TIMER);

  const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && node.querySelector?.(selector)) {
            debouncedInit();
            return;
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  const onReady = () => {
    init();
    // Pull remote favorites shortly after load so stars from other devices appear
    if (getSyncToken()) {
      setTimeout(() => syncNow(false), 1500);
    }
  };

  if (document.readyState !== 'loading') {
    onReady();
  } else {
    document.addEventListener('DOMContentLoaded', onReady);
  }
})();
