import { NususError } from "../errors.js";
import type { Author, Book, BookTocEntry, Passage } from "../models.js";
import { decoratePassage } from "./citations.js";
import type { RawAuthor, RawBook, RawPage, RawPageMeta, RawSearchHit } from "./raw-types.js";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const plainText = (value: string): string => value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/?[a-z][^>]*>/gi, "");

const extractIndexes = (raw: Record<string, unknown>): { toc?: BookTocEntry[]; volumes?: string[] } => {
  const indexes = raw.indexes;
  if (!record(indexes)) return {};
  const out: { toc?: BookTocEntry[]; volumes?: string[] } = {};
  if (Array.isArray(indexes.headings)) {
    const toc: BookTocEntry[] = [];
    for (const item of indexes.headings) {
      if (!record(item) || typeof item.title !== "string") continue;
      const entry: BookTocEntry = { title: item.title };
      if (typeof item.level === "number") entry.level = item.level;
      if (typeof item.page === "number") entry.page = item.page;
      toc.push(entry);
    }
    if (toc.length) out.toc = toc;
  }
  if (Array.isArray(indexes.volumes) && indexes.volumes.every((value) => typeof value === "string")) {
    out.volumes = indexes.volumes as string[];
  }
  return out;
};

const invalid = (message: string, cause?: unknown): never => {
  throw new NususError("INVALID_RESPONSE", message, { cause });
};

const parseMeta = (value: unknown): RawPageMeta => {
  if (typeof value !== "string") return invalid("Turath metadata is not encoded JSON");
  try {
    const parsed: unknown = JSON.parse(value);
    if (!record(parsed)) return invalid("Turath metadata is not an object");
    return parsed as RawPageMeta;
  } catch (cause) {
    if (cause instanceof NususError) throw cause;
    return invalid("Turath metadata contains invalid JSON", cause);
  }
};

const passage = (input: Omit<Passage, "url" | "citation" | "locator">): Passage => decoratePassage(input);

export const normalizeAuthor = (raw: unknown): Author => {
  if (!record(raw) || typeof raw.id !== "number" || typeof raw.name !== "string") {
    return invalid("Turath returned an invalid author");
  }
  const author = raw as RawAuthor;
  return {
    provider: "turath",
    id: String(author.id),
    name: author.name,
    ...(typeof author.biography === "string" && { biography: author.biography }),
    ...(typeof author.death === "string" && { deathYear: author.death }),
    raw,
  };
};

export const normalizeBook = (raw: unknown): Book => {
  if (!record(raw) || !record(raw.meta) || typeof raw.meta.id !== "number" || typeof raw.meta.name !== "string") {
    return invalid("Turath returned an invalid book");
  }
  const book = raw as RawBook;
  const indexes = extractIndexes(raw);
  return {
    provider: "turath",
    id: String(book.meta.id),
    title: book.meta.name,
    ...(typeof book.meta.author_id === "number" && { author: { id: String(book.meta.author_id) } }),
    ...(typeof book.meta.cat_id === "number" && { category: { id: String(book.meta.cat_id) } }),
    ...(typeof book.meta.info === "string" && { description: book.meta.info }),
    ...(Boolean(book.meta.pdf_links) && { hasPdf: true }),
    ...indexes,
    raw,
  };
};

export const normalizePage = (raw: unknown, bookId: string): Passage => {
  if (!record(raw) || typeof raw.meta !== "string" || typeof raw.text !== "string") {
    return invalid("Turath returned an invalid page");
  }
  const page = raw as RawPage;
  const meta = parseMeta(page.meta);
  if (typeof meta.book_name !== "string") return invalid("Turath page is missing its book name");
  return passage({
    provider: "turath",
    book: { id: bookId, title: meta.book_name },
    ...(meta.author_name && { author: { name: meta.author_name } }),
    location: {
      ...(typeof meta.page_id === "number" && { internalPage: meta.page_id }),
      ...(typeof meta.page === "number" && { printedPage: meta.page }),
      ...(typeof meta.vol === "string" && { volume: meta.vol }),
    },
    text: plainText(page.text),
    headings: Array.isArray(meta.headings) && meta.headings.every((item) => typeof item === "string") ? meta.headings : [],
    raw,
  });
};

export const normalizeSearchHit = (raw: unknown): Passage => {
  if (!record(raw) || typeof raw.book_id !== "number" || typeof raw.meta !== "string" || typeof raw.text !== "string") {
    return invalid("Turath returned an invalid search result");
  }
  const hit = raw as RawSearchHit;
  const meta = parseMeta(hit.meta);
  if (typeof meta.book_name !== "string") return invalid("Turath search result is missing its book name");
  return passage({
    provider: "turath",
    book: { id: String(hit.book_id), title: meta.book_name },
    ...(typeof hit.author_id === "number" && { author: { id: String(hit.author_id), ...(meta.author_name && { name: meta.author_name }) } }),
    ...(typeof hit.cat_id === "number" && { category: { id: String(hit.cat_id) } }),
    location: {
      ...(typeof meta.page_id === "number" && { internalPage: meta.page_id }),
      ...(typeof meta.page === "number" && { printedPage: meta.page }),
      ...(typeof meta.vol === "string" && { volume: meta.vol }),
    },
    text: plainText(hit.text),
    ...(typeof hit.snip === "string" && { snippet: plainText(hit.snip) }),
    headings: Array.isArray(meta.headings) && meta.headings.every((item) => typeof item === "string") ? meta.headings : [],
    raw,
  });
};
