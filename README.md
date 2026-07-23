# SubsPlease ImgPreview

A TamperMonkey script that adds image preview functionality to the [SubsPlease](https://subsplease.org/) anime streaming site.

## Features
- Image previews for anime releases
- AniList ratings displayed alongside releases (batched requests — fast even for the whole `/shows/` list)
- Click to refresh ratings
- Favorites with visual highlights on the main page, schedule widget, and `/shows/` listing
- **Cross-device sync** of favorites + settings via a private GitHub Gist (star a show at work, see it at home)
- Search box and "★ Favorites only" filter on the `/shows/` page
- User-configurable image sizes
- Dark-theme-aware settings dialog with export/import of favorites
- Gradient overlay for better text visibility of favorite shows

## Installation
1. Install [TamperMonkey](https://www.tampermonkey.net/) extension for your browser.
2. Go to https://greasyfork.org/cs/scripts/551548-subsplease-fine-enhancer and click "Install this script".
3. Enjoy enhanced browsing on SubsPlease!

## Cross-device sync (GitHub Gist)

Favorites and settings can sync between browsers/machines through a **private Gist** in your own GitHub account. Setup (once per device):

1. Create a GitHub personal access token with **only the `gist` scope**:
   GitHub → Settings → Developer settings → Personal access tokens → Generate new token (classic) → check `gist` only.
2. On subsplease.org, open the Tampermonkey menu → **Settings**, paste the token into the *Sync* field, and click **Sync now** (or Save).
3. Repeat on your other device with the same token. The script finds (or creates) the gist `subsplease-fineenhancer-sync.json` automatically.

How it works:
- Syncs automatically on page load and a couple of seconds after you star/unstar a show; you can also trigger it via the **Sync now** menu command.
- Conflicts merge **by timestamp** — the newest add/remove per show wins, so starring at work and at home on the same day keeps both.
- Removals are stored as tombstones (kept 90 days), so a deleted favorite won't come back from an older device.
- **Disconnect** in Settings removes the token from that browser; the gist itself stays in your GitHub account.

## Screenshots

### **Main Page (Add thumbnails, Ratings (+ cached), Favorites)**

![Preview](images/main_page.jpg)

### **Thumbnail Sizes (User-configurable: 64px, 128px, 225px)**

![Sizes](images/thumbnail_sizes.jpg)

### **Airtime Favorites**

![Airtime Favorites](images/airtime_favorites.jpg)

### **Settings Dialog (Change thumbnail sizes, Clean favorites)**

![Settings](images/settings.jpg)

## DEVELOPMENT

### Chrome / Opera

```js
// ==UserScript==
// @name         [DEV] SubsPlease Fine Enhancer
// @match        https://subsplease.org/*
// @require      file:///C:/PATH/TO/YOUR/REPO/src/subsplease-fine-enhancer.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      graphql.anilist.co
// @run-at       document-start
// ==/UserScript==
```

### Firefox

There has to be more steps for Firefox

1. Navigate to the `src` folder where the `subsplease-fine-enhancer.user.js` file is located.
2. Run a local server in that directory. You can use Python's built-in HTTP server for this:
   - python: `python3 -m http.server 8080`
   - node: `npx http-server -p 8080`
3. Important: Open the Tampermonkey Dashboard, go to
   - Settings -> Externals -> Update Interval and set it to Always.
   - Otherwise, Tampermonkey will cache your code and your saves won't show up on refresh.
4. Create a new script in Tampermonkey and use the following header:

```js
// ==UserScript==
// @name         [DEV] SubsPlease Fine Enhancer
// @match        https://subsplease.org/*
// @require      http://localhost:8080/subsplease-fine-enhancer.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      graphql.anilist.co
// @run-at       document-start
// ==/UserScript==
```
