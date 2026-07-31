# Checked Turath endpoints

Checked 2026-07-15 against `api.turath.io`, using API version `3`.

These endpoints back the SDK client, the `nusus` agent CLI (`search`, `retrieve`, `get-page`, `get-book`, `get-author`), and the live `nusus-mcp` tools (`retrieve`, `get_context`, `get_book`). Offline CLI discovery (`find-books`, `find-authors`, `list-categories`, `catalog`) and MCP discovery (`find_books`, `find_authors`) use the bundled snapshot, not a live catalog API.

| Endpoint | Purpose | Parameters | Pagination | Fixture | Failure behavior |
| --- | --- | --- | --- | --- | --- |
| `GET /author` | Author metadata | `id`, `ver=3` | None | `author-44.json` | Unknown ID: `200 {}` |
| `GET /book` | Book metadata/indexes | `id`, `include=indexes`, `ver=3` | None | `book-147927.json` | Unknown ID: HTTP 404 |
| `GET /page` | One internal page | `book_id`, `pg`, `ver=3` | None | `page-147927-5.json` | Unknown book/page: `200 {}` |
| `GET /search` | Full-text search | `q`, `page`, `author`, `book`, `cat_id`, `sort=page_id`, `ver=3` | `page`, 1-based; fixed server page size | `search-book-147927.json` | Empty matches: `200` with empty `data` |
| `GET files.turath.io/books/{id}.json` | Historical full-book dump | Path ID | None | None | HTTP 404 for all checked known IDs |

Representative live URLs:

- <https://api.turath.io/author?id=44&ver=3>
- <https://api.turath.io/book?id=147927&include=indexes&ver=3>
- <https://api.turath.io/page?book_id=147927&pg=5&ver=3>
- <https://api.turath.io/search?q=%D8%A7%D9%84%D8%A5%D8%B3%D9%84%D8%A7%D9%85&book=147927&ver=3>

## Confirmed response details

- `/author` returns a structured object (`id`, `name`, `biography`, `death`), not the `{ info }` shape used by older clients.
- `/page` and each `/search` item encode `meta` as a JSON string.
- Search exposes a total `count`; observed pages contain about 20 items.
- Direct reader URLs use `https://app.turath.io/book/{bookId}?page={internalPage}`.
- No authentication was required for checked endpoints.

## Unsupported or unknown

- `/category`, `/categories`, `/books`, and `/authors` returned 404. Book/category discovery uses a bundled official snapshot; offline author names are a partial map hydrated via `GET /author` only. Bulk book refresh is fail-closed without a verified listing endpoint.
- Multiple IDs per search filter are not supported by the checked upstream contract. Nusus rejects them rather than silently issuing or merging extra requests.
- Search `precision` semantics, rate limits, terms for bulk access, and maximum page are undocumented.
- The checked responses did not include `Access-Control-Allow-Origin`; direct browser support is therefore not claimed.
- The official full-book file host returned 404 for IDs `1`, `158`, `17616`, and `147927`; Nusus does not use an unofficial mirror.
