import { describe, expect, test } from "bun:test";
import {
  findCatalogAuthors,
  findCatalogBooks,
  getCatalogMetadata,
  listCatalogCategories,
} from "../src/turath/catalog.js";

describe("catalog metadata and authors", () => {
  test("exposes snapshot metadata from the bundled catalog", () => {
    const meta = getCatalogMetadata();
    expect(meta.scannedAt).toBe("2026-03-23");
    // Intentional snapshot canaries: update these constants when refreshing catalog-data.ts / catalog-authors.ts.
    expect(meta.bookCount).toBe(8124);
    expect(meta.categoryCount).toBe(40);
    expect(meta.authorIdCount).toBe(3037);
    expect(meta.authorNameCount).toBeGreaterThanOrEqual(1);
    expect(meta.unresolvedAuthorIdCount).toBe(meta.authorIdCount - meta.authorNameCount);
    expect(meta.unresolvedAuthorIdCount).toBeGreaterThanOrEqual(0);
    expect(listCatalogCategories()).toHaveLength(meta.categoryCount);
  });

  test("full-coverage metadata invariants hold for known catalog author IDs", () => {
    const meta = getCatalogMetadata();
    expect(meta.authorNameCount + meta.unresolvedAuthorIdCount).toBe(meta.authorIdCount);
    expect(meta.authorNameCount).toBeLessThanOrEqual(meta.authorIdCount);
    // Intentional full-coverage canary for the known catalog snapshot.
    // Official GET /author returned a verified name for every known catalog author ID.
    // Update expected counts when refreshing the bundled snapshot.
    expect(meta.authorNameCount).toBe(meta.authorIdCount);
    expect(meta.unresolvedAuthorIdCount).toBe(0);
    expect(meta.authorIdCount).toBe(3037);
  });

  test("findAuthors matches verified offline author names", () => {
    const authors = findCatalogAuthors("النووي");
    expect(authors[0]).toMatchObject({ id: "44", name: "النووي", provider: "turath" });
  });

  test("findBooks hydrates author names from the offline map when available", () => {
    const books = findCatalogBooks("الأربعون النووية");
    const withAuthor = books.find((book) => book.author?.id === "44");
    expect(withAuthor?.author?.name).toBe("النووي");
  });

  test("findBooks supports author/category filters without a title query", () => {
    const byAuthor = findCatalogBooks("", { authorIds: [44], limit: 5 });
    expect(byAuthor.length).toBeGreaterThan(0);
    expect(byAuthor.every((book) => book.author?.id === "44")).toBe(true);

    const byCategory = findCatalogBooks("", { categoryIds: [15], limit: 3 });
    expect(byCategory).toHaveLength(3);
    expect(byCategory.every((book) => book.category?.id === "15")).toBe(true);

    const combined = findCatalogBooks("", { authorIds: [214], categoryIds: [15], limit: 5 });
    expect(combined.length).toBeGreaterThan(0);
    expect(combined.every((book) => book.author?.id === "214" && book.category?.id === "15")).toBe(true);
  });

  test("findBooks rejects empty query without filters", () => {
    expect(() => findCatalogBooks("")).toThrow(/query must not be empty/);
    expect(() => findCatalogBooks("   ")).toThrow(/query must not be empty/);
  });
});
