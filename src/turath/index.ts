export { createTurathClient } from "./client.js";
export {
  findCatalogAuthors as findAuthors,
  findCatalogBooks as findBooks,
  getCatalogMetadata,
  listCatalogCategories as listCategories,
} from "./catalog.js";
export type { FindAuthorsOptions, FindBooksOptions } from "./catalog.js";
export type {
  ContextOptions,
  RequestOptions,
  RetrieveOptions,
  TurathClient,
  TurathClientOptions,
  TurathSearchOptions,
} from "./client.js";
export { decoratePassage, formatCitation, getLocator, getSourceUrl } from "./citations.js";
export type { CitationSource } from "./citations.js";
