# Nusus — Plan

## 1. Vision

Build a dependable TypeScript SDK **and agent CLI** that give AI agents and applications sourced context from classical Islamic and Arabic heritage texts.

The primary consumer is an agent (tool call, MCP server, RAG pipeline) that needs citable passages within a bounded token budget. Human-facing research apps are supported by the same API. As of `0.4.0`, the package ships a JSONL-first `nusus` CLI (`scripts/search.mjs`) alongside the SDK — see `README.md` and `docs/CODEBASE_MAP.md`.

The first release will target Turath. Shamela support may be added later through a separate provider because Turath and Shamela have different APIs, identifiers, metadata, and search behavior.

The SDK should help developers move from a query to contextualized, citable passages without manually constructing URLs or interpreting raw API responses.

## 2. Goals

- Discover books, authors, and categories without knowing numeric IDs.
- Search Arabic text with clear, typed options.
- Retrieve pages and surrounding context efficiently.
- Return normalized metadata suitable for applications and AI tools.
- Generate stable, transparent citations.
- Provide predictable errors, cancellation, and pagination.
- Run in Node.js, Bun, and modern browsers where upstream CORS permits.
- Preserve access to raw provider data when normalization loses useful details.
- Serve agent retrieval: bounded, source-attributed context suitable for LLM prompts.

## 3. Non-goals for the first release

- Rebuilding the Turath reader application.
- Combining Turath and Shamela into one indistinguishable data source.
- Semantic or vector search.
- Maintaining a complete local mirror of either library.
- Authentication, user accounts, notes, highlights, or synchronization.
- Inventing unsupported search behavior on top of the upstream API.

## 4. Product principles

1. **Citations first:** every passage should retain its source and location.
2. **Provider truth:** do not claim capabilities the upstream provider does not expose.
3. **Normalized but reversible:** expose a clean public model and retain raw data.
4. **Small core:** use native `fetch`, `URL`, `AbortSignal`, and standard errors.
5. **Explicit differences:** provider-specific features remain provider-specific.
6. **Stable public API:** upstream response changes should be contained inside adapters.

## 5. Proposed public API

```ts
import { createTurathClient } from "nusus/turath";

const turath = createTurathClient({
  timeout: 10_000,
});

const books = await turath.findBooks("صحيح مسلم");

const results = await turath.search("إنما الأعمال بالنيات", {
  books: [books[0].id],
});

const passage = await turath.getContext(results.items[0], {
  pagesBefore: 1,
  pagesAfter: 1,
});

console.log(turath.formatCitation(passage));
```

### Initial methods

```ts
createTurathClient(options?)

client.listCategories(options?)
client.findBooks(query, options?)
client.findAuthors(query, options?)
client.getAuthor(id, options?)
client.getBook(id, options?)
client.getPage(bookId, pageId, options?)
client.getPages(bookId, range, options?)
client.search(query, options?)
client.searchAll(query, options?)
client.getContext(result, options?)
client.formatCitation(source, options?)
client.getSourceUrl(source)
```

`searchAll` should be an async iterator so callers can stop early and cancellation can propagate.

### Agent retrieval helper

One additional method designed for LLM consumption:

```ts
client.retrieve(query, {
  maxPassages?: number;      // default 5
  maxCharsPerPassage?: number;
  scope?: { bookIds?; authorIds?; categoryIds? };
  signal?: AbortSignal;
}): Promise<RetrievedContext>

type RetrievedContext = {
  passages: Passage[];       // each with text, headings, location, url, citation
  totalMatches: number;      // so the agent knows what it did not see
  query: string;
};
```

Rules:

- every passage carries its citation and source URL — no orphan text;
- output is bounded and deterministic in ordering, safe to inline into a prompt;
- no metadata is invented; missing fields stay absent;
- source text is never rewritten — normalization applies to the query only.

An MCP server is a thin wrapper over this method and is planned as a separate package once the SDK core is stable (Phase 2+). It is a consumer of Nusus, not part of it.

## 6. Architecture

### 6.1 Overview

```text
Consumer application
        │
        ▼
Public Turath client
        │
        ├── Catalog service
        ├── Search service
        ├── Reading service
        └── Citation formatter
                │
                ▼
        Turath provider adapter
                │
                ├── Response parsing
                ├── Model normalization
                └── Endpoint mapping
                        │
                        ▼
                  HTTP transport
                        │
                        ▼
        api.turath.io / files.turath.io
```

Future Shamela support would be parallel rather than embedded inside the Turath adapter:

