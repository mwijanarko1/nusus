import { NususError } from "../errors.js";
import type {
  Book,
  Passage,
  PassageProvenance,
  PassageSegment,
  RetrievedContext,
  RetrieveScope,
  SearchPage,
  TurathId,
} from "../models.js";
import { createTransport, type TransportOptions } from "../transport.js";
import { decoratePassage, formatCitation, getLocator, getShamelaUrl, getSourceUrl, type CitationSource } from "./citations.js";
import {
  findCatalogAuthors,
  findCatalogBooks,
  getCatalogMetadata,
  listCatalogCategories,
} from "./catalog.js";
import {
  decodeAuthor,
  decodeBook,
  decodePage,
  decodeSearch,
  isRecord,
  type JsonValue,
} from "./decode.js";
import { boundText } from "./excerpt.js";
import { normalizeAuthor, normalizeBook, normalizePage, normalizeSearchHit } from "./normalize.js";
import type { RawSearch, RawSearchHit } from "./raw-types.js";

const isString = (value: JsonValue): value is string => typeof value === "string";

export type RequestOptions = { signal?: AbortSignal };

export type TurathSearchOptions = RequestOptions & {
  authorIds?: TurathId[];
  bookIds?: TurathId[];
  categoryIds?: TurathId[];
  page?: number;
  sort?: "relevance" | "page";
};

export type ContextOptions = RequestOptions & {
  pagesBefore?: number;
  pagesAfter?: number;
};

export type RetrieveOptions = RequestOptions & {
  maxPassages?: number;
  maxCharsPerPassage?: number;
  pagesBefore?: number;
  pagesAfter?: number;
  scope?: RetrieveScope;
};

export type TurathClientOptions = TransportOptions;

const id = (value: TurathId, name = "id"): string => {
  const result = String(value);
  if (!/^[1-9]\d*$/.test(result)) throw new NususError("INVALID_ARGUMENT", `${name} must be a positive integer`);
  return result;
};

const integer = (value: number, name: string, minimum = 0): number => {
  if (!Number.isInteger(value) || value < minimum) {
    throw new NususError("INVALID_ARGUMENT", `${name} must be an integer of at least ${minimum}`);
  }
  return value;
};

