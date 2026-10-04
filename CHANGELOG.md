# Changelog

## [1.9.0] - 2026-10-04

### Added
- **Test suite.** `make test` runs 100 checks across 9 specs, driving the real userscript in Chromium against a fake subsplease.org, AniList and GitHub Gist — no network, no real tokens. `make bootstrap` installs everything, `make doctor` verifies the environment, `make check` runs syntax, metadata and type checks.
- **Storage schema migrations.** Favorites, title overrides and cached ratings are keyed by the title parser, so changing it used to silently orphan data. Migrations are now numbered and registered in one place, run once at startup, and are also applied to data arriving from sync — a device on an older script can no longer push stale keys back. The gist payload records its schema version.

### Changed
- The rating cache is capped (3000 entries, newest kept) and entries untouched for ~6 months are dropped — on every write, not just during sync.
- Expired favorite tombstones are pruned on every save.
- The in-memory element registry no longer grows without limit on large listings.

### Fixed
- **A full browser storage quota failed silently**: ratings simply stopped being remembered. The cache now sheds its oldest half and retries, and tells you if it still cannot save.
- An error message is no longer immediately overwritten by routine progress messages, so a storage failure isn't buried by "Ratings updated".
- `make` targets all failed with "No such file or directory": the Makefile set `SHELL` to `/usr/bin/env bash`, which GNU Make looks up as a single filename.
- The README's dev-wrapper snippet was missing `@grant GM_openInTab` and `@connect arm.haglund.dev` and still granted `GM_addStyle` — exactly the drift the README warns about. `make check` now verifies it automatically.
- Dropped the unused `GM_addStyle` grant from the userscript header.

## [1.8.0] - 2026-10-04

### Added
- **AniList match picker**: N/A ratings now show a 🔍 button that opens a dialog with AniList's top matches (title, year, format, score) — click the right one instead of typing a name blind. The match is pinned by **AniList id**, so it can't drift, and it syncs across devices. Right-clicking a rating still opens the same dialog.
- **Opt-in ratings-cache sync**: a checkbox in Settings shares the cached ratings through the same private gist, so a second device reuses lookups the first already paid AniList's rate limit for. Off by default; capped at 3000 entries to keep the gist small.
- **AniDB link**: a small aniDB tag after each rating. Opens the exact AniDB page (AniList → AniDB id via arm.haglund.dev), or an AniDB title search when the id is unknown.

### Changed
- **Ratings are cached far longer and refreshed in the background.** The TTL is now based on the show's AniList airing status: 7 days for finished shows, 12h for currently airing ones, 24h for "not found" (so a mismatched title retries daily). A cached score now stays on screen — dimmed — while it refreshes, instead of blanking to `…`.
- `/shows/` now displays any cached score it has, even a stale one, rather than showing `–` until refetched.
- The AniDB link now uses the legacy `animedb.pl` search endpoint (`?adb.search=<Title>&show=animelist&do.search=search`, spaces as `+`), which returns the full result list — the newer `/search/anime/` page did not match the same way.
- The badge now reads **aniDB** in the site's own wordmark colours (dark navy plate, light "ani", orange "DB") instead of a muted "aDB".

### Fixed
- A stale cached rating on `/shows/` rendered nothing instead of the known score.
- **Title parsing for specials and mixed episodes.** These used to be sent to AniList whole (N/A or a wrong match):
  - decimal / recap episodes `— 12.5`, mixed ranges `— 01 + 02`, `— 12.5-13`
  - specials `— OVA`, `— OAD`, `— ONA`, `— SP1`, `— Special`, `— Movie`, `— Recap`
  - trailing notes `(END)`, `(Movie)`, `[Director's Cut]` (a `(2024)` year is kept)
  - `S2 Part 2` → `2nd Season Part 2`; correct `11th`/`12th`/`13th` suffixes
