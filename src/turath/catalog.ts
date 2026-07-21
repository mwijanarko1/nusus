import { NususError } from "../errors.js";
import type { Author, Book, CatalogMetadata, Category, TurathId } from "../models.js";
import { CATALOG_AUTHORS } from "./catalog-authors.js";
import { CATALOG_BOOKS, CATALOG_CATEGORIES, CATALOG_SCANNED_AT } from "./catalog-data.js";

export type FindBooksOptions = {
  categoryIds?: TurathId[];
  limit?: number;
};

export type FindAuthorsOptions = {
  limit?: number;
};

const normalize = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .trim()
    .toLowerCase();

const positiveId = (value: TurathId, name: string): string => {
  const result = String(value);
  if (!/^[1-9]\d*$/.test(result)) throw new NususError("INVALID_ARGUMENT", `${name} must be a positive integer`);
  return result;
};

const positiveLimit = (value: number | undefined, fallback: number): number => {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new NususError("INVALID_ARGUMENT", "limit must be a positive integer");
  }
  return limit;
};

const authorNames = new Map(CATALOG_AUTHORS.map(([authorId, name]) => [String(authorId), name]));

const uniqueAuthorIds = (() => {
  const ids = new Set<number>();
  for (const [, , authorId] of CATALOG_BOOKS) ids.add(authorId);
  return ids;
})();

const scoreMatch = (candidate: string, needle: string, words: string[]): number => {
  if (candidate === needle) return 0;
  if (candidate.startsWith(needle)) return 1;
  if (candidate.includes(needle)) return 2;
  if (words.every((word) => candidate.includes(word))) return 3;
  return -1;
};

export const getCatalogMetadata = (): CatalogMetadata => {
  let authorNameCount = 0;
  for (const authorId of uniqueAuthorIds) {
    if (authorNames.has(String(authorId))) authorNameCount += 1;
  }
  return {
    scannedAt: CATALOG_SCANNED_AT,
    bookCount: CATALOG_BOOKS.length,
    categoryCount: CATALOG_CATEGORIES.length,
    authorIdCount: uniqueAuthorIds.size,
    authorNameCount,
    unresolvedAuthorIdCount: uniqueAuthorIds.size - authorNameCount,
  };
};

export const findCatalogBooks = (query: string, options: FindBooksOptions = {}): Book[] => {
  const needle = normalize(query);
  if (!needle) throw new NususError("INVALID_ARGUMENT", "query must not be empty");
  const limit = positiveLimit(options.limit, 20);
  const categories = options.categoryIds?.map((value) => positiveId(value, "category id"));
  const categorySet = categories?.length ? new Set(categories) : undefined;
  const words = needle.split(/\s+/);

  return CATALOG_BOOKS
    .flatMap(([bookId, title, authorId, categoryId]) => {
      if (categorySet && !categorySet.has(String(categoryId))) return [];
      const score = scoreMatch(normalize(title), needle, words);
      if (score < 0) return [];
      const authorKey = String(authorId);
      const authorName = authorNames.get(authorKey);
      return [{
        score,
        book: {
          provider: "turath" as const,
          id: String(bookId),
          title,
          author: { id: authorKey, ...(authorName && { name: authorName }) },
          category: { id: String(categoryId) },
        },
      }];
    })
    .sort((a, b) => a.score - b.score || a.book.title.localeCompare(b.book.title, "ar") || Number(a.book.id) - Number(b.book.id))
    .slice(0, limit)
    .map(({ book }) => book);
};

export const findCatalogAuthors = (query: string, options: FindAuthorsOptions = {}): Author[] => {
  const needle = normalize(query);
  if (!needle) throw new NususError("INVALID_ARGUMENT", "query must not be empty");
  const limit = positiveLimit(options.limit, 20);
  const words = needle.split(/\s+/);

  return CATALOG_AUTHORS
    .flatMap(([authorId, name]) => {
      const score = scoreMatch(normalize(name), needle, words);
      return score < 0 ? [] : [{
        score,
        author: {
          provider: "turath" as const,
          id: String(authorId),
          name,
        },
      }];
    })
    .sort((a, b) => a.score - b.score || a.author.name.localeCompare(b.author.name, "ar") || Number(a.author.id) - Number(b.author.id))
    .slice(0, limit)
    .map(({ author }) => author);
};

export const listCatalogCategories = (): Category[] => {
  const counts = new Map<number, number>();
  for (const [, , , categoryId] of CATALOG_BOOKS) counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
  return CATALOG_CATEGORIES.map(([categoryId, title]) => ({
    provider: "turath",
    id: String(categoryId),
    title,
    bookCount: counts.get(categoryId) ?? 0,
  }));
};

export const listCatalogAuthorIds = (): string[] =>
  [...uniqueAuthorIds].sort((a, b) => a - b).map(String);
