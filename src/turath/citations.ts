import type { AlternateUrls, Passage, SourceLocator } from "../models.js";

export type CitationSource = Pick<Passage, "author" | "book" | "location">;

export const getSourceUrl = (source: CitationSource): string => {
  const url = new URL(`https://app.turath.io/book/${source.book.id}`);
  if (source.location.internalPage !== undefined) {
    url.searchParams.set("page", String(source.location.internalPage));
  }
  return url.href;
};

export const getShamelaUrl = (source: CitationSource): string | undefined =>
  source.location.internalPage === undefined
    ? undefined
    : `https://shamela.ws/book/${source.book.id}/${source.location.internalPage}`;

const getAlternateUrls = (source: CitationSource): AlternateUrls | undefined => {
  const shamela = getShamelaUrl(source);
  return shamela === undefined ? undefined : { shamela };
};

export const getLocator = (source: CitationSource): SourceLocator => ({
  bookId: source.book.id,
  ...(source.location.internalPage !== undefined && { internalPage: source.location.internalPage }),
  ...(source.location.printedPage !== undefined && { printedPage: source.location.printedPage }),
  ...(source.location.volume && { volume: source.location.volume }),
  url: getSourceUrl(source),
});

export const formatCitation = (source: CitationSource): string => {
  const parts: string[] = [];
  if (source.author?.name) parts.push(source.author.name);
  if (source.book.title) parts.push(source.book.title);
  if (source.location.volume) parts.push(`ج ${source.location.volume}`);
  if (source.location.printedPage !== undefined) parts.push(`ص ${source.location.printedPage}`);
  if (source.location.internalPage !== undefined) parts.push(`صفحة تراث ${source.location.internalPage}`);
  parts.push(`تراث ${source.book.id}`);
  return parts.join("، ");
};

type DecoratedPassage<T extends CitationSource> = Omit<T, "alternateUrls" | "citation" | "url" | "locator"> & {
  citation: string;
  url: string;
  alternateUrls?: AlternateUrls;
  locator: SourceLocator;
};

type DecorationExtras = {
  alternateUrls?: AlternateUrls;
  citation?: string;
  url?: string;
  locator?: SourceLocator;
};

/** Canonical citation/url/locator decoration for passages and passage-like records. */
export const decoratePassage = <T extends CitationSource>(
  source: T & DecorationExtras,
): DecoratedPassage<T> => {
  const { alternateUrls: _alternateUrls, citation: _citation, url: _url, locator: _locator, ...passage } = source;
  const alternateUrls = getAlternateUrls(source);
  return {
    ...passage,
    citation: formatCitation(source),
    url: getSourceUrl(source),
    ...(alternateUrls && { alternateUrls }),
    locator: getLocator(source),
  };
};
