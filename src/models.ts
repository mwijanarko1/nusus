export type TurathId = number | string;

export type AuthorSummary = {
  id?: string;
  name?: string;
};

export type CategorySummary = {
  id: string;
  title?: string;
};

export type Category = CategorySummary & {
  provider: "turath";
  title: string;
  bookCount: number;
};

export type BookSummary = {
  id: string;
  title: string;
};

export type Author = AuthorSummary & {
  provider: "turath";
  id: string;
  biography?: string;
  deathYear?: string;
  raw?: unknown;
};

export type Book = BookSummary & {
  provider: "turath";
  author?: AuthorSummary;
  category?: CategorySummary;
  description?: string;
  hasPdf?: boolean;
  raw?: unknown;
};

export type SourceLocation = {
  internalPage?: number;
  printedPage?: number;
  volume?: string;
};

export type SourceLocator = {
  bookId: string;
  internalPage?: number;
  printedPage?: number;
  volume?: string;
  url: string;
};

export type RetrieveScope = {
  bookIds?: TurathId[];
  authorIds?: TurathId[];
  categoryIds?: TurathId[];
};

export type PassageProvenance = {
  query: string;
  scope?: RetrieveScope;
  rank: number;
  totalMatches: number;
  truncated: boolean;
  truncation?: "prefix" | "match-window";
  contextPages: { before: number; after: number };
  retrievedVia: "page" | "search-hit";
};

export type Passage = {
  provider: "turath";
  book: BookSummary;
  author?: AuthorSummary;
  category?: CategorySummary;
  location: SourceLocation;
  text: string;
  snippet?: string;
  headings: string[];
  url: string;
  citation: string;
  locator?: SourceLocator;
  provenance?: PassageProvenance;
  raw?: unknown;
};

export type SearchPage = {
  items: Passage[];
  totalMatches: number;
  page: number;
};

export type RetrievedContext = {
  passages: Passage[];
  totalMatches: number;
  query: string;
};

export type CatalogMetadata = {
  scannedAt: string;
  bookCount: number;
  categoryCount: number;
  /** Distinct author IDs referenced by the bundled book catalog. */
  authorIdCount: number;
  /** Bundled offline author names verified via official GET /author. */
  authorNameCount: number;
  /** Known catalog author IDs with no verified offline name (missing/empty upstream or not yet hydrated). */
  unresolvedAuthorIdCount: number;
};