```text
Normalized research models
        ▲                    ▲
        │                    │
Turath adapter         Shamela adapter
        │                    │
Turath services        Shamela services
```

### 6.2 Layers

#### Public client

The only layer most consumers use. It coordinates discovery, search, reading, and citations while hiding upstream endpoint details.

Responsibilities:

- accept ergonomic camelCase options;
- validate public inputs;
- return stable public models;
- propagate `AbortSignal`;
- expose provider capabilities explicitly.

#### Domain models

Provider-independent research concepts:

```ts
type Book = {
  id: string;
  provider: "turath";
  title: string;
  author?: AuthorSummary;
  category?: CategorySummary;
  description?: string;
  hasPdf?: boolean;
  raw?: unknown;
};

type Passage = {
  provider: "turath";
  book: BookSummary;
  author?: AuthorSummary;
  location: SourceLocation;
  text: string;
  snippet?: string;
  headings: string[];
  url: string;
  raw?: unknown;
};

type SourceLocation = {
  internalPage?: number;
  printedPage?: number;
  volume?: string;
};
```

IDs are strings publicly so future providers can use non-numeric identifiers. Turath-specific methods may still accept `number | string` for convenience.

#### Provider adapter

Contains all knowledge of Turath endpoints and raw schemas.

Responsibilities:

- map public options to Turath query parameters;
- parse encoded metadata fields;
- normalize snake_case responses;
- detect malformed or changed responses;
- preserve raw responses for advanced consumers.

No Turath URL or raw response type should leak into generic domain logic.

#### HTTP transport

A small wrapper around native `fetch`.

Responsibilities:

- base URLs;
- query serialization;
- timeouts and `AbortSignal` composition;
- JSON decoding;
- response size safeguards where practical;
- typed HTTP errors;
- optional custom `fetch` for testing and alternate runtimes.

Retries should be limited to safe GET requests and transient responses such as 429 and selected 5xx statuses. They should respect `Retry-After` and remain disabled or conservative by default.

#### Citation formatter

A pure module that formats already-normalized metadata. It must never invent missing volume, page, edition, or author information.

Initial outputs:

- structured citation object;
- plain Arabic/English text;
- direct Turath source URL.

Additional academic styles can wait until requested.

### 6.3 Proposed repository structure

```text
src/
  index.ts
  errors.ts
  models.ts
  transport.ts
  turath/
    index.ts
    client.ts
    endpoints.ts
    raw-types.ts
    normalize.ts
    citations.ts
  testing/
    fixtures.ts

tests/
  client.test.ts
  normalize.test.ts
  citations.test.ts
  live.test.ts

docs/
  plan.md
  api.md
  providers.md
```

Keep each module concrete. Do not introduce a generic provider interface until a second provider is actually implemented.

## 7. Error model

```ts
class NususError extends Error {
  code:
    | "INVALID_ARGUMENT"
    | "NOT_FOUND"
    | "RATE_LIMITED"
    | "HTTP_ERROR"
    | "INVALID_RESPONSE"
    | "ABORTED";

  status?: number;
  url?: string;
  retryAfter?: number;
  cause?: unknown;
}
```

Consumers should never need to match error-message strings. Invalid upstream JSON and unexpected response shapes must be reported as `INVALID_RESPONSE`, not as missing resources.

## 8. Search design

### MVP search options

Only options verified against Turath should ship initially:

```ts
type TurathSearchOptions = {
  authorIds?: Array<number | string>;
  bookIds?: Array<number | string>;
  categoryIds?: Array<number | string>;
  page?: number;
  sort?: "relevance" | "page";
  signal?: AbortSignal;
};
```

If Turath only supports one ID per filter, the client may perform bounded parallel requests and merge results, but this behavior must be documented and deterministic.

### Later search capabilities

Investigate before implementation:

- exact phrases;
- required and excluded words;
- diacritic sensitivity;
- Arabic letter normalization;
- proximity and ordering;
- author century ranges;
- morphological search.

Shamela documents richer search behavior, but those features must not be presented as Turath capabilities without verification.

## 9. Reliability and testing

### Unit tests

Use saved fixtures for:

- raw response parsing;
- metadata JSON decoding;
- normalization;
- URL construction;
- citation formatting;
- error mapping;
- pagination.

### Contract tests

Maintain representative raw Turath responses as fixtures and assert only stable structural requirements. Fixtures should document when and from which endpoint they were captured.

### Live smoke tests

Run separately from the default test command. Keep them small:

- one catalog request;
- one search;
- one page lookup;
- one expected missing resource.

