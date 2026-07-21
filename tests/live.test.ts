import { expect, test } from "bun:test";
import { createTurathClient } from "../src/turath/client.js";

const turath = createTurathClient();
const liveTest = Bun.env.NUSUS_LIVE ? test : test.skip;

liveTest("live Turath contract shapes", async () => {
  const [author, book, page, search, retrieved] = await Promise.all([
    turath.getAuthor(44),
    turath.getBook(147927),
    turath.getPage(147927, 5),
    turath.search("إنما الأعمال بالنيات", { bookIds: [147927] }),
    turath.retrieve("إنما الأعمال بالنيات", {
      maxPassages: 1,
      maxCharsPerPassage: 500,
      scope: { bookIds: [147927] },
    }),
  ]);

  expect(author.id).toBe("44");
  expect(typeof author.name).toBe("string");
  expect(author.name!.length).toBeGreaterThan(0);

  expect(book.id).toBe("147927");
  expect(book.title.length).toBeGreaterThan(0);

  expect(page.location.internalPage).toBe(5);
  expect(page.locator?.bookId).toBe("147927");
  expect(page.locator?.internalPage).toBe(5);
  expect(page.locator?.url).toContain("147927");
  expect(page.citation).toContain("تراث 147927");
  expect(page.citation).toContain("صفحة تراث 5");
  expect(page.url).toBe(page.locator?.url);
  expect(page.text.length).toBeGreaterThan(0);

  expect(search.items.length).toBeGreaterThan(0);
  expect(search.items[0]?.book.id).toBe("147927");
  expect(search.items[0]?.locator?.url).toContain("app.turath.io/book/");

  expect(retrieved.passages).toHaveLength(1);
  const passage = retrieved.passages[0]!;
  expect(passage.citation.length).toBeGreaterThan(0);
  expect(passage.url).toContain("app.turath.io/book/");
  expect(passage.locator?.bookId).toBeTruthy();
  expect(passage.provenance?.query).toBe("إنما الأعمال بالنيات");
  expect(passage.provenance?.rank).toBe(0);
  expect(typeof passage.provenance?.totalMatches).toBe("number");
});
