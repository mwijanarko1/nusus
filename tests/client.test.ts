import { describe, expect, test } from "bun:test";
import { NususError } from "../src/errors.js";
import { createTurathClient } from "../src/turath/client.js";

const fixture = (name: string) => Bun.file(new URL(`fixtures/${name}.json`, import.meta.url)).json();
const [author, book, page, search] = await Promise.all([
  fixture("author-44"),
  fixture("book-147927"),
  fixture("page-147927-5"),
  fixture("search-book-147927"),
]);

const calls: URL[] = [];
const client = createTurathClient({
  fetch: (async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const body = url.pathname.endsWith("/author")
      ? author
      : url.pathname.endsWith("/book")
        ? book
        : url.pathname.endsWith("/page")
          ? page
          : search;
    return Response.json(body);
  }) as typeof fetch,
});

describe("Turath client", () => {
  test("normalizes authors, books, pages, and citations", async () => {
    const normalizedAuthor = await client.getAuthor(44);
    const normalizedBook = await client.getBook("147927");
    const normalizedPage = await client.getPage(147927, 5);

    expect(normalizedAuthor.name).toBe("النووي");
    expect(normalizedBook.title).toBe("الأربعون النووية مع زيادات ابن رجب");
    expect(normalizedBook.author?.id).toBe("44");
    expect(normalizedPage.headings).toContain("الحديث الأول: [الأعمال بالنيات]");
    expect(normalizedPage.citation).toBe("النووي، الأربعون النووية مع زيادات ابن رجب، ج 1، ص 5");
    expect(normalizedPage.url).toBe("https://app.turath.io/book/147927?page=5");
  });

  test("discovers books and categories from the bundled catalog without HTTP", () => {
    calls.length = 0;
    const books = client.findBooks("المُدَوَّنة", { categoryIds: [15] });
    const categories = client.listCategories();

    expect(books[0]).toMatchObject({ id: "587", title: "المدونة", author: { id: "214" }, category: { id: "15" } });
    expect(categories.find((category) => category.id === "15")).toMatchObject({ title: "الفقه المالكي", bookCount: 79 });
    expect(calls).toHaveLength(0);
  });

  test("maps public search filters to verified upstream parameters", async () => {
    calls.length = 0;
    const result = await client.search("الإسلام", { bookIds: [147927], sort: "page" });

    expect(result.items.length).toBeGreaterThan(0);
    expect(calls[0]?.searchParams.get("book")).toBe("147927");
    expect(calls[0]?.searchParams.get("sort")).toBe("page_id");
    expect(calls[0]?.searchParams.get("ver")).toBe("3");
  });

  test("rejects unsupported multi-ID filters", async () => {
    await expect(client.search("test", { bookIds: [1, 2] })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  test("returns bounded, citation-carrying agent context", async () => {
    const result = await client.retrieve("الإسلام", { maxPassages: 2, maxCharsPerPassage: 80 });

    expect(result.passages).toHaveLength(2);
    expect(result.passages.every((item) => item.text.length <= 80)).toBe(true);
    expect(result.passages.every((item) => item.citation && item.url)).toBe(true);
    expect(result.totalMatches).toBe(search.count);
  });

  test("paginates retrieve beyond the upstream page size", async () => {
    const pagesRequested: string[] = [];
    const hit = search.data[0];
    const paged = createTurathClient({
      fetch: (async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/page")) return Response.json(page);
        pagesRequested.push(url.searchParams.get("page") ?? "1");
        return Response.json({ count: 21, data: url.searchParams.get("page") === "2" ? [hit] : Array(20).fill(hit) });
      }) as typeof fetch,
    });

    const result = await paged.retrieve("الإسلام", { maxPassages: 21 });
    expect(result.passages).toHaveLength(21);
    expect(pagesRequested).toEqual(["1", "2"]);
  });

  test("maps empty-object records to NOT_FOUND", async () => {
    const missing = createTurathClient({ fetch: (async () => Response.json({})) as typeof fetch });
    try {
      await missing.getAuthor(999999999);
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(NususError);
      expect(error).toMatchObject({ code: "NOT_FOUND" });
    }
  });
});
