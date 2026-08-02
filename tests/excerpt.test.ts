import { describe, expect, test } from "bun:test";
import { boundText, findNeedle, foldWhitespace, snippetNeedles, truncatePrefix } from "../src/turath/excerpt.js";

describe("excerpt engine", () => {
  test("centers match-window across multiline page text using folded whitespace", () => {
    const prefix = "أ".repeat(100);
    const suffix = "ب".repeat(100);
    // Needle is whitespace-normalized; page has a real line break inside the match span.
    const pageText = `${prefix}كلمة\nالبحث_المميزة${suffix}`;
    const result = boundText(pageText, 40, "مقدمة <em>كلمة البحث_المميزة</em> خاتمة");
    expect(result.truncation).toBe("match-window");
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(40);
    expect(result.text).toContain("كلمة");
    expect(result.text).toContain("البحث_المميزة");
    expect(result.text.startsWith("أ".repeat(40))).toBe(false);
  });

  test("maps folded match offsets back to raw text without rewriting source", () => {
    const text = "مقدمة\n\nالنص المطابق\nخاتمة";
    const found = findNeedle(text, "النص المطابق");
    expect(found).toBeDefined();
    expect(text.slice(found!.index, found!.index + found!.length)).toBe("النص المطابق");
    const { folded, map } = foldWhitespace(text);
    expect(folded).toContain("النص المطابق");
    expect(map[folded.indexOf("النص")]).toBe(text.indexOf("النص"));
  });

  test("hard-caps long matches and preserves short full pages", () => {
    const long = "مميزة".repeat(50);
    const page = `${"أ".repeat(20)}${long}${"ب".repeat(20)}`;
    const capped = boundText(page, 25, `<em>${long}</em>`);
    expect(capped.text.length).toBeLessThanOrEqual(25);
    expect(long).toContain(capped.text);
    expect(capped.truncation).toBe("match-window");

    const short = "نص قصير كامل";
    const full = boundText(short, 100, "نص");
    expect(full).toEqual({ text: short, offset: 0, truncated: false });
  });

  test("does not keep a second prefix ladder in snippetNeedles", () => {
    const plain = "س".repeat(80);
    const needles = snippetNeedles(plain);
    // Full plain + cleaned only; no pre-sliced 64/48/... ladder.
    expect(needles.filter((n) => n === plain || n.startsWith("س"))).toEqual([plain]);
  });

  test("reports the adjusted offset when a window would split a surrogate pair", () => {
    const text = `😀${"a".repeat(9)}needle${"b".repeat(20)}`;
    const result = boundText(text, 26, "needle");
    expect(result.offset).toBe(2);
    expect(result.text).toBe(text.slice(result.offset, result.offset + result.text.length));
  });

  test("prefix fallback still works without a snippet match", () => {
    const page = `${"أ".repeat(60)}نهاية`;
    const result = boundText(page, 20, "لا_تطابق");
    expect(result).toEqual({ text: truncatePrefix(page, 20), offset: 0, truncated: true, truncation: "prefix" });
  });
});
