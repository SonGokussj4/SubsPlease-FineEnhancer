# Changelog

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
