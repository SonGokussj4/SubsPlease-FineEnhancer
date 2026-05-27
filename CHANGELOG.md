# Changelog

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
