import { NususError } from "../errors.js";
import type { Book, Category, TurathId } from "../models.js";
import { CATALOG_BOOKS, CATALOG_CATEGORIES } from "./catalog-data.js";

export type FindBooksOptions = {
  categoryIds?: TurathId[];
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

export const findCatalogBooks = (query: string, options: FindBooksOptions = {}): Book[] => {
  const needle = normalize(query);
  if (!needle) throw new NususError("INVALID_ARGUMENT", "query must not be empty");
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new NususError("INVALID_ARGUMENT", "limit must be a positive integer");
  }
  const categories = options.categoryIds?.map((value) => positiveId(value, "category id"));
  const categorySet = categories?.length ? new Set(categories) : undefined;
  const words = needle.split(/\s+/);

  return CATALOG_BOOKS
    .flatMap(([bookId, title, authorId, categoryId]) => {
      if (categorySet && !categorySet.has(String(categoryId))) return [];
      const candidate = normalize(title);
      const score = candidate === needle ? 0 : candidate.startsWith(needle) ? 1 : candidate.includes(needle) ? 2 : words.every((word) => candidate.includes(word)) ? 3 : -1;
      return score < 0 ? [] : [{
        score,
        book: {
          provider: "turath" as const,
          id: String(bookId),
          title,
          author: { id: String(authorId) },
          category: { id: String(categoryId) },
        },
      }];
    })
    .sort((a, b) => a.score - b.score || a.book.title.localeCompare(b.book.title, "ar") || Number(a.book.id) - Number(b.book.id))
    .slice(0, limit)
    .map(({ book }) => book);
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
