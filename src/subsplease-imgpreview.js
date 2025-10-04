// ==UserScript==
// @name         SubsPlease ImgPreview
// @namespace    https://github.com/SonGokussj4/tampermonkey-subsplease-ImgPreview
// @version      1.2.1
// @description  Adds image previews and AniList ratings to SubsPlease release listings. Click ratings to refresh. Settings via menu commands. Also manage favorites with visual highlights.
// @author       SonGokussj4
// @license      MIT
// @match        https://subsplease.org/
// @grant        GM_xmlhttpRequest
// @connect      graphql.anilist.co
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

/* ------------------------------------------------------------------
 * CONFIG & CONSTANTS
 * ---------------------------------------------------------------- */
const DEBOUNCE_TIMER = 300; // ms
const CACHE_KEY = 'ratingCache';
const FAVORITES_KEY = 'spFavorites';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Menu commands for quick settings
GM_registerMenuCommand('Settings', showSettingsDialog);

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
 * - Remove "(Batch)" or other bracketed notes at the end
 */
function normalizeTitle(raw) {
  const normalized = raw
    .replace(/\s*\(Batch\)$/i, '') // remove "(Batch)" suffix
    .replace(/\s*[–—-]\s*\d+(\s*-\s*\d+)?$/, '') // remove trailing ep/range markers
    .trim();
  console.debug(`normalizeTitle: ${raw} --> ${normalized}`);
  return normalized;
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

function readRatingCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('Failed to parse rating cache, clearing it.', e);
    localStorage.removeItem(CACHE_KEY);
    return {};
  }
}

function writeRatingCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.error('Failed to write rating cache.', e);
  }
}

/* ------------------------------------------------------------------
 * FAVORITES MANAGEMENT
 * ---------------------------------------------------------------- */

/** Get all favorites from localStorage */
function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '{}');
  } catch (e) {
    console.error('Failed to parse favorites:', e);
    return {};
  }
}

/** Save favorites to localStorage */
function saveFavorites(favorites) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch (e) {
    console.error('Failed to save favorites:', e);
  }
}

/** Check if a show is favorited */
function isFavorite(title) {
  const normalizedTitle = normalizeTitle(title);
  const favorites = getFavorites();
  return !!favorites[normalizedTitle];
}

/** Toggle favorite status of a show */
function toggleFavorite(title) {
  const normalizedTitle = normalizeTitle(title);
  const favorites = getFavorites();

  if (favorites[normalizedTitle]) {
    delete favorites[normalizedTitle];
  } else {
    favorites[normalizedTitle] = {
      originalTitle: title,
      timestamp: Date.now(),
    };
  }

  saveFavorites(favorites);
  return !!favorites[normalizedTitle];
}

/** Clear all favorites */
function clearAllFavorites() {
  if (confirm('Are you sure you want to clear all favorites? This cannot be undone.')) {
    localStorage.removeItem(FAVORITES_KEY);
    location.reload(); // Refresh to update UI
  }
}

/** Update visual styling for favorite shows */
function updateFavoriteVisuals(wrapper, isFav) {
  if (!wrapper) return;

  if (isFav) {
    wrapper.classList.add('sp-favorite');
  } else {
    wrapper.classList.remove('sp-favorite');
  }
}

/** Add favorite star to the time column */
function addFavoriteStar(cell, titleText) {
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
  favoriteSpan.innerHTML = isFavorite(titleText) ? '★' : '☆';
  favoriteSpan.style.color = isFavorite(titleText) ? '#ffd700' : '#666';
  favoriteSpan.title = 'Click to toggle favorite';

  favoriteSpan.addEventListener('click', (e) => {
    e.stopPropagation();
    const isNowFavorite = toggleFavorite(titleText);
    favoriteSpan.innerHTML = isNowFavorite ? '★' : '☆';
    favoriteSpan.style.color = isNowFavorite ? '#ffd700' : '#666';

    // Update visual styling of parent elements - find the wrapper in the first cell
    const wrapper = row.querySelector('.sp-img-wrapper');
    updateFavoriteVisuals(wrapper, isNowFavorite);
  });

  // Position the star at the top-right of the time cell
  timeCell.style.position = 'relative';
  timeCell.appendChild(favoriteSpan);
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
          console.log('Fetching ratings for:', JSON.stringify(variables.search));
          resolve(JSON.parse(response.responseText));
        } catch (e) {
          reject(e);
        }
      },
      onerror: reject,
    });
  });
}

