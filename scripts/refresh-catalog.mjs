#!/usr/bin/env bun
/**
 * Official-API-only catalog maintenance.
 *
 *   bun scripts/refresh-catalog.mjs books
 *     Fail closed: Turath has no verified bulk book/category listing endpoint.
 *
 *   bun scripts/refresh-catalog.mjs authors [--limit N] [--delay-ms 150] [--resume path]
 *     Hydrate author names via GET /author?id=&ver=3 with resume + rate-limit backoff.
 *     Writes progress JSON and regenerates src/turath/catalog-authors.ts from verified rows.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const authorsOut = resolve(root, "src/turath/catalog-authors.ts");
const catalogDataPath = resolve(root, "src/turath/catalog-data.ts");
const defaultResume = resolve(root, ".cache/catalog-authors-progress.json");
const baseUrl = "https://api.turath.io/";

export const usage = () => {
  console.error(`Usage:
  bun scripts/refresh-catalog.mjs books
  bun scripts/refresh-catalog.mjs authors [--limit N] [--delay-ms 150] [--resume path]`);
  process.exit(2);
};

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

export const parseArgs = (argv) => {
  const out = { limit: Infinity, delayMs: 150, resume: defaultResume };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--limit") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) usage();
      out.limit = Number(value);
    } else if (arg === "--delay-ms") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) usage();
      out.delayMs = Number(value);
    } else if (arg === "--resume") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) usage();
      out.resume = resolve(value);
    } else usage();
  }
  if (!Number.isFinite(out.delayMs) || out.delayMs < 0) {
    throw new Error("--delay-ms must be a non-negative number");
  }
  if (out.limit !== Infinity && (!Number.isInteger(out.limit) || out.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  return out;
};

export const loadCatalogAuthorIds = async () => {
  const { CATALOG_BOOKS } = await import(pathToFileURL(catalogDataPath).href);
  return [...new Set(CATALOG_BOOKS.map(([, , authorId]) => Number(authorId)))].sort((a, b) => a - b);
};

export const loadExistingAuthors = async () => {
  try {
    const { CATALOG_AUTHORS } = await import(`${pathToFileURL(authorsOut).href}?t=${Date.now()}`);
    const names = {};
    for (const [id, name] of CATALOG_AUTHORS) {
      if (Number.isInteger(id) && id > 0 && typeof name === "string" && name.trim()) {
        names[String(id)] = name;
      }
    }
    return names;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    // Missing module during first hydrate is fine; other import failures should surface.
    try {
      await readFile(authorsOut);
    } catch (readError) {
      if (readError && typeof readError === "object" && "code" in readError && readError.code === "ENOENT") return {};
    }
    throw error;
  }
};

export const loadProgress = async (path) => {
  const existing = await loadExistingAuthors();
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    if (!raw || typeof raw !== "object") throw new Error("invalid progress file");
    const names = { ...existing, ...(raw.names && typeof raw.names === "object" ? raw.names : {}) };
    const completed = new Set([
      ...Object.keys(names).map(Number),
      ...(Array.isArray(raw.completed) ? raw.completed.map(Number) : []),
    ]);
    return {
      completed: [...completed],
      names,
      missing: Array.isArray(raw.missing) ? raw.missing.map(Number) : [],
      errors: raw.errors && typeof raw.errors === "object" ? { ...raw.errors } : {},
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        completed: Object.keys(existing).map(Number),
        names: existing,
        missing: [],
        errors: {},
      };
    }
    throw error;
  }
};

const saveProgress = async (path, progress) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(progress, null, 2)}\n`);
};

/** Keep only catalog-intersected verified names; coverage uses resolved ∩ catalog IDs. */
export const buildAuthorsModule = (names, catalogIds, { missing = 0 } = {}) => {
  const catalogSet = new Set(catalogIds.map(Number));
  const rows = Object.entries(names)
    .map(([id, name]) => [Number(id), String(name)])
    .filter(([id, name]) => catalogSet.has(id) && Number.isInteger(id) && id > 0 && name.trim())
    .sort((a, b) => a[0] - b[0]);
  const resolved = rows.length;
  const requested = catalogIds.length;
  const body = rows.map(([id, name]) => `  [${id}, ${JSON.stringify(name)}],`).join("\n");
  const coverage =
    requested > 0 && resolved + missing >= requested
      ? `// Coverage: ${resolved} verified names for ${requested} known catalog author IDs` +
        (missing ? ` (${missing} official empty/NOT_FOUND, not fabricated).` : ".")
      : `// Partial map — resume with: bun scripts/refresh-catalog.mjs authors`;
  const source = `// Verified author names from official GET /author only.
${coverage}
// Tuple: [author id, Arabic name].

export const CATALOG_AUTHORS: readonly [number, string][] = [
${body}
];
`;
  return { source, resolved, rows };
};

