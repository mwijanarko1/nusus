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
