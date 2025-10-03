// ==UserScript==
// @name         SubsPlease ImgPreview
// @namespace    https://github.com/SonGokussj4/greasyfork-scripts
// @version      1.0.0
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

const DEBOUNCE_TIMER = 300;

GM_registerMenuCommand('Set padding', () => {
  const padding = prompt('Enter padding value (e.g., 10px):');
  if (padding) {
    GM_setValue('padding', padding);
  }
});

GM_registerMenuCommand('Set image preview size', showImageSizeDialog);

function debounce(func, wait) {
  let timeout;
  return function () {
    const context = this,
      args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(function () {
      func.apply(context, args);
    }, wait);
  };
}

function normalizeTitle(raw) {
  // remove episode markers like "— 01" or " - 03"
  return raw.replace(/[-–—]\s*\d+$/, '').trim();
}

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
          const json = JSON.parse(response.responseText);
          resolve(json);
        } catch (e) {
          reject(e);
        }
      },
      onerror: reject,
    });
  });
}

async function fetchAniListRating(title, forceRefresh = false) {
  const cacheKey = 'ratingCache';
  const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
  const now = Date.now();
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  const cleanTitle = normalizeTitle(title);

  if (!forceRefresh && cache[cleanTitle] && now - cache[cleanTitle].timestamp < SIX_HOURS) {
    return { score: cache[cleanTitle].score, cached: true, expires: cache[cleanTitle].timestamp + SIX_HOURS };
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
      const currentCache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
      currentCache[cleanTitle] = { score, timestamp: now };
      localStorage.setItem(cacheKey, JSON.stringify(currentCache));
    }

    return { score, cached: false, expires: now + SIX_HOURS };
  } catch (err) {
    console.error('AniList fetch failed:', err);
    // fallback to cached if exists
    if (cache[cleanTitle]) {
      return {
        score: cache[cleanTitle].score,
        cached: true,
        expires: cache[cleanTitle].timestamp + SIX_HOURS,
        failed: true,
      };
    }
    return { score: null, cached: false, expires: now + SIX_HOURS, failed: true };
  }
}

function msToTime(ms) {
  let totalSeconds = Math.floor(ms / 1000);
  let hours = Math.floor(totalSeconds / 3600);
  let minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

async function addRatingToTitle(titleDiv, titleText) {
  const ratingSpan = document.createElement('span');
  ratingSpan.style.marginLeft = '8px';
  ratingSpan.style.cursor = 'pointer';
  ratingSpan.textContent = '…'; // placeholder
  titleDiv.appendChild(ratingSpan);

  async function updateRating(force = false) {
    const { score, cached, expires, failed } = await fetchAniListRating(titleText, force);

    if (score) {
      ratingSpan.textContent = `⭐ ${score}%`;

      if (cached) {
        ratingSpan.style.color = '#ff9900'; // orange
        const remaining = expires - Date.now();
        ratingSpan.title = failed
          ? `Refresh failed — showing cached (expires in ${msToTime(remaining)})\nClick to retry`
          : `Loaded from cache (expires in ${msToTime(remaining)})\nClick to refresh`;
      } else {
        ratingSpan.style.color = '#00cc66'; // green = fresh
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

function showImageSizeDialog() {
  // Create a modal container
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

  // Dialog box
  const dialog = document.createElement('div');
  Object.assign(dialog.style, {
    backgroundColor: 'white',
    border: '1px solid #ccc',
    borderRadius: '5px',
    padding: '20px',
    width: '300px',
    boxShadow: '0 4px 6px rgba(50,50,93,0.11), 0 1px 3px rgba(0,0,0,0.08)',
  });

  // Select
  const select = document.createElement('select');
  select.id = 'imageSizeSelect';
  select.style.width = '100%';

  const sizes = [
    { text: 'Small (64px)', value: '64px' },
    { text: 'Medium (128px)', value: '128px' },
    { text: 'Large (256px)', value: '256px' },
  ];

  sizes.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.value;
    option.text = item.text;
    select.appendChild(option);
  });

  // Pre-select current size
  const currentSize = GM_getValue('imageSize', '64px');
  select.value = currentSize;

  // Save button
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
    const selectedSize = select.value;
    GM_setValue('imageSize', selectedSize);
    document.body.removeChild(modal);

    // okamžitě aplikovat změnu bez reloadu
    document.documentElement.style.setProperty('--sp-thumb-size', selectedSize);
  };

  dialog.appendChild(select);
  dialog.appendChild(saveButton);
  modal.appendChild(dialog);
  document.body.appendChild(modal);
}

// --- přidej jednou (např. před observerem) ---
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

function normalizeSize(raw) {
  if (typeof raw === 'number') return raw + 'px';
  if (typeof raw === 'string') {
    raw = raw.trim();
    if (/^\d+$/.test(raw)) return raw + 'px'; // "64" -> "64px"
    if (/^\d+px$/.test(raw)) return raw; // "64px" -> "64px"
  }
  return '64px';
}

function addImages() {
  ensureStyles();

  // načteme a normalizujeme velikost miniatury (CSS proměnná)
  const rawSize = GM_getValue('imageSize', '64px');
  const thumbSize = normalizeSize(rawSize);
  document.documentElement.style.setProperty('--sp-thumb-size', thumbSize);

  const links = document.querySelectorAll('#releases-table a[data-preview-image]:not(.processed)');
  links.forEach((link) => {
    // safety checks
    if (!link || link.classList.contains('processed')) return;
    link.classList.add('processed');

    const imgUrl = link.getAttribute('data-preview-image') || '';
    const cell = link.closest('td');
    if (!cell) return;

    // Build structure:
    // <div class="sp-img-wrapper">
    //   <img class="sp-thumb" ...>
    //   <div class="sp-text">
    //     <div class="sp-title"> <a ...>Title</a> </div>
    //     <div class="sp-badges"> ...badge-wrapper... </div>
    //   </div>
    // </div>

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
    // move the link into the titleDiv (ke zpracování použijeme appendChild)
    titleDiv.appendChild(link);

    const titleText = link.textContent.trim();
    addRatingToTitle(titleDiv, titleText);

    // move badge-wrapper (pokud existuje) pod title
    const badge = cell.querySelector('.badge-wrapper');
    if (badge) {
      // detach badge from old place (appendChild přesune element)
      badge.classList.add('sp-badges');
      textDiv.appendChild(titleDiv);
      textDiv.appendChild(badge);
    } else {
      textDiv.appendChild(titleDiv);
    }

    wrapper.appendChild(img);
    wrapper.appendChild(textDiv);

    // zapíšeme nový obsah do buňky
    cell.innerHTML = ''; // vyčistíme, protože přesouváme původní link + badges
    cell.appendChild(wrapper);
  });
}

(function () {
  'use strict';

  // Watch for changes on release list
  var mutationConfig = {
    attributes: false,
    childList: true,
    subtree: true,
  };

  // Watch for changes in table
  const debouncedAddImages = debounce(addImages, DEBOUNCE_TIMER);

  function mutationCallback(mutationsList) {
    for (var mutation of mutationsList) {
      if (mutation.type == 'childList') {
        // Check if any addedNodes have a 'data-preview-image' attribute and not 'processed' class
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && node.querySelector('a[data-preview-image]:not(.processed)')) {
            debouncedAddImages();
            break;
          }
        }
      }
    }
  }

  var observer = new MutationObserver(mutationCallback);
  observer.observe(document.documentElement, mutationConfig);
})();
