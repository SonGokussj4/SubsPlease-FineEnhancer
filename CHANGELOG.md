# Changelog

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
