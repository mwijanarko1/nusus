# Nusus

TypeScript SDK for searching and citing classical Islamic and Arabic texts through [Turath](https://app.turath.io/), a Shamela-style digital library. Use Nusus to retrieve source text, metadata, citations, locators, and direct links from Arabic heritage books for research tools and AI agents.

```bash
npm install nusus
# or
bun add nusus
```

```ts
import { createTurathClient } from "nusus/turath";

const turath = createTurathClient({ timeout: 10_000 });
const books = turath.findBooks("الأربعون النووية");
const authors = turath.findAuthors("النووي");
const categories = turath.listCategories();
const catalog = turath.getCatalogMetadata();
const results = await turath.search("إنما الأعمال بالنيات", {
  bookIds: [147927],
});
const context = await turath.getContext(results.items[0]);

console.log(context.text);
console.log(context.citation);
console.log(context.locator);
console.log(context.url);
```

Agent-ready retrieval is one call. By default each hit is a single page with a match-centered excerpt; adjacent pages are opt-in:

```ts
const context = await turath.retrieve("النية", {
  maxPassages: 5,
  maxCharsPerPassage: 2_000,
  // pagesBefore: 1,
  // pagesAfter: 1,
});

for (const passage of context.passages) {
  console.log(passage.citation); // includes تراث bookId + صفحة تراث
  console.log(passage.locator); // { bookId, internalPage, url, ... }
  console.log(passage.provenance); // rank, truncation, scope, ...
}
```

All requests support `AbortSignal`; failures use the exported `NususError` codes. Source text is returned unchanged. Search filters currently accept one Turath ID each because that is all the upstream API has verified. The core SDK is retrieval-only: no madhhab ranking, fatwa logic, or hadith grading.

## Agent CLI

```bash
npx nusus "إنما الأعمال بالنيات" 3
npx nusus --book-id 147927 "النية" 3
npx nusus --page 147927 5

# Bun
bunx nusus "إنما الأعمال بالنيات" 3
```

The CLI emits JSON Lines with passage text, source metadata, citations, and direct Turath URLs. It also supports `--madhhab hanafi|maliki|shafii|hanbali` and `--books "title one,title two"`.

## Known limitations

Book and category discovery uses a bundled snapshot of 8,124 Turath books scanned in March 2026 because Turath does not expose verified catalog endpoints. Newly added or changed upstream records may therefore be absent until the snapshot is refreshed.

Offline author discovery uses an ID→name map verified via official `GET /author` only (no fabricated names), plus live `getAuthor()` for full metadata. `getCatalogMetadata()` reports known book/author ID counts, resolved offline names, and unresolved author IDs. Re-hydrate or resume with `bun scripts/refresh-catalog.mjs authors` (resumable, rate-limit aware). Book listing refresh is fail-closed: `bun scripts/refresh-catalog.mjs books` refuses unofficial sources.

Browser support is not claimed because the checked API responses do not advertise CORS support.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build

# optional live contract (also scheduled via GitHub Actions)
bun run test:live

# official-API catalog tooling
bun scripts/refresh-catalog.mjs authors --limit 10
bun scripts/refresh-catalog.mjs books   # fails closed on purpose
```
