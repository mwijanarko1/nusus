#!/usr/bin/env node
// Agent-facing Turath search CLI built on nusus.
// Drop-in replacement for the old turath-sdk search.mjs.
//
// Usage:
//   node search.mjs "<Arabic query>" [max_results]
//   node search.mjs --madhhab hanafi|maliki|shafii|hanbali "<topic>" [max_results]
//   node search.mjs --books "بدائع الصنائع,الهداية" "<query>" [max_results]
//   node search.mjs --book-id 147927 "<query>" [max_results]
//   node search.mjs --page <book_id> <page_id>          # fetch one page + context
//
// Output: JSON per line — book_id, title, author, volume, page_id, printed_page,
// headings, citation, url, text (bounded), prev/next context.

import { createTurathClient } from "../dist/turath/index.js";

const MADHHAB_BOOKS = {
  hanafi: ["رد المحتار ابن عابدين", "الهداية المرغيناني", "فتح القدير ابن الهمام", "بدائع الصنائع الكاساني", "المبسوط السرخسي"],
  maliki: ["مختصر خليل", "المدونة الكبرى سحنون", "التوضيح شرح مختصر ابن الحاجب خليل", "الشرح الكبير الدردير حاشية الدسوقي", "مواهب الجليل الحطاب"],
  shafii: ["منهاج الطالبين النووي", "تحفة المحتاج ابن حجر الهيتمي", "نهاية المحتاج الرملي", "مغني المحتاج الشربيني", "المجموع شرح المهذب النووي"],
  hanbali: ["منتهى الإرادات ابن النجار", "الإقناع الحجاوي", "كشاف القناع البهوتي", "شرح منتهى الإرادات البهوتي", "المغني ابن قدامة"],
};

const MADHHAB_LABELS = {
  hanafi: { name: "الحنفية", at: "عند الحنفية", fi: "في مذهب الحنفية" },
  maliki: { name: "المالكية", at: "عند المالكية", fi: "في المذهب المالكي" },
  shafii: { name: "الشافعية", at: "عند الشافعية", fi: "في مذهب الشافعية" },
  hanbali: { name: "الحنابلة", at: "عند الحنابلة", fi: "في المذهب الحنبلي" },
};

// === arg parsing ===
const args = process.argv.slice(2);
let madhhab = null;
let books = null;
let bookId = null;
let pageMode = false;
let query = null;
let maxResults = 5;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--madhhab") {
    madhhab = args[++i]?.toLowerCase();
    if (!MADHHAB_BOOKS[madhhab]) fail(`Invalid madhhab. Use: ${Object.keys(MADHHAB_BOOKS).join(", ")}`);
  } else if (a === "--books") books = args[++i]?.split(",").map((s) => s.trim()).filter(Boolean);
  else if (a === "--book-id") bookId = args[++i];
  else if (a === "--page") pageMode = true;
  else if (a === "--topic") query = args[++i];
  else if (!a.startsWith("--") && query === null && isNaN(Number(a))) query = a;
}
// last numeric non-flag arg = max results (or page args in --page mode)
const numbers = args.filter((a) => !a.startsWith("--") && /^\d+$/.test(a));
if (numbers.length && !pageMode) maxResults = parseInt(numbers[numbers.length - 1], 10);

function fail(message) {
  console.error(message);
  process.exit(1);
}

const turath = createTurathClient({ timeout: 15_000 });

const emit = (item) => console.log(JSON.stringify(item));

const passageToJson = (p, extra = {}) => ({
  book_id: Number(p.book.id),
  title: p.book.title,
  author: p.author?.name,
  volume: p.location.volume,
  page_id: p.location.internalPage,
  printed_page: p.location.printedPage,
  headings: p.headings.join(" > "),
  citation: p.citation,
  url: p.url,
  ...extra,
});

// === page mode: node search.mjs --page <book_id> <page_id> ===
if (pageMode) {
  const [pBook, pPage] = numbers;
  if (!pBook || !pPage) fail("Usage: node search.mjs --page <book_id> <page_id>");
  const page = await turath.getPage(pBook, pPage);
  const context = await turath.getContext(page, { pagesBefore: 1, pagesAfter: 1 });
  emit(passageToJson(page, { text: page.text, context_text: context.text }));
  process.exit(0);
}

if (!query) fail('Usage: node search.mjs [--madhhab hanafi|maliki|shafii|hanbali] [--books "t1,t2"] [--book-id N] "<query>" [max_results]');

// === build tiered queries ===
const searchQueries = [];
if (madhhab) {
  const label = MADHHAB_LABELS[madhhab];
  searchQueries.push({ q: `${query} ${label.at}`, tier: 1, source_type: `madhhab:${madhhab}` });
  searchQueries.push({ q: `${query} ${label.fi}`, tier: 1, source_type: `madhhab:${madhhab}` });
  searchQueries.push({ q: `${query} ${label.name}`, tier: 2, source_type: `madhhab:${madhhab}` });
  for (const book of MADHHAB_BOOKS[madhhab]) {
    searchQueries.push({ q: `${query} ${book}`, tier: 3, source_type: `book:${madhhab}` });
  }
} else if (books) {
  for (const b of books) searchQueries.push({ q: `${query} ${b}`, tier: 3, source_type: "targeted" });
}
searchQueries.push({ q: query, tier: 4, source_type: "broad" });

// === execute ===
const seen = new Set();
const collected = [];
const scope = bookId ? { bookIds: [bookId] } : undefined;

for (const sq of searchQueries) {
  if (collected.length >= maxResults * 3) break;
  try {
    const result = await turath.search(sq.q, scope ? { ...scope } : {});
    for (const hit of result.items) {
      const key = `${hit.book.id}:${hit.location.internalPage ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push({ hit, tier: sq.tier, source_type: sq.source_type, matched_term: sq.q.replace(query, "").trim() });
    }
  } catch {
    // skip failed tier queries; broad fallback still runs
  }
}

collected.sort((a, b) => a.tier - b.tier);
const top = collected.slice(0, maxResults);

for (const { hit, tier, source_type, matched_term } of top) {
  let text = hit.text;
  let prevTail = "";
  let nextHead = "";
  if (hit.location.internalPage !== undefined) {
    try {
      const page = await turath.getPage(hit.book.id, hit.location.internalPage);
      text = page.text;
      const pg = hit.location.internalPage;
      if (pg > 1) {
        try { prevTail = (await turath.getPage(hit.book.id, pg - 1)).text.slice(-300); } catch {}
      }
      try { nextHead = (await turath.getPage(hit.book.id, pg + 1)).text.slice(0, 300); } catch {}
    } catch {}
  }
  emit(passageToJson(hit, {
    source_type,
    tier,
    matched_term,
    snippet: hit.snippet,
    prev_text_tail: prevTail,
    text: text.slice(0, 1500),
    next_text_head: nextHead,
  }));
}

if (top.length === 0) emit({ error: "No results", query, madhhab });