export const clearResolvedError = (errors, authorId, resultId) => {
  const next = { ...errors };
  delete next[String(authorId)];
  if (resultId !== undefined) delete next[String(resultId)];
  return next;
};

const writeAuthorsModule = async (names, catalogIds, options = {}) => {
  const { source, resolved } = buildAuthorsModule(names, catalogIds, options);
  await writeFile(authorsOut, source);
  return resolved;
};

const fetchAuthor = async (authorId, attempt = 0) => {
  const url = new URL("author", baseUrl);
  url.searchParams.set("id", String(authorId));
  url.searchParams.set("ver", "3");
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (response.status === 429 && attempt < 6) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * 2 ** attempt;
    await sleep(waitMs);
    return fetchAuthor(authorId, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length === 0) {
    return { missing: true };
  }
  if (typeof body.id !== "number" || typeof body.name !== "string" || !body.name.trim()) {
    throw new Error("invalid author payload");
  }
  return { id: body.id, name: body.name };
};

const refreshBooks = () => {
  console.error(`Catalog book refresh is fail-closed.
Turath exposes no verified bulk listing endpoint for books/categories
(/books, /categories, and files.turath.io dumps are unavailable).
Keep src/turath/catalog-data.ts as a curated official snapshot; do not scrape app.turath.io.`);
  process.exit(1);
};

const refreshAuthors = async (argv) => {
  const opts = parseArgs(argv);
  const allIds = await loadCatalogAuthorIds();
  const progress = await loadProgress(opts.resume);
  const done = new Set([...progress.completed, ...progress.missing, ...Object.keys(progress.names).map(Number)]);
  const pending = allIds.filter((id) => !done.has(id)).slice(0, opts.limit === Infinity ? undefined : opts.limit);

  console.error(`Author IDs in catalog: ${allIds.length}`);
  console.error(`Already recorded: ${done.size}; fetching now: ${pending.length}`);

  for (const authorId of pending) {
    try {
      const result = await fetchAuthor(authorId);
      if (result.missing) {
        progress.missing.push(authorId);
        progress.errors = clearResolvedError(progress.errors, authorId);
        console.error(`missing ${authorId}`);
      } else {
        progress.names[String(result.id)] = result.name;
        progress.completed.push(result.id);
        progress.errors = clearResolvedError(progress.errors, authorId, result.id);
        console.error(`ok ${result.id} ${result.name}`);
      }
    } catch (error) {
      progress.errors[String(authorId)] = error instanceof Error ? error.message : String(error);
      console.error(`error ${authorId}: ${progress.errors[String(authorId)]}`);
    }
    await saveProgress(opts.resume, progress);
    if (opts.delayMs) await sleep(opts.delayMs);
  }

  const namedIds = new Set(Object.keys(progress.names).map(Number));
  const resolved = allIds.filter((id) => namedIds.has(id)).length;
  const unresolvedIds = allIds.filter((id) => !namedIds.has(id));
  const missing = [...new Set(progress.missing)].filter((id) => !namedIds.has(id)).sort((a, b) => a - b);
  // Only count errors still unresolved against the catalog.
  const errorIds = Object.keys(progress.errors)
    .map(Number)
    .filter((id) => allIds.includes(id) && !namedIds.has(id) && !missing.includes(id))
    .sort((a, b) => a - b);
  const count = await writeAuthorsModule(progress.names, allIds, {
    missing: missing.length,
  });
  const report = {
    requestedAuthorIds: allIds.length,
    resolvedAuthorNames: resolved,
    unresolvedAuthorIds: unresolvedIds.length,
    officialMissingOrEmpty: missing.length,
    fetchErrors: errorIds.length,
    missingIds: missing,
    errorIds,
    authorsModuleRows: count,
    progressFile: opts.resume,
  };
  console.error(`Wrote ${count} verified authors to ${authorsOut}`);
  console.error(`Progress file: ${opts.resume}`);
  console.error(`Coverage report: ${JSON.stringify(report, null, 2)}`);
  if (unresolvedIds.length) {
    console.error(
      `Residual gap: ${unresolvedIds.length} catalog author IDs lack verified names (official empty/missing or still pending/errors).`,
    );
  }
};

if (import.meta.main) {
  const command = process.argv[2];
  if (command === "books") refreshBooks();
  else if (command === "authors") await refreshAuthors(process.argv.slice(3));
  else usage();
}
