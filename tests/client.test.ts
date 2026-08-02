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
    expect(normalizedBook.toc?.[0]).toMatchObject({ title: "تقديم مصطفى العدوي", level: 1, page: 2 });
    expect(normalizedBook.volumes).toEqual(["1"]);
    expect(normalizedPage.headings).toContain("الحديث الأول: [الأعمال بالنيات]");
    expect(normalizedPage.text).not.toContain("<span");
    expect(normalizedPage.text).toStartWith("الحديث الأول: [الأعمال بالنيات]");
    expect(normalizedPage.citation).toBe("النووي، الأربعون النووية مع زيادات ابن رجب، ج 1، ص 5، صفحة تراث 5، تراث 147927");
    expect(normalizedPage.url).toBe("https://app.turath.io/book/147927?page=5");
    expect(normalizedPage.locator).toEqual({
      bookId: "147927",
      internalPage: 5,
      printedPage: 5,
      volume: "1",
      url: "https://app.turath.io/book/147927?page=5",
    });
  });

  test("findBooks lists books by author without a title query", () => {
    calls.length = 0;
    const books = client.findBooks("", { authorIds: [44], limit: 5 });
    expect(books.length).toBeGreaterThan(0);
    expect(books.every((book) => book.author?.id === "44")).toBe(true);
    expect(calls).toHaveLength(0);
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
    expect(result.passages.every((item) => !Object.hasOwn(item, "raw"))).toBe(true);
    expect(result.passages[0]?.author?.id).toBe("44");
    expect(result.passages[0]?.category?.id).toBe("6");
    expect(result.totalMatches).toBe(search.count);
  });

  test("falls back to a normalized Arabic query only after an exact miss", async () => {
    const queries: string[] = [];
    const fallback = createTurathClient({
      fetch: (async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/page")) return Response.json(page);
        const query = url.searchParams.get("q") ?? "";
        queries.push(query);
        return Response.json(query === "الحمد لله رب العالمين" ? { count: 1, data: [search.data[0]] } : { count: 0, data: [] });
      }) as typeof fetch,
    });

    const query = "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ";
    const result = await fallback.retrieve(query, { maxPassages: 1 });
    expect(queries).toEqual([query, "الحمد لله رب العالمين"]);
    expect(result.effectiveQuery).toBe("الحمد لله رب العالمين");
    expect(result.passages[0]?.provenance?.effectiveQuery).toBe("الحمد لله رب العالمين");
  });

  test("normalizes combining hamza, whitespace, and alternate hamza seats on fallback", async () => {
    const querySets: string[][] = [];
    for (const [query, accepted] of [
      ["مؤمن", "مؤمن"],
      ["الحمد ", "الحمد"],
      ["مسئول", "مسؤول"],
    ]) {
      const queries: string[] = [];
      const fallback = createTurathClient({
        fetch: (async (input) => {
          const value = new URL(String(input)).searchParams.get("q") ?? "";
          queries.push(value);
          return Response.json(value === accepted ? { count: 1, data: [search.data[0]] } : { count: 0, data: [] });
        }) as typeof fetch,
      });
      const result = await fallback.search(query);
      expect(result.effectiveQuery).toBe(accepted);
      querySets.push(queries);
    }
    expect(querySets).toEqual([
      ["مؤمن", "مؤمن"],
      ["الحمد ", "الحمد"],
      ["مسئول", "مسءول", "مسؤول"],
    ]);
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

describe("retrieve context and provenance", () => {
  test("centers excerpts on the search match instead of the page prefix", async () => {
    const prefix = "أ".repeat(200);
    const match = "كلمة_البحث_المميزة";
    const suffix = "ب".repeat(200);
    const pageText = `${prefix}${match}${suffix}`;
    const smart = createTurathClient({
      fetch: (async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/page")) {
          return Response.json({
            meta: JSON.stringify({
              headings: [],
              page_id: 9,
              page: 9,
              vol: "1",
              book_name: "كتاب الاختبار",
              author_name: "مؤلف",
            }),
            text: pageText,
          });
        }
        return Response.json({
          count: 1,
          data: [{
            book_id: 1,
            cat_id: 1,
            author_id: 1,
            meta: JSON.stringify({
              headings: [],
              page_id: 9,
              page: 9,
              vol: "1",
              book_name: "كتاب الاختبار",
              author_name: "مؤلف",
            }),
            snip: `مقدمة <em>${match}</em> خاتمة`,
            text: pageText,
          }],
        });
      }) as typeof fetch,
    });

    const result = await smart.retrieve("كلمة", { maxPassages: 1, maxCharsPerPassage: 80 });
    const passage = result.passages[0]!;
    expect(passage.text).toContain(match);
    expect(passage.text.startsWith("أ".repeat(80))).toBe(false);
    expect(passage.provenance?.truncated).toBe(true);
    expect(passage.provenance?.truncation).toBe("match-window");
    expect(passage.provenance?.rank).toBe(0);
    expect(passage.provenance?.query).toBe("كلمة");
    expect(passage.locator?.bookId).toBe("1");
    expect(passage.locator?.internalPage).toBe(9);
    expect(passage.locator?.url).toContain("page=9");
  });

  test("falls back to prefix truncation when no snippet match exists", async () => {
    const pageText = `${"أ".repeat(120)}نهاية`;
    const plain = createTurathClient({
      fetch: (async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/page")) {
          return Response.json({
            meta: JSON.stringify({
              headings: [],
              page_id: 2,
              page: 2,
              book_name: "كتاب",
            }),
            text: pageText,
          });
        }
        return Response.json({
          count: 1,
          data: [{
            book_id: 2,
            meta: JSON.stringify({ headings: [], page_id: 2, page: 2, book_name: "كتاب" }),
            text: pageText,
          }],
        });
      }) as typeof fetch,
    });

    const result = await plain.retrieve("بحث", { maxPassages: 1, maxCharsPerPassage: 40 });
    expect(result.passages[0]?.text).toBe("أ".repeat(40));
    expect(result.passages[0]?.provenance?.truncation).toBe("prefix");
  });

  test("getContextByPage fetches each page once without a redundant center prefetch", async () => {
    const pagesRequested: string[] = [];
    const byPage = createTurathClient({
      fetch: (async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/page")) {
          const pg = url.searchParams.get("pg") ?? "?";
          pagesRequested.push(pg);
          return Response.json({
            meta: JSON.stringify({
              headings: [`h${pg}`],
              page_id: Number(pg),
              page: Number(pg),
              book_name: "كتاب",
              author_name: "مؤلف",
            }),
            text: `نص الصفحة ${pg}`,
          });
        }
        return Response.json({});
      }) as typeof fetch,
    });

    await byPage.getContextByPage(3, 5, { pagesBefore: 1, pagesAfter: 1 });
    expect(pagesRequested.sort()).toEqual(["4", "5", "6"]);
  });

  test("includes adjacent pages only when requested", async () => {
    const pages: string[] = [];
    const adjacent = createTurathClient({
      fetch: (async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/page")) {
          const pg = url.searchParams.get("pg") ?? "?";
          pages.push(pg);
          return Response.json({
            meta: JSON.stringify({
              headings: [`h${pg}`],
              page_id: Number(pg),
              page: Number(pg),
              book_name: "كتاب",
              author_name: "مؤلف",
            }),
            text: `نص الصفحة ${pg}`,
          });
        }
        return Response.json({
          count: 1,
          data: [{
            book_id: 3,
            meta: JSON.stringify({ headings: [], page_id: 5, page: 5, book_name: "كتاب", author_name: "مؤلف" }),
            snip: "نص",
            text: "نص الصفحة 5",
          }],
        });
      }) as typeof fetch,
    });

    const one = await adjacent.retrieve("نص", { maxPassages: 1, maxCharsPerPassage: 500 });
    expect(one.passages[0]?.text).toBe("نص الصفحة 5");
    expect(one.passages[0]?.provenance?.contextPages).toEqual({ before: 0, after: 0 });

    pages.length = 0;
    const wide = await adjacent.retrieve("نص", {
      maxPassages: 1,
      maxCharsPerPassage: 500,
      pagesBefore: 1,
      pagesAfter: 1,
    });
    expect(pages.sort()).toEqual(["4", "5", "6"]);
    expect(wide.passages[0]?.text).toContain("نص الصفحة 4");
    expect(wide.passages[0]?.text).toContain("نص الصفحة 5");
    expect(wide.passages[0]?.text).toContain("نص الصفحة 6");
    expect(wide.passages[0]?.provenance?.contextPages).toEqual({ before: 1, after: 1 });
    expect(wide.passages[0]?.segments).toHaveLength(3);
    for (const segment of wide.passages[0]?.segments ?? []) {
      expect(wide.passages[0]?.text.slice(segment.start, segment.end)).toBe(`نص الصفحة ${segment.location.internalPage}`);
      expect(segment.citation).toContain(`صفحة تراث ${segment.location.internalPage}`);
    }
  });

  test("echoes retrieve scope in provenance", async () => {
    const result = await client.retrieve("الإسلام", {
      maxPassages: 1,
      maxCharsPerPassage: 100,
      scope: { bookIds: [147927] },
    });
    expect(result.passages[0]?.provenance?.scope).toEqual({ bookIds: [147927] });
    expect(result.passages[0]?.provenance?.totalMatches).toBe(search.count);
    expect(result.passages[0]?.provenance).not.toHaveProperty("catalogScannedAt");
  });

  test("maxCharsPerPassage hard-caps long em matches and long plain snippets", async () => {
    const longMatch = "مميزة".repeat(40); // 200 chars
    const pageText = `${"أ".repeat(80)}${longMatch}${"ب".repeat(80)}`;
    const make = (snip: string) => createTurathClient({
      fetch: (async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/page")) {
          return Response.json({
            meta: JSON.stringify({ headings: [], page_id: 3, page: 3, book_name: "كتاب" }),
            text: pageText,
          });
        }
        return Response.json({
          count: 1,
          data: [{
            book_id: 3,
            meta: JSON.stringify({ headings: [], page_id: 3, page: 3, book_name: "كتاب" }),
            snip,
            text: pageText,
          }],
        });
      }) as typeof fetch,
    });

    const em = await make(`قبل <em>${longMatch}</em> بعد`).retrieve("مميزة", {
      maxPassages: 1,
      maxCharsPerPassage: 30,
    });
    expect(em.passages[0]!.text.length).toBeLessThanOrEqual(30);
    expect(em.passages[0]!.text.length).toBeGreaterThan(0);
    expect(longMatch).toContain(em.passages[0]!.text);
    expect(em.passages[0]!.provenance?.truncation).toBe("match-window");

    const plain = await make(longMatch).retrieve("مميزة", {
      maxPassages: 1,
      maxCharsPerPassage: 30,
    });
    expect(plain.passages[0]!.text.length).toBeLessThanOrEqual(30);
    expect(longMatch).toContain(plain.passages[0]!.text);
    expect(plain.passages[0]!.text).toContain("مميزة");
    expect(plain.passages[0]!.provenance?.truncation).toBe("match-window");
  });

  test("locates matches inside malformed nested Turath snippet HTML", async () => {
    const pageText = `${"أ".repeat(120)}لب الإسلام لب${"ب".repeat(120)}`;
    const snip = '<span data-type="title" id=toc-26>الحديث الحادي والعشرون: [الاستقامة لُبُّ <em>الإسلام]</span></em>\nعَنْ أَبِي عَمْرٍو';
    const broken = createTurathClient({
      fetch: (async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/page")) {
          return Response.json({
            meta: JSON.stringify({ headings: [], page_id: 25, page: 25, book_name: "كتاب" }),
            text: pageText,
          });
        }
        return Response.json({
          count: 1,
          data: [{
            book_id: 25,
            meta: JSON.stringify({ headings: [], page_id: 25, page: 25, book_name: "كتاب" }),
            snip,
            text: pageText,
          }],
        });
      }) as typeof fetch,
    });

    const result = await broken.retrieve("الإسلام", {
      maxPassages: 1,
      maxCharsPerPassage: 40,
    });
    const passage = result.passages[0]!;
    expect(passage.text.length).toBeLessThanOrEqual(40);
    expect(passage.text).toContain("الإسلام");
    expect(passage.text.startsWith("أ".repeat(40))).toBe(false);
    expect(passage.provenance?.truncation).toBe("match-window");
  });
});
