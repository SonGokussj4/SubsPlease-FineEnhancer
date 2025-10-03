// ==UserScript==
// @name         SubsPlease ImgPreview
// @namespace    https://github.com/SonGokussj4/greasyfork-scripts
// @version      1.1.0
// @description  Adds small image preview of "Airtime" and "New and Hot" episodes
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
const DEBOUNCE_TIMER = 300;
const CACHE_KEY = 'ratingCache';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Menu commands for quick settings
GM_registerMenuCommand('Set padding', () => {
  const padding = prompt('Enter padding value (e.g., 10px):');
  if (padding) GM_setValue('padding', padding);
});
GM_registerMenuCommand('Set image preview size', showImageSizeDialog);

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
 * - Remove "(Batch)" or other bracketed notes at the end
 * - Remove episode ranges like "— 01-24"
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
  const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  const cleanTitle = normalizeTitle(title);

  if (!forceRefresh && cache[cleanTitle] && now - cache[cleanTitle].timestamp < CACHE_TTL_MS) {
    return { score: cache[cleanTitle].score, cached: true, expires: cache[cleanTitle].timestamp + CACHE_TTL_MS };
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
    const score = json?.data?.Media?.averageScore || null;

    if (score) {
      cache[cleanTitle] = { score, timestamp: now };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    }

    return { score, cached: false, expires: now + CACHE_TTL_MS };
  } catch (err) {
    console.error('AniList fetch failed:', err);
    if (cache[cleanTitle]) {
      return {
        score: cache[cleanTitle].score,
        cached: true,
        expires: cache[cleanTitle].timestamp + CACHE_TTL_MS,
        failed: true,
      };
    }
    return { score: null, cached: false, expires: now + CACHE_TTL_MS, failed: true };
  }
}

/* ------------------------------------------------------------------
 * RATING BADGE HANDLING
 * ---------------------------------------------------------------- */

/** Attach rating badge to a title */
async function addRatingToTitle(titleDiv, titleText) {
  const ratingSpan = document.createElement('span');
  ratingSpan.style.marginLeft = '8px';
  ratingSpan.style.cursor = 'pointer';
  ratingSpan.textContent = '…';
  titleDiv.appendChild(ratingSpan);

  async function updateRating(force = false) {
    const { score, cached, expires, failed } = await fetchAniListRating(titleText, force);

    if (score) {
      ratingSpan.textContent = `⭐ ${score}%`;

      if (cached) {
        ratingSpan.style.color = '#ff9900'; // cached → orange
        const remaining = expires - Date.now();
        ratingSpan.title = failed
          ? `Refresh failed — showing cached (expires in ${msToTime(remaining)})\nClick to retry`
          : `Loaded from cache (expires in ${msToTime(remaining)})\nClick to refresh`;
      } else {
        ratingSpan.style.color = '#00cc66'; // fresh → green
        ratingSpan.title = 'Fresh from AniList\nClick to refresh';
      }
    } else {
      ratingSpan.textContent = 'N/A';
      ratingSpan.style.color = '#999';
      ratingSpan.title = 'AniList fetch failed\nClick to retry';
    }
  }

  ratingSpan.addEventListener('click', () => updateRating(true));
  updateRating(false);
}

/* ------------------------------------------------------------------
 * IMAGE PREVIEW + STYLES
 * ---------------------------------------------------------------- */

/** Inject styles (only once) */
function ensureStyles() {
  if (document.getElementById('sp-styles')) return;
  const css = `
#releases-table td .sp-img-wrapper { display: flex; gap: 10px; align-items: flex-start; padding: 6px 0; }
.sp-thumb { width: var(--sp-thumb-size, 64px); height: auto; object-fit: cover; border-radius: 6px; flex-shrink: 0; }
.sp-text { display: flex; flex-direction: column; justify-content: flex-start; }
.sp-title { font-weight: 600; margin-bottom: 4px; }
.sp-badges { margin-top: 6px; }
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

/** Modal to change image size */
function showImageSizeDialog() {
  const modal = document.createElement('div');
  modal.id = 'imageSizeModal';
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
    width: '300px',
    boxShadow: '0 4px 6px rgba(50,50,93,0.11), 0 1px 3px rgba(0,0,0,0.08)',
  });

  const select = document.createElement('select');
  select.id = 'imageSizeSelect';
  select.style.width = '100%';
  [
    { text: 'Small (64px)', value: '64px' },
    { text: 'Medium (128px)', value: '128px' },
    { text: 'Large (256px)', value: '256px' },
  ].forEach((item) => {
    const option = document.createElement('option');
    option.value = item.value;
    option.text = item.text;
    select.appendChild(option);
  });
  select.value = GM_getValue('imageSize', '64px');

  const saveButton = document.createElement('button');
  saveButton.textContent = 'Save';
  Object.assign(saveButton.style, {
    marginTop: '10px',
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

  dialog.appendChild(select);
  dialog.appendChild(saveButton);
  modal.appendChild(dialog);
  document.body.appendChild(modal);
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
