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

export type BookTocEntry = {
  title: string;
  level?: number;
  page?: number;
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
  /** Normalized TOC from Turath book indexes when present. */
  toc?: BookTocEntry[];
  /** Volume labels from Turath book indexes when present. */
  volumes?: string[];
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
  effectiveQuery?: string;
  scope?: RetrieveScope;
  rank: number;
  totalMatches: number;
  truncated: boolean;
  truncation?: "prefix" | "match-window";
  contextPages: { before: number; after: number };
  retrievedVia: "page" | "search-hit";
};

export type PassageSegment = {
  start: number;
  end: number;
  location: SourceLocation;
  url: string;
  citation: string;
  locator?: SourceLocator;
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
  /** Per-page offsets into text for multi-page context passages. */
  segments?: PassageSegment[];
  raw?: unknown;
};

export type SearchPage = {
  items: Passage[];
  totalMatches: number;
  page: number;
  /** Query sent upstream when normalized fallback was needed. */
  effectiveQuery?: string;
};

export type RetrievedContext = {
  passages: Passage[];
  totalMatches: number;
  query: string;
  /** Query sent upstream when normalized fallback was needed. */
  effectiveQuery?: string;
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
