---
name: turath-research
description: Search and cite classical Islamic and Arabic heritage texts (hadith, fiqh, tafsir, biography, books, authors) from the Turath library using the nusus CLI. Use when the user wants sourced passages, citations, or book/author lookups from classical sources.
---

# Turath Research

Use this skill when the user asks an Islamic, Arabic heritage, fiqh, tafsir, hadith, biography, book, citation, or classical-source research question and wants sourced retrieval from Turath (`https://api.turath.io/`).

## Requirements

Run the [`nusus`](https://github.com/mwijanarko1/nusus) CLI from npm. It needs a shell, Node.js 20+, and network access to `registry.npmjs.org` and `api.turath.io`.

```bash
npx -y nusus@0.7.2 --version
```

If the shell, Node.js, or network is unavailable, tell the user plainly that Nusus can't run in this environment. Never answer from memory as if it came from Turath, and never invent passages, page numbers, or links.

In the commands below, `nusus` means `npx -y nusus@0.7.2`.

## Commands

```bash
# Discover (offline catalog, no network to Turath)
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

Run `nusus <command> --help` for flags.

Default stdout is JSONL (one object per line, camelCase, every line has `type`). Use `--format text` for compact lines. Errors are JSON on stderr only. Unknown or inapplicable flags are rejected.

Record types: `meta` (first line of find-books/find-authors/search/retrieve/get-pages/find-toc), `passage`, `toc-entry`, `book`, `author`, `category`, `catalog`. Offline finders report `returned`; live `search`/`retrieve` report `totalMatches`.

Exit codes: `0` success (including zero hits), `1` usage/invalid, `2` not found, `3` rate limit/HTTP/invalid response/timeout/internal.

## Gotchas

- `--page-id` is Turath's internal page (`location.internalPage`), not the printed page (`location.printedPage`). Never derive one from the other; the mapping is book-specific.
- `search`/`retrieve` accept at most one ID per filter (`--book-id`, `--author-id`, `--category-id`). Different filters may be combined. For several books, run separate searches.
- `find-books`/`find-authors`/`list-categories` use a bundled March 2026 catalog snapshot (8,124 books, 3,037 authors) and may miss later additions.
- Book titles can be ambiguous: resolve with `find-books`, then pass a concrete `--book-id`.
- Search index coverage varies. Some foundational texts (Mudawwanah 587, Muwatta' 1699) may not appear for topic queries. Before reporting "not found", check the book's headings with `get-book` or `find-toc`.
- `--timeout <ms>` defaults to 15000; `0` means no timeout (max 600000).

## Retrieval Workflow

1. **Plan:** extract Arabic keywords, include variant spellings.
2. **Scope:** `find-books` / `find-authors` / `list-categories`, then lock IDs.
3. **Search:** `search` or `retrieve`, with optional single-ID filters.
4. **Read context:** `get-page`, `get-pages`, `get-context`, `find-toc`, or `get-book` as needed.
5. **Assess:** prefer direct mentions, primary sources, chapter headings, and stated legal context.
6. **Answer:** quote Arabic where useful and cite every claim.

## Citing

Every passage includes `citation`, `url` (Turath), and `alternateUrls` (such as Shamela). In answers:

- Quote retrieved text exactly; mark any translation as your translation.
- Give the citation (author, book, volume, printed page) and a link for each quoted passage.
- Keep these separate: what the source says, what can be concluded from it, and where interpretation, madhhab differences, or hadith grading are uncertain.

## Limits

Treat Turath as a retrieval layer, not a final authority. Nusus does not grade hadith: a returned isnad is text to inspect, not a verdict. Avoid issuing fatwas; for personal religious practice, recommend a qualified scholar, especially on disputed or high-stakes questions.
