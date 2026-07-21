import { describe, expect, test } from "bun:test";
import { decoratePassage, formatCitation, getLocator, getSourceUrl } from "../src/turath/citations.js";

const source = {
  author: { name: "النووي" },
  book: { id: "147927", title: "الأربعون النووية مع زيادات ابن رجب" },
  location: { internalPage: 5, printedPage: 5, volume: "1" },
};

describe("citations and locators", () => {
  test("default citation includes Turath book id and internal page", () => {
    const citation = formatCitation(source);
    expect(citation).toContain("النووي");
    expect(citation).toContain("الأربعون النووية مع زيادات ابن رجب");
    expect(citation).toContain("ج 1");
    expect(citation).toContain("ص 5");
    expect(citation).toContain("صفحة تراث 5");
    expect(citation).toContain("تراث 147927");
  });

  test("locator exposes book id, internal page, and app URL even when printed page is set", () => {
    const locator = getLocator(source);
    expect(locator).toEqual({
      bookId: "147927",
      internalPage: 5,
      printedPage: 5,
      volume: "1",
      url: "https://app.turath.io/book/147927?page=5",
    });
    expect(getSourceUrl(source)).toBe(locator.url);
  });

  test("citation still carries book id when only internal page exists", () => {
    const citation = formatCitation({
      book: { id: "99", title: "كتاب" },
      location: { internalPage: 3 },
    });
    expect(citation).toBe("كتاب، صفحة تراث 3، تراث 99");
  });

  test("decoratePassage is the canonical citation/url/locator helper", () => {
    const decorated = decoratePassage({
      provider: "turath" as const,
      book: source.book,
      author: source.author,
      location: source.location,
      text: "نص",
      headings: [],
    });
    expect(decorated.citation).toBe(formatCitation(source));
    expect(decorated.url).toBe(getSourceUrl(source));
    expect(decorated.locator).toEqual(getLocator(source));
    expect(decorated.text).toBe("نص");
  });
});
