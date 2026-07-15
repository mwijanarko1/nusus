export type RawAuthor = {
  id: number;
  name: string;
  biography?: string;
  death?: string;
  [key: string]: unknown;
};

export type RawBook = {
  meta: {
    id: number;
    name: string;
    author_id?: number;
    cat_id?: number;
    info?: string;
    pdf_links?: unknown;
    [key: string]: unknown;
  };
  indexes?: Record<string, unknown>;
};

export type RawPageMeta = {
  headings?: string[];
  page_id?: number;
  page?: number;
  vol?: string;
  book_name?: string;
  author_name?: string;
};

export type RawPage = { meta: string; text: string };

export type RawSearchHit = {
  author_id?: number;
  book_id: number;
  cat_id?: number;
  meta: string;
  snip?: string;
  text: string;
};

export type RawSearch = { count: number; data: RawSearchHit[] };
