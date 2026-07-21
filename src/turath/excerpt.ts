/** Pure match-window excerpting for retrieve(); no transport/catalog deps. */

const stripTags = (value: string): string => value.replace(/<[^>]*>/g, "");

export const safeSlice = (text: string, start: number, end: number): string => {
  let from = Math.max(0, start);
  let to = Math.min(text.length, end);
  // avoid splitting surrogate pairs at either edge
  if (from > 0 && /[\uDC00-\uDFFF]/.test(text[from]!) && /[\uD800-\uDBFF]/.test(text[from - 1]!)) from += 1;
  if (to > 0 && to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1]!) && /[\uDC00-\uDFFF]/.test(text[to]!)) to -= 1;
  return text.slice(from, to);
};

export const truncatePrefix = (text: string, maxChars: number): string => {
  const cut = text.slice(0, maxChars);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
};

const cleanNeedle = (value: string): string =>
  value
    .replace(/\s+/g, " ")
    .replace(/^[‏‎\s\[\](){}<>«»"'`،,.:;!?…]+|[‏‎\s\[\](){}<>«»"'`،,.:;!?…]+$/g, "")
    .trim();

/** Collapse whitespace while mapping each folded index back to a raw code-unit index. */
export const foldWhitespace = (text: string): { folded: string; map: number[] } => {
  const map: number[] = [];
  let folded = "";
  let lastWasSpace = true;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        map.push(i);
        folded += " ";
        lastWasSpace = true;
      }
      continue;
    }
    map.push(i);
    folded += ch;
    lastWasSpace = false;
  }
  if (folded.endsWith(" ")) {
    folded = folded.slice(0, -1);
    map.pop();
  }
  return { folded, map };
};

/** Build match candidates from Turath snippets, including broken nested markup. */
export const snippetNeedles = (snippet?: string): string[] => {
  if (!snippet) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined) => {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
    const cleaned = cleanNeedle(normalized);
    if (cleaned && cleaned !== normalized && !seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  };

  // Tolerate Turath's malformed nests like <em>الإسلام]</span></em>
  for (const match of snippet.matchAll(/<em\b[^>]*>([\s\S]*?)<\/em>/gi)) {
    add(stripTags(match[1] ?? ""));
  }

  add(stripTags(snippet));
  return out;
};

const locateInFolded = (
  folded: string,
  map: number[],
  needle: string,
): { index: number; length: number } | undefined => {
  if (!needle || !folded) return undefined;
  const foldedIndex = folded.indexOf(needle);
  if (foldedIndex < 0) return undefined;
  const rawStart = map[foldedIndex];
  const rawLast = map[foldedIndex + needle.length - 1];
  if (rawStart === undefined || rawLast === undefined) return undefined;
  return { index: rawStart, length: rawLast - rawStart + 1 };
};

/** Locate a whitespace-normalized needle in raw (possibly multiline) text. */
export const findNeedle = (text: string, needle: string): { index: number; length: number } | undefined => {
  if (!needle) return undefined;
  const direct = text.indexOf(needle);
  if (direct >= 0) return { index: direct, length: needle.length };

  const { folded, map } = foldWhitespace(text);
  const foldedHit = locateInFolded(folded, map, needle);
  if (foldedHit) return foldedHit;

  // Long plain snippets may not appear verbatim; probe distinctive prefixes present in-page.
  if (needle.length < 8) return undefined;
  const maxProbe = Math.min(needle.length, 96);
  for (let size = maxProbe; size >= 8; size = size > 32 ? size - 8 : size - 4) {
    const probe = needle.slice(0, size).trim();
    if (probe.length < 8) continue;
    const index = text.indexOf(probe);
    if (index >= 0) return { index, length: probe.length };
    const foldedProbe = locateInFolded(folded, map, probe);
    if (foldedProbe) return foldedProbe;
  }
  return undefined;
};

export const windowAround = (
  text: string,
  matchIndex: number,
  matchLength: number,
  maxChars: number,
): string => {
  if (maxChars <= 0) return "";

  // Hard upper bound: never return more than maxChars (aside from surrogate-safe trim).
  if (matchLength >= maxChars) {
    return truncatePrefix(safeSlice(text, matchIndex, matchIndex + maxChars + 2), maxChars);
  }

  let start = Math.max(0, matchIndex - Math.floor((maxChars - matchLength) / 2));
  start = Math.min(start, Math.max(0, text.length - maxChars));
  return truncatePrefix(safeSlice(text, start, start + maxChars + 2), maxChars);
};

export const boundText = (
  text: string,
  maxChars: number,
  snippet?: string,
): { text: string; truncated: boolean; truncation?: "prefix" | "match-window" } => {
  if (text.length <= maxChars) return { text, truncated: false };

  // Prefer earlier needles (em terms first), then longer located spans.
  let best: { index: number; length: number; rank: number } | undefined;
  for (const [rank, needle] of snippetNeedles(snippet).entries()) {
    const found = findNeedle(text, needle);
    if (!found) continue;
    if (!best || rank < best.rank || (rank === best.rank && found.length > best.length)) {
      best = { ...found, rank };
      // First em-derived hit that is reasonably distinctive is enough.
      if (rank === 0 && found.length >= 3) break;
    }
  }

  if (best) {
    return {
      text: windowAround(text, best.index, best.length, maxChars),
      truncated: true,
      truncation: "match-window",
    };
  }

  return { text: truncatePrefix(text, maxChars), truncated: true, truncation: "prefix" };
};
