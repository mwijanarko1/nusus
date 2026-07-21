import type { Passage, SourceLocator } from "../models.js";

export type CitationSource = Pick<Passage, "author" | "book" | "location">;

export const getSourceUrl = (source: CitationSource): string => {
  const url = new URL(`https://app.turath.io/book/${source.book.id}`);
  if (source.location.internalPage !== undefined) {
    url.searchParams.set("page", String(source.location.internalPage));
  }
  return url.href;
};

export const getLocator = (source: CitationSource): SourceLocator => ({
  bookId: source.book.id,
  ...(source.location.internalPage !== undefined && { internalPage: source.location.internalPage }),
  ...(source.location.printedPage !== undefined && { printedPage: source.location.printedPage }),
  ...(source.location.volume && { volume: source.location.volume }),
  url: getSourceUrl(source),
});

export const formatCitation = (source: CitationSource): string => {
  const parts = [source.author?.name, source.book.title].filter(Boolean) as string[];
  if (source.location.volume) parts.push(`ج ${source.location.volume}`);
  if (source.location.printedPage !== undefined) parts.push(`ص ${source.location.printedPage}`);
  if (source.location.internalPage !== undefined) parts.push(`صفحة تراث ${source.location.internalPage}`);
  parts.push(`تراث ${source.book.id}`);
  return parts.join("، ");
};

/** Canonical citation/url/locator decoration for passages and passage-like records. */
export const decoratePassage = <T extends CitationSource>(
  source: T,
): T & { citation: string; url: string; locator: SourceLocator } => ({
  ...source,
  citation: formatCitation(source),
  url: getSourceUrl(source),
  locator: getLocator(source),
});
