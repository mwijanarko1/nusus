---
last_mapped: 2026-07-31T00:00:00Z
---

# Codebase Map

## System Overview

Nusus is a Bun workspace with two npm packages and three public surfaces:

1. **SDK** — `nusus` and `nusus/turath` TypeScript exports for Turath retrieval.
2. **Agent CLI** — `nusus` bin → `scripts/search.mjs`, JSONL-first wrappers over the SDK.
3. **Local MCP server** — `nusus-mcp` bin → `mcp/dist/index.js`, five stdio tools backed by the SDK.

All three stay retrieval-only: no madhhab ranking, fatwa logic, hadith grading, or embedded AI.

```text
application ──────────────────────────────┐
                                         ▼
agent / shell ──► scripts/search.mjs ──► dist/  ◄── tsc build of src/
                                         ▲
MCP client ─stdio─► mcp/dist/index.js ───┘
                        ▲
                        └── tsc build of mcp/src/

src/turath/client.ts     live HTTP: search, retrieve, page, book, author
src/turath/catalog.ts    offline findBooks / findAuthors / categories
src/turath/normalize.ts  raw Turath → public models (toc, volumes, …)
src/turath/citations.ts  citation / locator / URL
src/turath/excerpt.ts    match-centered bounded excerpts
src/transport.ts         fetch, timeout, status → NususError
```

## Directory Guide

| Path | Role |
| --- | --- |
| `package.json` | Root `nusus` package, workspace, SDK exports, and CLI bin |
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
| `mcp/package.json` | Separate `nusus-mcp` package metadata and bin |
| `mcp/src/index.ts` | MCP stdio server, tool schemas, and SDK dispatch |
| `mcp/tests/server.test.ts` | MCP handshake, tool listing, and error contract tests |
| `mcp/README.md` | MCP install, Claude Desktop, tools, and development |
| `docs/endpoints.md` | Checked upstream Turath endpoints |
| `docs/turath-research-SKILL.md` | Agent skill instructions (CLI + SDK + MCP alternative) |
| `docs/plan.md` | Original product plan (historical, with shipped-state notes) |
| `docs/chat-log.md` | Early design chat export (historical) |
| `README.md` | Install, SDK, CLI, MCP, limitations, and development |

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

### MCP research

An MCP client starts `nusus-mcp` and communicates over stdio. The server imports `nusus` / `nusus/turath` directly and exposes `find_books`, `find_authors`, `retrieve`, `get_context`, and `get_book`. Tool results are JSON text; `NususError` codes are preserved in error results.

### SDK retrieval

`createTurathClient()` → `findBooks` / `search` / `retrieve` / `getContext` / `getBook` …

The CLI and MCP server use the same retrieval rules; citations and locators come from `citations.ts`.

### Build / test / package

- `bun install` installs the workspace, but Bun resolves `mcp`'s `nusus` dependency from npm because the SDK package is the workspace root. During a version bump, publish the root package before expecting a fresh install to resolve it.
- `bun run build` → root `dist/`; `(cd mcp && bun run build)` → `mcp/dist/`.
- `bun test` runs the root suite; `(cd mcp && bun run test)` builds and runs the MCP suite.
- Both packages run their own build in `prepack`.
- Root package `files`: `dist`, `scripts/search.mjs`, `README.md`, `LICENSE`; it does not publish `mcp/`.
- MCP package `files`: `dist`, `README.md`, `LICENSE`.
- Publish explicitly in dependency order: root `nusus` first, then `mcp/`; do not use an unordered bulk workspace publish.
- CLI tests call `ensureDist()` so clean checkouts work before a manual build; CI builds before tests.

### Catalog refresh

- Authors: official `GET /author` only, resumable via `scripts/refresh-catalog.mjs authors`.
- Books: fail-closed without a verified bulk listing endpoint.

## Known Risks

- Offline book discovery is snapshot-bound (March 2026, 8,124 books); upstream additions may be missing until refresh.
- Turath has no verified bulk book-list endpoint; do not scrape or import third-party catalogs.
- Live search filters accept **one ID per filter type** (upstream limit); offline `find-books` allows repeated author/category filters.
- `page-id` is internal Turath page, not printed page.
- Browser/CORS support is not claimed.
- CLI and MCP bins depend on built output; build (or rely on test/prepack auto-build) before packaging.
