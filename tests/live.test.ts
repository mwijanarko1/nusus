import { expect, test } from "bun:test";
import { createTurathClient } from "../src/turath/client.js";

const turath = createTurathClient();
const liveTest = Bun.env.NUSUS_LIVE ? test : test.skip;

liveTest("live Turath smoke", async () => {
  const [author, book, page, search] = await Promise.all([
    turath.getAuthor(44),
    turath.getBook(147927),
    turath.getPage(147927, 5),
    turath.search("إنما الأعمال بالنيات", { bookIds: [147927] }),
  ]);

  expect(author.id).toBe("44");
  expect(book.id).toBe("147927");
  expect(page.location.internalPage).toBe(5);
  expect(search.items.length).toBeGreaterThan(0);
});