const searchFallbacks = (query: string): string[] => {
  const normalized = query
    .normalize("NFC")
    .replace(/\u0670/g, "ا")
    .replace(/\p{M}/gu, "")
    .replace(/[إآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ـ/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const variants = [normalized];
  if (/[ءؤئ]/.test(normalized)) {
    variants.push(...["ء", "ؤ", "ئ"].map((hamza) => normalized.replace(/[ءؤئ]/g, hamza)));
  }
  return [...new Set(variants)].filter((candidate) => candidate && candidate !== query);
};

const only = (values: TurathId[] | undefined, name: string): string | undefined => {
  if (!values?.length) return undefined;
  if (values.length > 1) {
    throw new NususError("INVALID_ARGUMENT", `Turath currently supports only one ${name} filter per search`);
  }
  return id(values[0]!, name);
};

const isEmptyRecord = (value: JsonValue): boolean => isRecord(value) && Object.keys(value).length === 0;

/** Parallel page fetches for multi-page context; bounded for large ranges. */
const PAGE_FETCH_CONCURRENCY = 6;

export const createTurathClient = (options: TurathClientOptions = {}) => {
  const request = createTransport(options);

  const getAuthor = async (authorId: TurathId, { signal }: RequestOptions = {}) => {
    const author = id(authorId, "author id");
    const raw = await request("author", { id: author, ver: 3 }, signal);
    if (isEmptyRecord(raw)) throw new NususError("NOT_FOUND", `Author ${author} not found`);
    return normalizeAuthor(decodeAuthor(raw));
  };

  const getBook = async (bookId: TurathId, { signal }: RequestOptions = {}): Promise<Book> => {
    const book = id(bookId, "book id");
    return normalizeBook(decodeBook(await request("book", { id: book, include: "indexes", ver: 3 }, signal)));
  };

  const getPage = async (bookId: TurathId, pageId: TurathId, { signal }: RequestOptions = {}): Promise<Passage> => {
    const book = id(bookId, "book id");
    const page = id(pageId, "page id");
    const raw = await request("page", { book_id: book, pg: page, ver: 3 }, signal);
    if (isEmptyRecord(raw)) throw new NususError("NOT_FOUND", `Book ${book}, page ${page} not found`);
    return normalizePage(decodePage(raw), book);
  };

  const fetchPagesConcurrent = async (
    book: string,
    pageNumbers: number[],
    signal?: AbortSignal,
  ): Promise<Passage[]> => {
    if (!pageNumbers.length) return [];
    const results = Array.from<Passage>({ length: pageNumbers.length });
    let cursor = 0;
    const worker = async () => {
      while (cursor < pageNumbers.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await getPage(book, pageNumbers[index]!, { signal });
      }
    };
    const workers = Math.min(PAGE_FETCH_CONCURRENCY, pageNumbers.length);
    await Promise.all(Array.from({ length: workers }, worker));
    return results;
  };

  const getPages = async (
    bookId: TurathId,
    range: { from: number; to: number },
    { signal }: RequestOptions = {},
  ): Promise<Passage[]> => {
    integer(range.from, "from", 1);
    integer(range.to, "to", range.from);
    const book = id(bookId, "book id");
    const pageNumbers: number[] = [];
    for (let page = range.from; page <= range.to; page += 1) pageNumbers.push(page);
    return fetchPagesConcurrent(book, pageNumbers, signal);
  };

  const searchWithRaw = async (
    query: string,
    options: TurathSearchOptions = {},
  ): Promise<{ result: SearchPage; rawHits: RawSearchHit[] }> => {
    if (!query.trim()) throw new NususError("INVALID_ARGUMENT", "query must not be empty");
    const page = integer(options.page ?? 1, "page", 1);
    const run = async (effectiveQuery: string): Promise<RawSearch> => {
      const raw = await request(
        "search",
        {
          q: effectiveQuery,
          ver: 3,
          page,
          author: only(options.authorIds, "author"),
          book: only(options.bookIds, "book"),
          cat_id: only(options.categoryIds, "category"),
          sort: options.sort === "page" ? "page_id" : undefined,
        },
        options.signal,
      );
      return decodeSearch(raw);
    };

    let effectiveQuery = query;
    let response = await run(effectiveQuery);
    if (response.count === 0) {
      for (const fallback of searchFallbacks(query)) {
        const candidate = await run(fallback);
        if (candidate.count === 0) continue;
        effectiveQuery = fallback;
        response = candidate;
        break;
      }
    }
    return {
      result: {
        items: response.data.map(normalizeSearchHit),
        totalMatches: response.count,
        page,
        ...(effectiveQuery !== query && { effectiveQuery }),
      },
      rawHits: response.data,
    };
  };

  const search = async (query: string, options: TurathSearchOptions = {}): Promise<SearchPage> =>
    (await searchWithRaw(query, options)).result;

  const searchAll = async function* (query: string, options: Omit<TurathSearchOptions, "page"> = {}): AsyncGenerator<Passage> {
    let page = 1;
    let yielded = 0;
    let effectiveQuery = query;
    while (true) {
      const result = await search(effectiveQuery, { ...options, page });
      effectiveQuery = result.effectiveQuery ?? effectiveQuery;
      if (!result.items.length) return;
      for (const item of result.items) {
        yield item;
        yielded += 1;
        if (yielded >= result.totalMatches) return;
      }
      if (yielded >= result.totalMatches) return;
      page += 1;
    }
  };

  const fetchPageRange = async (
    book: string,
    from: number,
    to: number,
    center: number,
    signal?: AbortSignal,
    pagePromises?: Map<string, Promise<Passage>>,
  ): Promise<Passage[]> => {
    const pageNumbers: number[] = [];
    for (let page = from; page <= to; page += 1) pageNumbers.push(page);
    const fetched = await Promise.all(
      pageNumbers.map(async (page) => {
        try {
          const key = `${book}:${page}`;
          const pending = pagePromises?.get(key) ?? getPage(book, page, { signal });
          pagePromises?.set(key, pending);
          return { page, passage: await pending };
        } catch (error) {
          if (!(error instanceof NususError) || error.code !== "NOT_FOUND" || page === center) throw error;
          return undefined;
        }
      }),
    );
    return fetched
      .filter((entry): entry is { page: number; passage: Passage } => entry !== undefined)
      .sort((a, b) => a.page - b.page)
      .map((entry) => entry.passage);
  };

  const buildContextPassage = (source: Passage, pages: Passage[]): Passage => {
    const headings = [...new Set(pages.flatMap((page) => page.headings))];
    let offset = 0;
    const segments: PassageSegment[] = pages.map((page, index) => {
      const start = offset;
      offset += page.text.length;
      const segment = {
        start,
        end: offset,
        location: page.location,
        url: page.url,
        ...(page.alternateUrls && { alternateUrls: page.alternateUrls }),
        citation: page.citation,
        ...(page.locator && { locator: page.locator }),
      };
      if (index < pages.length - 1) offset += 2;
      return segment;
    });
    return decoratePassage({
      ...source,
      text: pages.map((page) => page.text).join("\n\n"),
      headings,
      segments,
      raw: pages.flatMap((page) => (page.raw === undefined ? [] : [page.raw])),
    });
  };

  const getContext = async (source: Passage, options: ContextOptions = {}): Promise<Passage> => {
    const center = source.location.internalPage;
    if (center === undefined) throw new NususError("INVALID_ARGUMENT", "passage has no internal page");
    integer(center, "internal page", 1);
    const before = integer(options.pagesBefore ?? 1, "pagesBefore");
    const after = integer(options.pagesAfter ?? 1, "pagesAfter");
    const pages = await fetchPageRange(
      source.book.id,
      Math.max(1, center - before),
      center + after,
      center,
      options.signal,
    );
    return buildContextPassage(source, pages);
  };

  const getContextByPage = async (
    bookId: TurathId,
    pageId: TurathId,
    options: ContextOptions = {},
  ): Promise<Passage> => {
    const book = id(bookId, "book id");
    const center = integer(Number(id(pageId, "page id")), "page id", 1);
    const before = integer(options.pagesBefore ?? 1, "pagesBefore");
    const after = integer(options.pagesAfter ?? 1, "pagesAfter");
    const pages = await fetchPageRange(book, Math.max(1, center - before), center + after, center, options.signal);
    const centerPage = pages.find((page) => page.location.internalPage === center);
    if (!centerPage) throw new NususError("NOT_FOUND", `Book ${book}, page ${center} not found`);
    return buildContextPassage(centerPage, pages);
  };

  const retrieve = async (query: string, options: RetrieveOptions = {}): Promise<RetrievedContext> => {
    const maxPassages = integer(options.maxPassages ?? 5, "maxPassages", 1);
    const maxChars = integer(options.maxCharsPerPassage ?? 4_000, "maxCharsPerPassage", 1);
    const pagesBefore = integer(options.pagesBefore ?? 0, "pagesBefore");
    const pagesAfter = integer(options.pagesAfter ?? 0, "pagesAfter");
    const searchOptions = { ...options.scope, signal: options.signal };
    const first = await searchWithRaw(query, searchOptions);
    const hits = first.result.items.slice(0, maxPassages);
    const rawHits = first.rawHits.slice(0, maxPassages);
    const pagePromises = new Map<string, Promise<Passage>>();
    for (let page = 2; hits.length < Math.min(maxPassages, first.result.totalMatches); page += 1) {
      const next = await searchWithRaw(first.result.effectiveQuery ?? query, { ...searchOptions, page });
      if (!next.result.items.length) break;
      const take = maxPassages - hits.length;
      hits.push(...next.result.items.slice(0, take));
      rawHits.push(...next.rawHits.slice(0, take));
    }
    const passages = await Promise.all(
      hits.map(async (hit, rank) => {
        let page: Passage;
        if (hit.location.internalPage === undefined) {
          page = hit;
        } else {
          const center = hit.location.internalPage;
          const key = `${hit.book.id}:${center}`;
          if (pagesBefore > 0 || pagesAfter > 0) {
            integer(center, "internal page", 1);
            const pages = await fetchPageRange(
              hit.book.id,
              Math.max(1, center - pagesBefore),
              center + pagesAfter,
              center,
              options.signal,
              pagePromises,
            );
            page = buildContextPassage(hit, pages);
          } else {
            const pending = pagePromises.get(key) ?? getPage(hit.book.id, center, { signal: options.signal });
            pagePromises.set(key, pending);
            page = await pending;
          }
        }

        const rawHit = rawHits[rank];
        const rawSnip = rawHit?.snip;
        const rawSnippet = isString(rawSnip) ? rawSnip : hit.snippet;
        const bound = boundText(page.text, maxChars, rawSnippet);
        const segments = page.segments?.flatMap((segment) => {
          const start = Math.max(segment.start, bound.offset);
          const end = Math.min(segment.end, bound.offset + bound.text.length);
          return start < end ? [{ ...segment, start: start - bound.offset, end: end - bound.offset }] : [];
        });
        const publicPage = { ...page };
        delete publicPage.raw;
        const boundedBase: Omit<Passage, "raw"> = {
          ...publicPage,
          snippet: hit.snippet,
          text: bound.text,
          ...(segments && { segments }),
        };
        if (hit.author || page.author) boundedBase.author = { ...page.author, ...hit.author };
        if (hit.category) boundedBase.category = { ...page.category, ...hit.category };
        else if (page.category) boundedBase.category = page.category;
        const bounded = decoratePassage(boundedBase);
        const provenance: PassageProvenance = {
          query,
          ...(first.result.effectiveQuery && { effectiveQuery: first.result.effectiveQuery }),
          ...(options.scope && { scope: options.scope }),
          rank,
          totalMatches: first.result.totalMatches,
          truncated: bound.truncated,
          ...(bound.truncation && { truncation: bound.truncation }),
          contextPages: { before: pagesBefore, after: pagesAfter },
          retrievedVia: hit.location.internalPage === undefined ? "search-hit" : "page",
        };
        return { ...bounded, provenance };
      }),
    );
    return {
      passages,
      totalMatches: first.result.totalMatches,
      query,
      ...(first.result.effectiveQuery && { effectiveQuery: first.result.effectiveQuery }),
    };
  };

  return {
    findBooks: findCatalogBooks,
    findAuthors: findCatalogAuthors,
    listCategories: listCatalogCategories,
    getCatalogMetadata,
    getAuthor,
    getBook,
    getPage,
    getPages,
    search,
    searchAll,
    getContext,
    getContextByPage,
    retrieve,
    formatCitation: (source: CitationSource) => formatCitation(source),
    getLocator: (source: CitationSource) => getLocator(source),
    getSourceUrl: (source: CitationSource) => getSourceUrl(source),
    getShamelaUrl: (source: CitationSource) => getShamelaUrl(source),
  };
};

export type TurathClient = ReturnType<typeof createTurathClient>;
