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
import { decoratePassage, formatCitation, getLocator, getSourceUrl, type CitationSource } from "./citations.js";
import {
  findCatalogAuthors,
  findCatalogBooks,
  getCatalogMetadata,
  listCatalogCategories,
} from "./catalog.js";
import { boundText } from "./excerpt.js";
import { normalizeAuthor, normalizeBook, normalizePage, normalizeSearchHit } from "./normalize.js";
import type { RawSearch } from "./raw-types.js";

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
    .replace(/ة/g, "ه")
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

const emptyObject = (value: unknown): boolean =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;

/** Parallel page fetches for multi-page context; bounded for large ranges. */
const PAGE_FETCH_CONCURRENCY = 6;

export const createTurathClient = (options: TurathClientOptions = {}) => {
  const request = createTransport(options);

  const getAuthor = async (authorId: TurathId, { signal }: RequestOptions = {}) => {
    const author = id(authorId, "author id");
    const raw = await request<unknown>("author", { id: author, ver: 3 }, signal);
    if (emptyObject(raw)) throw new NususError("NOT_FOUND", `Author ${author} not found`);
    return normalizeAuthor(raw);
  };

  const getBook = async (bookId: TurathId, { signal }: RequestOptions = {}): Promise<Book> => {
    const book = id(bookId, "book id");
    return normalizeBook(await request<unknown>("book", { id: book, include: "indexes", ver: 3 }, signal));
  };

  const getPage = async (bookId: TurathId, pageId: TurathId, { signal }: RequestOptions = {}): Promise<Passage> => {
    const book = id(bookId, "book id");
    const page = id(pageId, "page id");
    const raw = await request<unknown>("page", { book_id: book, pg: page, ver: 3 }, signal);
    if (emptyObject(raw)) throw new NususError("NOT_FOUND", `Book ${book}, page ${page} not found`);
    return normalizePage(raw, book);
  };

  const fetchPagesConcurrent = async (
    book: string,
    pageNumbers: number[],
    signal?: AbortSignal,
  ): Promise<Passage[]> => {
    if (!pageNumbers.length) return [];
    const results: Passage[] = new Array(pageNumbers.length);
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

  const search = async (query: string, options: TurathSearchOptions = {}): Promise<SearchPage> => {
    if (!query.trim()) throw new NususError("INVALID_ARGUMENT", "query must not be empty");
    const page = integer(options.page ?? 1, "page", 1);
    const run = async (effectiveQuery: string): Promise<RawSearch> => {
      const raw = await request<unknown>(
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
      if (
        typeof raw !== "object" || raw === null ||
        typeof (raw as RawSearch).count !== "number" ||
        !Array.isArray((raw as RawSearch).data)
      ) {
        throw new NususError("INVALID_RESPONSE", "Turath returned an invalid search response");
      }
      return raw as RawSearch;
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
      items: response.data.map(normalizeSearchHit),
      totalMatches: response.count,
      page,
      ...(effectiveQuery !== query && { effectiveQuery }),
    };
  };

  const searchAll = async function* (query: string, options: Omit<TurathSearchOptions, "page"> = {}): AsyncGenerator<Passage> {
    let page = 1;
    let yielded = 0;
    while (true) {
      const result = await search(query, { ...options, page });
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
  ): Promise<Passage[]> => {
    const pageNumbers: number[] = [];
    for (let page = from; page <= to; page += 1) pageNumbers.push(page);
    const fetched = await Promise.all(
      pageNumbers.map(async (page) => {
        try {
          return { page, passage: await getPage(book, page, { signal }) };
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
      raw: pages.map((page) => page.raw),
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
    const first = await search(query, searchOptions);
    const hits = first.items.slice(0, maxPassages);
    for (let page = 2; hits.length < Math.min(maxPassages, first.totalMatches); page += 1) {
      const next = await search(first.effectiveQuery ?? query, { ...searchOptions, page });
      if (!next.items.length) break;
      hits.push(...next.items.slice(0, maxPassages - hits.length));
    }
    const passages = await Promise.all(
      hits.map(async (hit, rank) => {
        let page: Passage;
        if (hit.location.internalPage === undefined) {
          page = hit;
        } else if (pagesBefore > 0 || pagesAfter > 0) {
          page = await getContext(hit, { pagesBefore, pagesAfter, signal: options.signal });
        } else {
          page = await getPage(hit.book.id, hit.location.internalPage, { signal: options.signal });
        }

        const rawSnippet = typeof hit.raw === "object" && hit.raw !== null && "snip" in hit.raw &&
            typeof hit.raw.snip === "string"
          ? hit.raw.snip
          : hit.snippet;
        const bound = boundText(page.text, maxChars, rawSnippet);
        const segments = page.segments?.flatMap((segment) => {
          const start = Math.max(segment.start, bound.offset);
          const end = Math.min(segment.end, bound.offset + bound.text.length);
          return start < end ? [{ ...segment, start: start - bound.offset, end: end - bound.offset }] : [];
        });
        const publicPage = { ...page };
        delete publicPage.raw;
        const bounded = decoratePassage({
          ...publicPage,
          ...(hit.author || page.author ? { author: { ...hit.author, ...page.author } } : {}),
          ...(hit.category
            ? { category: { ...hit.category, ...page.category } }
            : page.category ? { category: page.category } : {}),
          snippet: hit.snippet,
          text: bound.text,
          ...(segments && { segments }),
        });
        const provenance: PassageProvenance = {
          query,
          ...(first.effectiveQuery && { effectiveQuery: first.effectiveQuery }),
          ...(options.scope && { scope: options.scope }),
          rank,
          totalMatches: first.totalMatches,
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
      totalMatches: first.totalMatches,
      query,
      ...(first.effectiveQuery && { effectiveQuery: first.effectiveQuery }),
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
  };
};

export type TurathClient = ReturnType<typeof createTurathClient>;
