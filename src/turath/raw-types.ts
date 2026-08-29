import type { JsonValue } from "./json.js";

export type RawAuthor = {
  id: number;
  name: string;
  [key: string]: JsonValue;
};

export type RawBookMeta = {
  id: number;
  name: string;
  [key: string]: JsonValue;
};

export type RawBookIndexes = { [key: string]: JsonValue };

export type RawBook = {
  meta: RawBookMeta;
  [key: string]: JsonValue;
};

export type RawPageMeta = { [key: string]: JsonValue };

export type RawPage = { meta: string; text: string; [key: string]: JsonValue };

export type RawSearchHit = {
  book_id: number;
  meta: string;
  text: string;
  [key: string]: JsonValue;
};

export type RawSearch = { count: number; data: RawSearchHit[]; [key: string]: JsonValue };