Do not assert mutable timestamps, exact global result counts, or that a particular disposable record exists forever.

### Verification commands

```bash
bun test
bun run test:live
bun run typecheck
bun run lint
bun run build
```

## 10. Packaging

- TypeScript-first ESM package.
- Explicit `exports` map.
- Export public types and errors.
- Include source maps and declaration files.
- Use native web APIs rather than Node-only utilities.
- Support the oldest maintained Node.js version that provides the required web APIs.
- Test Bun and Node.js in CI; add browser verification once CORS behavior is confirmed.

Proposed exports:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./turath": "./dist/turath/index.js"
  }
}
```

Do not add a CommonJS build unless actual users require it.

## 11. Delivery phases

### Phase 0 — Upstream investigation

- Record all confirmed Turath endpoints and query parameters.
- Capture representative responses and edge cases.
- Confirm CORS, rate limits, pagination, and terms of use.
- Determine whether catalog discovery endpoints are publicly available.
- Document identifier and page-number semantics.

**Exit criterion:** a checked endpoint matrix and fixture set.

### Phase 1 — Reliable core

- Create package and build configuration.
- Implement transport, cancellation, timeout, and errors.
- Implement raw parsing and normalized models.
- Implement `getAuthor`, `getBook`, `getPage`, and `search`.
- Add fixture-based tests and one separate live smoke suite.

**Exit criterion:** stable typed retrieval with deterministic tests.

### Phase 2 — Research workflows

- Add catalog discovery.
- Add async search pagination.
- Add page ranges and surrounding context.
- Add source URLs and citation formatting.
- Improve documentation with runnable examples.

**Exit criterion:** a user can discover a book, search it, retrieve context, and cite a passage without constructing URLs manually.

### Phase 3 — Production hardening

- Measure upstream failure and latency patterns.
- Add conservative retry and optional caching if measurements justify them.
- Add response-size and concurrency safeguards.
- Verify Node.js, Bun, and browser compatibility.

**Exit criterion:** predictable behavior under cancellation, transient failure, pagination, and large responses.

### Phase 4 — Shamela investigation

- Confirm official API access, authentication, terms, and data formats.
- Map Shamela books, authors, categories, pages, and search semantics.
- Determine whether cross-provider identity mapping is reliable.
- Implement a separate Shamela adapter only after this investigation.

**Exit criterion:** an evidence-backed decision on whether Shamela belongs in this package or a separate package.

## 12. Shamela integration policy

Turath and Shamela must remain distinct providers:

- never assume their book or author IDs match;
- retain the provider on every normalized entity;
- do not merge editions solely because titles look similar;
- expose provider-specific search options separately;
- use explicit cross-provider mappings with provenance and confidence if mappings are later added.

Possible future API:

```ts
import { createShamelaClient } from "nusus/shamela";

const shamela = createShamelaClient({ apiKey: process.env.SHAMELA_API_KEY });
```

Nusus remains provider-neutral while each integration stays explicit through provider-specific exports.

## 13. Key risks

| Risk | Mitigation |
| --- | --- |
| Undocumented Turath API changes | Isolate raw schemas in one adapter and run live smoke tests. |
| Catalog records disappear or change | Avoid brittle IDs and mutable-value assertions in tests. |
| Ambiguous page numbering | Preserve internal page, printed page, volume, and headings separately. |
| Incorrect citations | Format only known metadata and expose missing fields explicitly. |
| Upstream rate limiting | Add cancellation, bounded concurrency, and respectful optional caching. |
| Provider licensing or access restrictions | Review terms before mirroring, bulk download, or Shamela integration. |
| Arabic normalization alters quotations | Normalize queries only; preserve original source text in results. |

## 14. MVP success criteria

The first useful release is complete when a developer can:

1. install the package and create a client;
2. discover a Turath book or author by name;
3. search within the library or a selected scope;
4. iterate through results safely;
5. retrieve a result with adjacent context;
6. display its book, author, headings, volume, and page information;
7. generate a direct source URL and non-invented citation;
8. call `retrieve()` once and get bounded, citation-carrying passages ready for an LLM prompt;
9. handle missing records, rate limits, cancellation, and malformed responses through typed errors;
10. run deterministic tests without depending on the live Turath catalog.

## 15. First implementation milestone

Start with Phase 0. Before writing the client, produce an endpoint matrix containing:

```text
Endpoint | Purpose | Parameters | Pagination | Response fixture | Failure behavior
```

This investigation determines what the MVP can honestly support and prevents designing an API around assumptions borrowed from Shamela.