- **Line-wrapped titles.** Line breaks inside long release titles were kept in the title, so the same show had different keys on the releases page and `/shows/` (favorites didn't match, AniList got a mangled search). Whitespace is now collapsed.
- Existing favorites and custom AniList titles (local and synced) are migrated to the corrected keys automatically.

## [1.7.0] - 2026-07-24

### Fixed
- **Releases page fired one AniList request per row at once** (~20 concurrent on load), which alone could trip the rate limit and cause the N/A flakiness. All rating fetches — both pages — now go through a single paced, batched queue.
- **A failed fetch could permanently wedge the rating queue**: the queue runner had no `try/finally`, so one unexpected error left it "running" forever and every later click silently did nothing. It now always resets.
- A missing/undefined fetch result threw a `TypeError` while rendering, aborting the queue mid-run and leaving badges stuck on `…`. Missing results now render a retryable N/A.
- Unhandled promise rejections from rating refreshes are now caught.
- `ensureStyles()` no longer throws if called before `<head>` exists.

### Added
- **Live status pill** (bottom-right) showing what the script is doing: `Fetching ratings… 12/40`, `Ratings updated (12)`, sync results, and errors.
- **Rate-limit countdown**: a 429 now shows `AniList rate limit — resuming in 45s` instead of looking frozen.
- Pending rating badges **pulse** while loading, so `…` clearly reads as in-progress.
- `/shows/` fetch buttons show a **busy state** while the queue drains (filter/search stay usable); pressing a letter with nothing to do says `All ratings already up to date`.
- Background syncs stay silent, but a sync that **pulls in favorites from another device** announces itself; sync failures replace the old blocking `alert()` with a toast.
- All animations respect `prefers-reduced-motion`.

## [1.6.4] - 2026-07-23

### Fixed
- Ratings still settled back to N/A on `/shows/` and single clicks were flaky: the flaky single clicks were AniList **rate limiting** (~30 req/min), and 429 / partial-error responses were still treated as "not found". Now:
  - When AniList rejects a batch (query complexity), the script switches to **one-by-one requests** for the rest of the session instead of repeatedly retrying doomed batches.
  - Sequential requests are **paced at ~28/min** to stay under the rate limit, and ratings fill in progressively as each arrives.
  - **HTTP 429** is honored: the script waits for the `Retry-After` window and retries instead of caching N/A.
  - **HTTP 200 responses that carry a GraphQL `errors` array** (partial failures) are no longer cached as N/A — only a clean response with no errors counts as a real "not found".

## [1.6.3] - 2026-07-23

### Fixed
- Bulk rating fetches on `/shows/` silently produced N/A: AniList rejects large aliased queries (query complexity limit), and the rejected response was being cached as "not found". Whole-request failures (complexity, rate limit, server errors) are now detected, never cached, and rejected batches automatically split in half until they fit. Default batch size lowered to 5.

## [1.6.2] - 2026-07-23

### Fixed
- "Fetch all ratings" and the letter-section buttons on `/shows/` now retry shows whose cached result was "not found" (they previously stayed stuck as N/A until clicked individually)
- Shows whose rating was never fetched now display "–" instead of a misleading "N/A" — N/A now always means AniList really had no result

## [1.6.1] - 2026-07-23

### Added
- Configurable rating color thresholds (gray/red/orange boundaries, green above) in Settings — synced across devices, ratings recolor immediately on save
- **Right-click a rating badge** to set a custom AniList search title — for shows whose SubsPlease romanization AniList doesn't know (e.g. Korean series like *Toukutsu Ou* = *Tomb Raider King*). Overrides sync across devices.

### Changed
- Settings dialog decluttered: the Gist sync setup is now a collapsed section with a compact status indicator (🟢/🔴/⚪) in its header
- Freshly airing shows no longer show N/A: falls back to AniList `meanScore` when `averageScore` doesn't exist yet (needs enough votes)

## [1.6.0] - 2026-07-23

### Added
- **Cross-device sync**: favorites and settings sync via a private GitHub Gist (token with `gist` scope only). Star a show at work, see it starred at home. Two-way merge by timestamp — the newest action per show wins, deletions carried as tombstones so nothing resurrects.
- Sync section in the settings dialog (token input, status, Sync now, Disconnect) plus a "Sync now" Tampermonkey menu command
- Export / Import favorites + settings as JSON from the settings dialog
- `/shows/` page: search box to filter shows and a "★ Favorites only" toggle (empty letter sections hide automatically)

### Changed
- **Much faster ratings**: AniList requests are now batched (10 titles per GraphQL request via aliases) — "Fetch all ratings" is ~10x faster
- Rating cache is kept in memory (localStorage parsed once, written through) instead of re-parsed on every lookup
- Settings dialog restyled and now respects the site's dark theme
- Thumbnails load lazily; favorite stars have slightly larger click targets
- "Clear all favorites" no longer reloads the page and now syncs the clear to other devices
- Removed per-title `console.debug` noise from `normalizeTitle`

### Fixed
- `Makefile` pointed at the old script path (`src/subsplease-imgpreview.js`)

## [1.5.0] - 2026-05-27

### Fixed
- Season markers like `S2`, `S3` are now converted to AniList's naming convention (`2nd Season`, `3rd Season`) before lookup, fixing N/A ratings for multi-season shows (e.g. *Quanzhi Fashi S7*, *Wistoria S2*)
- N/A rating tooltip now distinguishes between "Not found on AniList" and "Connection error"

## [1.4.1] - 2025-??-??

### Added
- Favorites and color-coded ratings on the `/shows/` listing
- Section-based fetch buttons toolbar on the shows page (fetch all, or by letter group)
- Favorites-first auto-fetch: ratings load automatically for favorited shows on the shows page

### Fixed
- `normalizeTitle` now strips version markers (e.g. `01v2`) and batch episode ranges

## [1.3.2] - 2025-??-??

### Fixed
- `normalizeTitle` handles version markers in episode numbers

## [1.3.1] - 2025-??-??

### Changed
- Project renamed to SubsPlease Fine Enhancer

## [1.3.0] - 2025-??-??

### Added
- Favorite stars for schedule widget (left column airtime shows)
