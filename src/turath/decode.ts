import { NususError } from "../errors.js";
import type {
  RawAuthor,
  RawBook,
  RawBookMeta,
  RawPage,
  RawPageMeta,
  RawSearch,
  RawSearchHit,
} from "./raw-types.js";
import type { JsonRecord, JsonValue } from "./json.js";

export type { JsonValue } from "./json.js";

const invalid = (message: string, cause?: unknown): never => {
  throw new NususError("INVALID_RESPONSE", message, { cause });
};

export const isRecord = (value: JsonValue): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: JsonValue): value is string => typeof value === "string";
const isNumber = (value: JsonValue): value is number => typeof value === "number";
const isArray = (value: JsonValue): value is JsonValue[] => Array.isArray(value);

const hasOwn = (record: JsonRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const optional = (record: JsonRecord, key: string): JsonValue | undefined =>
  hasOwn(record, key) ? record[key] : undefined;

const isAuthor = (value: JsonValue): value is RawAuthor => {
  if (!isRecord(value)) return false;
  if (!hasOwn(value, "id") || !isNumber(value.id)) return false;
  if (!hasOwn(value, "name") || !isString(value.name)) return false;
  return true;
};

export const decodeAuthor = (value: JsonValue): RawAuthor => {
  if (!isAuthor(value)) return invalid("Turath returned an invalid author");
  return value;
};

const isBookMeta = (value: JsonValue): value is RawBookMeta => {
  if (!isRecord(value)) return false;
  if (!hasOwn(value, "id") || !isNumber(value.id)) return false;
  if (!hasOwn(value, "name") || !isString(value.name)) return false;
  return true;
};

const isBook = (value: JsonValue): value is RawBook => {
  if (!isRecord(value)) return false;
  const meta = optional(value, "meta");
  if (meta === undefined || !isBookMeta(meta)) return false;
  return true;
};

export const decodeBook = (value: JsonValue): RawBook => {
  if (!isBook(value)) return invalid("Turath returned an invalid book");
  return value;
};

const isPage = (value: JsonValue): value is RawPage => {
  if (!isRecord(value)) return false;
  if (!hasOwn(value, "meta") || !isString(value.meta)) return false;
  if (!hasOwn(value, "text") || !isString(value.text)) return false;
  return true;
};

export const decodePage = (value: JsonValue): RawPage => {
  if (!isPage(value)) return invalid("Turath returned an invalid page");
  return value;
};

const isPageMeta = (value: JsonValue): value is RawPageMeta => isRecord(value);

const decodePageMeta = (value: JsonValue): RawPageMeta => {
  if (!isPageMeta(value)) return invalid("Turath page metadata is invalid");
  return value;
};

export const parseMeta = (value: string): RawPageMeta => {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    throw invalid("Turath metadata contains invalid JSON", cause);
  }
  return decodePageMeta(parsed);
};

const isSearchHit = (value: JsonValue): value is RawSearchHit => {
  if (!isRecord(value)) return false;
  if (!hasOwn(value, "book_id") || !isNumber(value.book_id)) return false;
  if (!hasOwn(value, "meta") || !isString(value.meta)) return false;
  if (!hasOwn(value, "text") || !isString(value.text)) return false;
  return true;
};

const isSearch = (value: JsonValue): value is RawSearch => {
  if (!isRecord(value)) return false;
  if (!hasOwn(value, "count") || !isNumber(value.count)) return false;
  if (!hasOwn(value, "data")) return false;
  if (!isArray(value.data)) return false;
  return value.data.every(isSearchHit);
};

export const decodeSearch = (value: JsonValue): RawSearch => {
  if (!isSearch(value)) return invalid("Turath returned an invalid search response");
  return value;
};