/** Fetch AniList rating, with caching (6h TTL) */
async function fetchAniListRating(title, forceRefresh = false) {
  const now = Date.now();
  const cache = readRatingCache();
  const cleanTitle = normalizeTitle(title);
  const entry = cache[cleanTitle];
  const hasEntry = !!entry;
  const timestamp = entry?.timestamp ?? 0;
  const age = hasEntry ? now - timestamp : Infinity;
  const stale = hasEntry ? age >= CACHE_TTL_MS : false;

  if (hasEntry && !forceRefresh) {
    return {
      score: Object.prototype.hasOwnProperty.call(entry, 'score') ? entry.score : null,
      cached: true,
      stale,
      timestamp,
      expires: timestamp + CACHE_TTL_MS,
    };
  }

  const query = `
            query ($search: String) {
              Media(search: $search, type: ANIME) {
                averageScore
              }
            }
        `;

  try {
    const json = await gmFetchAniList(query, { search: cleanTitle });
    const score = json?.data?.Media?.averageScore ?? null;

    const latestCache = readRatingCache();
    latestCache[cleanTitle] = { score, timestamp: now };
    writeRatingCache(latestCache);

    return { score, cached: false, stale: false, timestamp: now, expires: now + CACHE_TTL_MS };
  } catch (err) {
    console.error('AniList fetch failed:', err);
    if (hasEntry) {
      return {
        score: Object.prototype.hasOwnProperty.call(entry, 'score') ? entry.score : null,
        cached: true,
        stale,
        timestamp,
        expires: timestamp + CACHE_TTL_MS,
        failed: true,
      };
    }
    return { score: null, cached: false, stale: false, timestamp: now, expires: now + CACHE_TTL_MS, failed: true };
  }
}

/* ------------------------------------------------------------------
 * RATING BADGE HANDLING
 * ---------------------------------------------------------------- */

/** Attach rating badge to a title */
async function addRatingToTitle(titleDiv, titleText) {
  // Create rating span
  const ratingSpan = document.createElement('span');
  ratingSpan.style.marginLeft = '8px';
  ratingSpan.style.cursor = 'pointer';
  ratingSpan.textContent = '…';
  titleDiv.appendChild(ratingSpan);

  function renderRating({ score, cached, stale, timestamp, expires, failed }) {
    const hasScore = score !== null && score !== undefined;
    ratingSpan.textContent = hasScore ? `⭐ ${score}%` : 'N/A';

    if (!cached) {
      ratingSpan.style.color = failed ? '#cc4444' : '#00cc66';
      ratingSpan.title = failed ? 'AniList fetch failed\nClick to retry' : 'Fresh from AniList\nClick to refresh';
      return;
    }

    const now = Date.now();
    const ageMs = now - timestamp;

    if (stale) {
      ratingSpan.style.color = '#cc8800';
      const staleDuration = msToTime(Math.max(0, ageMs - CACHE_TTL_MS));
      ratingSpan.title = failed
        ? `Refresh failed — showing cached rating (expired ${staleDuration} ago)\nClick to retry`
        : `Using cached rating (${msToTime(ageMs)} old)\nRefreshing… Click to force refresh`;
      return;
    }

    const remaining = Math.max(0, expires - now);
    ratingSpan.style.color = '#ff9900';
    ratingSpan.title = failed
      ? `Refresh failed — showing cached (expires in ${msToTime(remaining)})\nClick to retry`
      : `Loaded from cache (expires in ${msToTime(remaining)})\nClick to refresh`;
  }

  async function updateRating(force = false) {
    const cache = readRatingCache();
    const cleanTitle = normalizeTitle(titleText);
    const cachedEntry = cache[cleanTitle];
    const timestamp = cachedEntry?.timestamp ?? 0;
    const isStale = cachedEntry ? Date.now() - timestamp >= CACHE_TTL_MS : false;

    if (cachedEntry) {
      renderRating({
        score: Object.prototype.hasOwnProperty.call(cachedEntry, 'score') ? cachedEntry.score : null,
        cached: true,
        stale: isStale,
        timestamp,
        expires: timestamp + CACHE_TTL_MS,
        failed: false,
      });
    } else {
      ratingSpan.textContent = '…';
      ratingSpan.style.color = '#999';
      ratingSpan.title = 'Loading rating…';
    }

    const shouldFetch = force || !cachedEntry || isStale;
    if (!shouldFetch) return;

    ratingSpan.title = 'Refreshing rating…';
    const result = await fetchAniListRating(titleText, true);
    renderRating(result);
  }

  ratingSpan.addEventListener('click', (e) => {
    e.stopPropagation();
    updateRating(true);
  });
  updateRating(false);
}

