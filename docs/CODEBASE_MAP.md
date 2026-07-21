---
last_mapped: 2026-07-21T01:11:50Z
---

# Codebase Map

## System Overview

Nusus is one npm package (`nusus`) with two surfaces:

1. **SDK** — TypeScript library (`nusus`, `nusus/turath`) for Turath retrieval.
2. **Agent CLI** — `nusus` bin → `scripts/search.mjs`, JSONL-first wrappers over the SDK.

Both stay retrieval-only: no madhhab ranking, fatwa logic, hadith grading, or embedded AI.

```text
agent / shell
    │
    ▼
scripts/search.mjs  (bin: nusus)
    │  imports built JS
    ▼
dist/  ◄── tsc build of src/
    │
    ├── turath/client.ts     live HTTP: search, retrieve, page, book, author
    ├── turath/catalog.ts    offline findBooks / findAuthors / categories
    ├── turath/normalize.ts  raw Turath → public models (toc, volumes, …)
    ├── turath/citations.ts  citation / locator / URL
    ├── turath/excerpt.ts    match-centered bounded excerpts
    └── transport.ts         fetch, timeout, status → NususError
```

## Directory Guide

| Path | Role |
| --- | --- |
| `src/index.ts` | Root package exports: errors + public model types |
| `src/models.ts` | Shared domain types (`Book`, `Passage`, `BookTocEntry`, …) |
| `src/errors.ts` | `NususError` + codes |
| `src/transport.ts` | HTTP transport used by the Turath client |
| `src/turath/client.ts` | Public `createTurathClient()` API |
| `src/turath/catalog.ts` | Offline catalog queries + metadata |
| `src/turath/catalog-data.ts` | Bundled book/category snapshot |
| `src/turath/catalog-authors.ts` | Official `GET /author` name map |
| `src/turath/normalize.ts` | Response normalization (incl. TOC/volumes) |
| `src/turath/citations.ts` | Citations, locators, source URLs |
| `src/turath/excerpt.ts` | Match-window excerpt engine |
| `src/turath/index.ts` | `nusus/turath` entry |
| `scripts/search.mjs` | **Agent CLI** (`package.json` `bin.nusus`) |
| `scripts/refresh-catalog.mjs` | Official-only catalog refresh tooling |
| `tests/cli.test.ts` | CLI contract tests (builds `dist/` if missing) |
| `tests/client.test.ts` | SDK client + retrieve/provenance |
| `tests/catalog.test.ts` | Offline catalog behavior |
| `tests/fixtures/` | Recorded Turath JSON fixtures |
| `docs/endpoints.md` | Checked upstream Turath endpoints |
| `docs/turath-research-SKILL.md` | Agent skill instructions (CLI + SDK) |
| `docs/plan.md` | Original product plan (historical) |
| `docs/chat-log.md` | Early design chat export (historical) |
| `README.md` | Install, SDK, CLI, limitations, dev |

## Key Workflows

### Agent research loop (CLI)

1. `find-books` / `find-authors` / `list-categories` / `catalog` — offline discovery, lock IDs.
2. `search` or `retrieve` — live full-text with optional single-ID filters.
3. `get-page` / `get-context` / `get-book` / `get-author` — deepen a hit.

Contracts:

- stdout = data (JSONL default; `--format text` optional)
- stderr = one JSON error object
- exits: `0` ok, `1` usage, `2` not found, `3` transport/internal
- offline meta uses `returned`; live search/retrieve meta uses `totalMatches`

### SDK retrieval

`createTurathClient()` → `findBooks` / `search` / `retrieve` / `getContext` / `getBook` …

Same retrieval rules as the CLI; citations and locators come from `citations.ts`.

### Build / package

- `bun run build` → `dist/` (CLI imports `../dist/*`)
- `prepack` builds before publish
- package `files`: `dist`, `scripts/search.mjs`, `README.md`, `LICENSE`
- CLI tests call `ensureDist()` so clean checkouts work before a manual build
- CI builds before tests

### Catalog refresh

- Authors: official `GET /author` only, resumable via `scripts/refresh-catalog.mjs authors`
- Books: fail-closed without a verified bulk listing endpoint

## Known Risks

- Offline book discovery is snapshot-bound (March 2026, 8,124 books); upstream additions may be missing until refresh.
- Turath has no verified bulk book-list endpoint; do not scrape or import third-party catalogs.
- Live search filters accept **one ID per filter type** (upstream limit); offline `find-books` allows repeated author/category filters.
- `page-id` is internal Turath page, not printed page.
- Browser/CORS support is not claimed.
- CLI depends on built `dist/`; always build (or rely on test/prepack auto-build) before packaging.
