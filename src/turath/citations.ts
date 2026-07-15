import type { Passage } from "../models.js";

export type CitationSource = Pick<Passage, "author" | "book" | "location">;

export const getSourceUrl = (source: CitationSource): string => {
  const url = new URL(`https://app.turath.io/book/${source.book.id}`);
  if (source.location.internalPage !== undefined) {
    url.searchParams.set("page", String(source.location.internalPage));
  }
  return url.href;
};

export const formatCitation = (source: CitationSource): string => {
  const parts = [source.author?.name, source.book.title].filter(Boolean) as string[];
  if (source.location.volume) parts.push(`ج ${source.location.volume}`);
  if (source.location.printedPage !== undefined) parts.push(`ص ${source.location.printedPage}`);
  else if (source.location.internalPage !== undefined) parts.push(`صفحة تراث ${source.location.internalPage}`);
  return parts.join("، ");
};