/* ------------------------------------------------------------------
 * IMAGE PREVIEW + STYLES
 * ---------------------------------------------------------------- */

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
        rgba(255, 215, 0, 0.08) 0%,
        rgba(255, 215, 0, 0.04) 30%,
        rgba(255, 215, 0, 0.02) 60%,
        transparent 100%);
      border-left: 3px solid rgba(255, 215, 0, 0.6);
      padding-left: 8px;
      margin-left: -3px;
    }
    .sp-favorite::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 2px;
      background: linear-gradient(to bottom,
        rgba(255, 215, 0, 0.8) 0%,
        rgba(255, 215, 0, 0.4) 50%,
        rgba(255, 215, 0, 0.8) 100%);
      border-radius: 1px;
    }
    .sp-favorite .sp-thumb {
      box-shadow: 0 2px 8px rgba(255, 215, 0, 0.25);
      border: 1px solid rgba(255, 215, 0, 0.3);
    }
    .sp-favorite:hover {
      background: linear-gradient(90deg,
        rgba(255, 215, 0, 0.12) 0%,
        rgba(255, 215, 0, 0.06) 30%,
        rgba(255, 215, 0, 0.03) 60%,
        transparent 100%);
    }
    .sp-favorite-star {
      position: absolute;
      top: 5px;
      right: 5px;
      font-size: 16px;
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
    `;
  const style = document.createElement('style');
  style.id = 'sp-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

/** Attach images + ratings to release table */
function addImages() {
  ensureStyles();

  // Load thumbnail size
  const thumbSize = normalizeSize(GM_getValue('imageSize', '64px'));
  document.documentElement.style.setProperty('--sp-thumb-size', thumbSize);

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
    img.alt = link.textContent.trim() || 'preview';

    const textDiv = document.createElement('div');
    textDiv.className = 'sp-text';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'sp-title';
    titleDiv.appendChild(link);

    const titleText = link.textContent.trim();

    // Set initial favorite styling before adding rating
    const isCurrentlyFavorite = isFavorite(titleText);
    if (isCurrentlyFavorite) {
      wrapper.classList.add('sp-favorite');
    }

    // Add favorite star to time column
    addFavoriteStar(cell, titleText);

    addRatingToTitle(titleDiv, titleText);

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
  });
}

/* ------------------------------------------------------------------
 * SETTINGS DIALOGS
 * ---------------------------------------------------------------- */

/** Modal to change script settings */
function showSettingsDialog() {
  const modal = document.createElement('div');
  modal.id = 'settingsModal';
  Object.assign(modal.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: '9999',
  });

  const dialog = document.createElement('div');
  Object.assign(dialog.style, {
    backgroundColor: 'white',
    border: '1px solid #ccc',
    borderRadius: '5px',
    padding: '20px',
    width: '350px',
    boxShadow: '0 4px 6px rgba(50,50,93,0.11), 0 1px 3px rgba(0,0,0,0.08)',
  });

  // Image size section
  const imageSizeLabel = document.createElement('label');
  imageSizeLabel.textContent = 'Image Preview Size:';
  imageSizeLabel.style.display = 'block';
  imageSizeLabel.style.marginBottom = '8px';
  imageSizeLabel.style.fontWeight = 'bold';

  const select = document.createElement('select');
  select.id = 'imageSizeSelect';
  select.style.width = '100%';
  select.style.marginBottom = '20px';
  [
    { text: 'Small (64px)', value: '64px' },
    { text: 'Medium (128px)', value: '128px' },
    { text: 'Large (225px)', value: '225px' },
  ].forEach((item) => {
    const option = document.createElement('option');
    option.value = item.value;
    option.text = item.text;
    select.appendChild(option);
  });
  select.value = GM_getValue('imageSize', '64px');

  // Favorites section
  const favoritesLabel = document.createElement('label');
  favoritesLabel.textContent = 'Favorites Management:';
  favoritesLabel.style.display = 'block';
  favoritesLabel.style.marginBottom = '8px';
  favoritesLabel.style.fontWeight = 'bold';

  const favoritesCount = Object.keys(getFavorites()).length;
  const favoritesInfo = document.createElement('div');
  favoritesInfo.textContent = `Current favorites: ${favoritesCount}`;
  favoritesInfo.style.marginBottom = '10px';
  favoritesInfo.style.color = '#666';
  favoritesInfo.style.fontSize = '14px';

  const clearFavoritesButton = document.createElement('button');
  clearFavoritesButton.textContent = 'Clear All Favorites';
  Object.assign(clearFavoritesButton.style, {
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    padding: '8px 16px',
    cursor: 'pointer',
    fontSize: '14px',
    width: '100%',
    marginBottom: '20px',
  });

  clearFavoritesButton.onclick = () => {
    document.body.removeChild(modal);
    clearAllFavorites();
  };

  // Main buttons
  const saveButton = document.createElement('button');
  saveButton.textContent = 'Save';
  Object.assign(saveButton.style, {
    backgroundColor: '#007BFF',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    padding: '10px 20px',
    cursor: 'pointer',
    fontSize: '16px',
  });

  saveButton.onclick = () => {
    GM_setValue('imageSize', select.value);
    document.body.removeChild(modal);
    document.documentElement.style.setProperty('--sp-thumb-size', select.value);
  };

  const closeButton = document.createElement('button');
  closeButton.textContent = 'Close';
  Object.assign(closeButton.style, {
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    padding: '10px 20px',
    cursor: 'pointer',
    fontSize: '16px',
  });

  closeButton.onclick = () => {
    document.body.removeChild(modal);
  };

  const buttonsDiv = document.createElement('div');
  buttonsDiv.style.display = 'flex';
  buttonsDiv.style.gap = '10px';
  buttonsDiv.style.marginTop = '10px';
  buttonsDiv.appendChild(saveButton);
  buttonsDiv.appendChild(closeButton);

  dialog.appendChild(imageSizeLabel);
  dialog.appendChild(select);
  dialog.appendChild(favoritesLabel);
  dialog.appendChild(favoritesInfo);
  dialog.appendChild(clearFavoritesButton);
  dialog.appendChild(buttonsDiv);
  modal.appendChild(dialog);
  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
}

/* ------------------------------------------------------------------
 * ENTRYPOINT: Mutation observer
 * ---------------------------------------------------------------- */
(function () {
  'use strict';

  const debouncedAddImages = debounce(addImages, DEBOUNCE_TIMER);

  const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && node.querySelector('a[data-preview-image]:not(.processed)')) {
            debouncedAddImages();
            return;
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
