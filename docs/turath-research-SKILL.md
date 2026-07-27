---
name: turath-research
description: "Search and cite Islamic and Arabic heritage texts with nusus."
---

# Turath Research

Use this skill when the user asks an Islamic, Arabic heritage, fiqh, tafsir, hadith, biography, book, citation, or classical-source research question and wants sourced retrieval from Turath.

Primary library: [`nusus`](https://github.com/mwijanarko1/nusus) — TypeScript **SDK + agent CLI** for citable context from classical Islamic texts via `https://api.turath.io/`. Requires Node.js `>=20`. Same package version for both surfaces.

## Agent CLI

Prefer the CLI for agent tool calls. After install (`npm i -g nusus` or local checkout):

```bash
nusus --help
nusus --version

# Discover (offline catalog)
nusus find-books "الأربعون النووية" --limit 5
nusus find-books --author-id 44 --limit 10
nusus find-authors "النووي" --limit 5
nusus list-categories
nusus catalog

# Search / retrieve (live)
nusus search "إنما الأعمال بالنيات" --book-id 147927
nusus retrieve "النية في الصلاة" --max-passages 5 --max-chars 2000

# Page / context / metadata (live)
nusus get-page --book-id 147927 --page-id 5
nusus get-pages --book-id 147927 --from 5 --to 7
nusus get-context --book-id 147927 --page-id 5 --pages-before 1 --pages-after 1
nusus get-book 147927
nusus find-toc "الحديث الأول" --book-id 147927 --limit 10
nusus get-author 44
```

Local checkout without global install:

```bash
node ~/Desktop/nusus/scripts/search.mjs --help
# same commands as above with that path instead of `nusus`
```

Default stdout is JSONL (one object/line, camelCase, every line has `type`). Use `--format text` for compact human lines. Errors are JSON on stderr only. Unknown or command-inapplicable flags are rejected.

Record types: `meta` (find-books/find-authors/search/retrieve/get-pages/find-toc first line), `passage`, `toc-entry` (`find-toc`), `book` (optional normalized `toc`/`volumes`), `author`, `category`, `catalog`. Offline finders use `returned` (limit-sliced count); live `search`/`retrieve` use `totalMatches`.

Exit codes: `0` success (including zero hits), `1` usage/invalid, `2` not found, `3` rate limit/HTTP/invalid response/timeout/internal.

`page-id` is Turath internal page (`location.internalPage`), not printed page. `search`/`retrieve` accept at most one ID per filter (`--book-id`, `--author-id`, `--category-id`); filters may be combined. Offline `find-books` may omit the title query when `--author-id` and/or `--category-id` is set (repeatable offline filters). `--timeout 0` means no timeout (max 600000). No madhhab tiers or multi-book fanout.

## SDK Direct Use

For application code or ad-hoc scripts:

```js
import { createTurathClient } from "nusus/turath";

const turath = createTurathClient({ timeout: 15_000 });

// One-call agent retrieval: bounded passages, each with citation + URL
const context = await turath.retrieve("النية في الصلاة", {
  maxPassages: 5,
  maxCharsPerPassage: 2000,
});
for (const p of context.passages) console.log(p.citation, p.url, p.text.slice(0, 200));

// Or step by step
const books = turath.findBooks("الأربعون النووية", { limit: 5 });
const byAuthor = turath.findBooks("", { authorIds: ["44"], limit: 10 });
const categories = turath.listCategories();
const results = await turath.search("<query>", { bookIds: [books[0].id] });
const page = await turath.getPage(147927, 5);
const withContext = await turath.getContext(results.items[0], { pagesBefore: 1, pagesAfter: 1 });
const book = await turath.getBook(147927);   // metadata + indexes/headings (TOC)
const author = await turath.getAuthor(44);
```

All methods accept `AbortSignal`; failures throw typed `NususError` (`NOT_FOUND`, `RATE_LIMITED`, `INVALID_RESPONSE`, `ABORTED`, …) — never string-match error messages.

## API Gotchas

- `getPage(bookId, pageId)` — `pageId` is the INTERNAL `page_id` (`location.internalPage`), NOT the printed page (`location.printedPage`).
- Search filters (`bookIds`, `authorIds`, `categoryIds`) accept ONE ID each — the upstream API supports only one; nusus rejects multiples with `INVALID_ARGUMENT` rather than faking it. Different filter types may be combined.
- Turath has no verified catalog endpoint, so `findBooks()` / `findAuthors()` / `listCategories()` use Nusus's bundled March 2026 snapshot (8,124 books / 3,037 authors). It may omit later upstream changes. `findBooks("", { authorIds })` lists an author's books offline without a title query.
- Empty upstream responses (`200 {}`) surface as `NususError` code `NOT_FOUND`.

## Search Pitfalls

1. **Book titles can be ambiguous** — resolve titles with `find-books` / `findBooks()`, then pass a concrete `--book-id` / `bookIds`.
2. **Search indexing coverage varies** — some foundational texts (Mudawwanah book_id=587, Muwatta' book_id=1699) may not appear for topic queries. Verify negative results via `getBook(id)` `indexes`/headings.
3. **Printed page vs page_id is book-dependent** — non-linear per-PDF mapping; never derive one from the other. Nusus keeps both (`printedPage`, `internalPage`) plus `volume` separately.

## Mudawwanah-Specific (Book ID 587)

1. **Search may not find it** — the API's search index does NOT reliably return the Mudawwanah for topic queries.
2. **Use getBook(587) for TOC** — check headings to see if a topic exists before deep searching.
3. **Topic coverage** — the Mudawwanah records disputed legal questions (مسائل), not recommended acts. Ashura/Arafah-fasting style topics usually have no section; use the Muwatta' or Risala.
4. Use headings (which reference printed pages) as a topic map.

## Mudawwanah Search Fallback

If the Mudawwanah (587) doesn't appear for a Maliki fiqh topic:
1. Check the **Muwatta' of Malik** — dedicated chapters on recommended acts.
2. Check the **Mudawwanah's TOC** via `getBook("587")` / `nusus get-book 587`.
3. Search wiki's raw hadith collections (`~/islam-wiki/raw/bukhari.json`, `muslim.json`, etc.).
4. The **Risala of Ibn Abi Zayd** and its commentaries may be more searchable.

## Core Principle

Treat Turath as a **retrieval layer**, not a final authority. Always distinguish:

1. What the retrieved source says.
2. What can be concluded from it.
3. Where scholarly interpretation, madhhab differences, or hadith grading are uncertain.

Avoid issuing definitive fatwas. For personal religious practice, recommend a qualified scholar/mufti, especially when disputed or high-stakes.

## Retrieval Workflow

1. **Plan the search** — extract Arabic keywords, prefer Arabic terms, include variant spellings.
2. **Discover scope** — `find-books` / `find-authors` / `list-categories`, then lock IDs.
3. **Run Turath search** — `search` or `retrieve` with optional single-ID filters.
4. **Retrieve primary context** — `get-page` / `get-pages` / `get-context` / `find-toc` / `get-book` TOC as needed.
5. **Assess relevance** — prefer direct mentions, primary sources, chapter headings, and stated legal context.
6. **Synthesize cautiously** — quote Arabic when useful, explain uncertainty, never pretend consensus.

## Chain Grading via Turath

When Turath returns a narration with an *isnad*, treat the chain as text to inspect, not a grade. Use a dedicated hadith-grading workflow if reliability must be assessed; nusus does not grade narrations.
