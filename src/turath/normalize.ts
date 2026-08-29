import { NususError } from "../errors.js";
import type { Author, Book, BookTocEntry, Passage } from "../models.js";
import { decoratePassage } from "./citations.js";
import { parseMeta } from "./decode.js";
import type { JsonValue } from "./json.js";
import type { RawAuthor, RawBook, RawPage, RawSearchHit } from "./raw-types.js";

const record = (value: JsonValue): value is { [key: string]: JsonValue } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: JsonValue): value is string => typeof value === "string";
const isNumber = (value: JsonValue): value is number => typeof value === "number";

const plainText = (value: string): string => value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/?[a-z][^>]*>/gi, "");

type ExtractedIndexes = { toc?: BookTocEntry[]; volumes?: string[] };

const extractIndexes = (indexes: JsonValue | undefined): ExtractedIndexes => {
  if (indexes === undefined || !record(indexes)) return {};
  const out: ExtractedIndexes = {};
  if (Array.isArray(indexes.headings)) {
    const toc: BookTocEntry[] = [];
    for (const item of indexes.headings) {
      if (!record(item)) continue;
      if (!isString(item.title)) continue;
      const entry: BookTocEntry = { title: item.title };
      if (isNumber(item.level)) entry.level = item.level;
      if (isNumber(item.page)) entry.page = item.page;
      toc.push(entry);
    }
    if (toc.length) out.toc = toc;
  }
  if (Array.isArray(indexes.volumes) && indexes.volumes.every(isString)) {
    out.volumes = indexes.volumes;
  }
  return out;
};

const invalid = (message: string, cause?: unknown): never => {
  throw new NususError("INVALID_RESPONSE", message, { cause });
};

const passage = (input: Omit<Passage, "url" | "citation" | "locator">): Passage => decoratePassage(input);

export const normalizeAuthor = (raw: RawAuthor): Author => ({
  provider: "turath",
  id: String(raw.id),
  name: raw.name,
  ...(isString(raw.biography) && { biography: raw.biography }),
  ...(isString(raw.death) && { deathYear: raw.death }),
  raw,
});

export const normalizeBook = (raw: RawBook): Book => {
  const indexes = extractIndexes(raw.indexes);
  return {
    provider: "turath",
    id: String(raw.meta.id),
    title: raw.meta.name,
    ...(isNumber(raw.meta.author_id) && { author: { id: String(raw.meta.author_id) } }),
    ...(isNumber(raw.meta.cat_id) && { category: { id: String(raw.meta.cat_id) } }),
    ...(isString(raw.meta.info) && { description: raw.meta.info }),
    ...(Boolean(raw.meta.pdf_links) && { hasPdf: true }),
    ...indexes,
    raw,
  };
};

export const normalizePage = (raw: RawPage, bookId: string): Passage => {
  const meta = parseMeta(raw.meta);
  if (!isString(meta.book_name)) return invalid("Turath page is missing its book name");
  return passage({
    provider: "turath",
    book: { id: bookId, title: meta.book_name },
    ...(isString(meta.author_name) && { author: { name: meta.author_name } }),
    location: {
      ...(isNumber(meta.page_id) && { internalPage: meta.page_id }),
      ...(isNumber(meta.page) && { printedPage: meta.page }),
      ...(isString(meta.vol) && { volume: meta.vol }),
    },
    text: plainText(raw.text),
    headings: Array.isArray(meta.headings) && meta.headings.every(isString) ? meta.headings : [],
    raw,
  });
};

export const normalizeSearchHit = (raw: RawSearchHit): Passage => {
  const meta = parseMeta(raw.meta);
  if (!isString(meta.book_name)) return invalid("Turath search result is missing its book name");
  return passage({
    provider: "turath",
    book: { id: String(raw.book_id), title: meta.book_name },
    ...(isNumber(raw.author_id) && { author: { id: String(raw.author_id), ...(isString(meta.author_name) && { name: meta.author_name }) } }),
    ...(isNumber(raw.cat_id) && { category: { id: String(raw.cat_id) } }),
    location: {
      ...(isNumber(meta.page_id) && { internalPage: meta.page_id }),
      ...(isNumber(meta.page) && { printedPage: meta.page }),
      ...(isString(meta.vol) && { volume: meta.vol }),
    },
    text: plainText(raw.text),
    ...(isString(raw.snip) && { snippet: plainText(raw.snip) }),
    headings: Array.isArray(meta.headings) && meta.headings.every(isString) ? meta.headings : [],
    raw,
  });
};
