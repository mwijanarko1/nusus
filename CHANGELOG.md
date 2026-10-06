# Changelog

Notable changes to this repository are recorded here. The `nusus` SDK/CLI and
`nusus-mcp` server are independently versioned; each entry names the affected
package.

Dates below are the dates on which the corresponding versions were recorded in
git, not independently verified npm publication dates. The repository has one
tag, `v0.2.0`; later version evidence comes from package manifests and commit
messages.

## Unreleased

## nusus 0.7.2 - 2026-09-05

### Added

- Add package and authentication dry-run scripts for release checks.

### Fixed

- Deduplicate page-fetch promises within each retrieval so overlapping contexts
  fetch each unique book page once while preserving passage content, segments,
  and citations.

## nusus-mcp 0.2.2 - 2026-09-05

### Changed

- Depend on `nusus ^0.7.2` so MCP retrievals inherit page-fetch
  deduplication, and synchronize the advertised server version.

## nusus 0.7.1 - 2026-08-29

### Changed

- Add strict Oxlint checks for unsafe TypeScript patterns.

### Fixed

- Harden decoding and normalization of Turath responses against malformed JSON,
  invalid optional fields, and prototype-based input attacks.

## nusus-mcp 0.2.1 - 2026-08-29

### Changed

- Depend on `nusus ^0.7.1` and tighten MCP argument and response typing.

## nusus 0.7.0 - 2026-08-09

### Added

- Add `alternateUrls.shamela` to passages and multi-page segments when a Turath
  internal page ID is available, while retaining the Turath URL as primary.
- Export `getShamelaUrl` and include alternate links in CLI JSONL and text
  output.

## nusus-mcp 0.2.0 - 2026-08-09

### Added

- Support both legacy MCP clients and clients pinned to protocol revision
  `2026-07-28` (`ab78fcf`).
- Pass Shamela alternate links through passage-producing tool results.

### Changed

- Move to the MCP 2.0 server package and depend on `nusus ^0.7.0`.
- Keep the advertised server version in sync with the package manifest.

### Fixed

- Preserve a failing process exit status when the stdio server reports an error
  (`1c3f68e`).

## nusus 0.6.2 - 2026-08-08

### Fixed

- Ship the CLI entry script with executable permissions (`986be00`).

## nusus-mcp 0.1.2 - 2026-08-08

### Changed

- Update the runtime dependency to `nusus ^0.6.2` (`bd867d3`).

## nusus 0.6.1 - 2026-08-02

### Added

- Add normalized Arabic search fallbacks and report the effective query used.
- Add per-page segments, offsets, citations, locators, and URLs to multi-page
  context.

### Fixed

- Keep `retrieve()` output bounded around the matching text, omit upstream
  `raw` payloads from agent-facing output, and preserve search-hit provenance
  and metadata.
- Reuse fallback queries during pagination, avoid changing ta marbuta during
  fallback normalization, and strip presentation tags without deleting
  literal Arabic angle-bracket text (`feed718`, `dff446b`).

## nusus-mcp 0.1.1 - 2026-08-02

### Fixed

- Omit upstream `raw` payloads from MCP responses and depend on `nusus ^0.6.1`
  (`feed718`, `dff446b`).

## nusus 0.6.0 - 2026-07-31

### Changed

- Document and package the SDK, CLI, and MCP server as separate interfaces.
- Separate the MCP package from the root workspace so root CI does not try to
  resolve an unpublished SDK dependency; document independent MCP installation
  and testing (`5378b9f`, `c6c6e93`).

## nusus-mcp 0.1.0 - 2026-07-31

### Added

- Introduce the local stdio MCP server with `find_books`, `find_authors`,
  `retrieve`, `get_context`, and `get_book` tools, backed by `nusus ^0.6.0`
  (`5378b9f`).

## Changes with no supported release mapping

Commit `5378b9f` says that **nusus 0.5.0** had already been published, but no
commit or tag in this repository records a `0.5.0` manifest. The following
changes occurred after the `0.4.1` manifest commit and before the `0.6.0`
manifest commit, so they are intentionally not assigned to a release here:

### Added

- **nusus:** Add bounded `get-pages` and substring `find-toc` CLI commands for
  table-of-contents navigation (`e371662`).
- **repository docs:** Add OS-specific Node installation guidance and
  paste-ready agent setup instructions (`ba8e25f`, `df10ebf`).

### Changed

- **nusus:** Fetch multi-page context in parallel and avoid a redundant center
  page request (`4ab48cc`).

## nusus 0.4.1 - 2026-07-21

### Added

- Add agent-oriented CLI documentation, endpoint and codebase references, and a
  reusable Turath research skill (`4072556`, `8ebc080`).

## nusus 0.4.0 - 2026-07-21

### Added

- Replace the original search script with a composable subcommand CLI covering
  offline catalog discovery, live search/retrieval, page/context retrieval,
  and book/author metadata (`294e71e`).
- Add JSONL and text output, structured stderr errors, documented exit codes,
  strict argument validation, and normalized book TOC/volume data.

## nusus 0.3.0 - 2026-07-21

### Added

- Expand the bundled catalog with author discovery and catalog metadata.
- Add citation locators, retrieval provenance, optional adjacent-page context,
  and match-centered bounded excerpts (`8c1b9bc`).
- Add offline CI and a scheduled live Turath contract check.

## nusus 0.2.1 - 2026-07-15

### Changed

- Improve npm description and keywords for Turath, Shamela, Arabic books, and
  the TypeScript SDK (`ebd64b5`).

## nusus 0.2.0 - 2026-07-15

### Added

- Add offline book and category discovery from a bundled Turath catalog
  snapshot (`bd65b19`).

This is the only version tagged in git (`v0.2.0`, at `35c1a5d`).

## nusus 0.1.0 - 2026-07-15

### Added

- Initial TypeScript SDK for Turath author, book, page, search, context,
  citation, transport, and error handling APIs (`e4387c4`).
- Initial CLI script, npm package exports and executable metadata, fixture-based
  tests, and optional live tests (`7ae6fc8`, `d83f5bd`).
