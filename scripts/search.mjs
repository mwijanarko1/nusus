#!/usr/bin/env node
// Agent-facing Turath CLI — thin subcommand surface over the nusus SDK.
// Default stdout: JSONL. Diagnostics: stderr JSON. No ranking heuristics.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTurathClient } from "../dist/turath/index.js";
import { NususError } from "../dist/errors.js";

const DEFAULT_TIMEOUT = 15_000;
const MAX_TIMEOUT = 600_000;
const MAX_FILTER_IDS = 50;
const MAX_PAGE_SPAN = 20;
const VERSION = createRequire(import.meta.url)(join(dirname(fileURLToPath(import.meta.url)), "../package.json")).version;

const EXIT = {
  USAGE: 1,
  INVALID_ARGUMENT: 1,
  NOT_FOUND: 2,
  RATE_LIMITED: 3,
  HTTP_ERROR: 3,
  INVALID_RESPONSE: 3,
  ABORTED: 3,
  INTERNAL_ERROR: 3,
};

// --- I/O ---

process.stdout.on("error", (error) => {
  if (error?.code === "EPIPE") process.exit(0);
  throw error;
});

const writeJsonl = (record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
};

const fail = (code, error) => {
  const payload = {
    ok: false,
    error: {
      code,
      message: error?.message ?? String(error),
      ...(error?.status !== undefined && { status: error.status }),
      ...(error?.url !== undefined && { url: error.url }),
      ...(error?.retryAfter !== undefined && { retryAfter: error.retryAfter }),
    },
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exit(EXIT[code] ?? 3);
};

const usage = (message) => fail("USAGE", { message });

// --- text format ---

const preview = (text, n = 160) => {
  const one = String(text ?? "").replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, n)}…`;
};

const writeText = (record) => {
  switch (record.type) {
    case "meta": {
      const parts = [`meta\t${record.command}`];
      if (record.query !== undefined) parts.push(`q=${record.query}`);
      if (record.returned !== undefined) parts.push(`returned=${record.returned}`);
      if (record.totalMatches !== undefined) parts.push(`totalMatches=${record.totalMatches}`);
      if (record.page !== undefined) parts.push(`page=${record.page}`);
      process.stdout.write(`${parts.join("\t")}\n`);
      break;
    }
    case "book":
      process.stdout.write(
        `book\t${record.id}\t${record.title}` +
          (record.author?.name ? `\t${record.author.name}` : record.author?.id ? `\tauthor=${record.author.id}` : "") +
          (record.toc ? `\ttoc=${record.toc.length}` : "") +
          "\n",
      );
      break;
    case "author":
      process.stdout.write(`author\t${record.id}\t${record.name}\n`);
      break;
    case "category":
      process.stdout.write(`category\t${record.id}\t${record.title}\tbooks=${record.bookCount}\n`);
      break;
    case "catalog":
      process.stdout.write(
        `catalog\tbooks=${record.bookCount}\tcategories=${record.categoryCount}\tauthors=${record.authorIdCount}\n`,
      );
      break;
    case "passage":
      process.stdout.write(
        `passage\t${record.book?.id ?? "?"}\t${record.citation ?? ""}\t${record.url ?? ""}\t${preview(record.text)}\n`,
      );
      break;
    case "toc-entry":
      process.stdout.write(
        `toc-entry\t${record.bookId ?? "?"}\t${record.page ?? ""}\t${record.level ?? ""}\t${record.title}\n`,
      );
      break;
    default:
      process.stdout.write(`${record.type}\t${JSON.stringify(record)}\n`);
  }
};

const emit = (format, record) => {
  if (format === "text") writeText(record);
  else writeJsonl(record);
};

// --- records ---

const toPassageRecord = (passage) => {
  const record = {
    type: "passage",
    provider: passage.provider ?? "turath",
    book: passage.book,
    location: passage.location,
    text: passage.text,
    headings: passage.headings ?? [],
    url: passage.url,
    citation: passage.citation,
  };
  if (passage.author) record.author = passage.author;
  if (passage.category) record.category = passage.category;
  if (passage.snippet !== undefined) record.snippet = passage.snippet;
  if (passage.locator) record.locator = passage.locator;
  if (passage.provenance) record.provenance = passage.provenance;
  if (passage.segments) record.segments = passage.segments;
  return record;
};

const toBookRecord = (book) => {
  const record = {
    type: "book",
    id: book.id,
    title: book.title,
    provider: book.provider ?? "turath",
  };
  if (book.author) record.author = book.author;
  if (book.category) record.category = book.category;
  if (book.description !== undefined) record.description = book.description;
  if (book.hasPdf !== undefined) record.hasPdf = book.hasPdf;
  if (book.toc) record.toc = book.toc;
  if (book.volumes) record.volumes = book.volumes;
  return record;
};

const toAuthorRecord = (author) => {
  const record = {
    type: "author",
    id: author.id,
    name: author.name,
    provider: author.provider ?? "turath",
  };
  if (author.biography !== undefined) record.biography = author.biography;
  if (author.deathYear !== undefined) record.deathYear = author.deathYear;
  return record;
};

const toCategoryRecord = (category) => ({
  type: "category",
  id: category.id,
  title: category.title,
  provider: category.provider ?? "turath",
  bookCount: category.bookCount,
});

const toCatalogRecord = (meta) => ({ type: "catalog", ...meta });

// --- parse helpers ---

const parseIntFlag = (raw, name, { def, min, max } = {}) => {
  if (raw === undefined) return def;
  if (raw === true) usage(`--${name} requires a value`);
  if (!/^\d+$/.test(String(raw))) usage(`--${name} must be an integer`);
  const n = Number(raw);
  if (min !== undefined && n < min) usage(`--${name} must be >= ${min}`);
  if (max !== undefined && n > max) usage(`--${name} must be <= ${max}`);
  return n;
};

const parsePositiveId = (raw, label) => {
  const value = String(raw);
  if (!/^[1-9]\d*$/.test(value)) usage(`${label} must be a positive integer`);
  return value;
};

const requireFlag = (flags, name) => {
  const value = flags[name];
  if (value === undefined || value === true) usage(`--${name} is required`);
  return value;
};

const optionalFlag = (flags, name) => {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (value === true) usage(`--${name} requires a value`);
  return value;
};

const parseIdList = (values, label, { max = 1 } = {}) => {
  const list = values ?? [];
  if (list.length > max) {
    usage(max === 1 ? `at most one --${label}` : `at most ${max} --${label} values`);
  }
  return list.map((value) => parsePositiveId(value, label));
};

const takeQuery = (positionals, { required = true } = {}) => {
  if (positionals.length > 1) usage("accepts a single <query> argument");
  if (!positionals.length) {
    if (required) usage("requires a <query>");
    return "";
  }
  const query = positionals[0];
  if (!String(query).trim()) {
    if (required) usage("query must not be empty");
    return "";
  }
  return query;
};

const takeIdArg = (positionals, label) => {
  if (positionals.length === 0) usage(`${label} requires an id argument`);
  if (positionals.length > 1) usage(`${label} accepts a single id argument`);
  return parsePositiveId(positionals[0], `${label} id`);
};

const rejectExtras = (positionals, flags, multi) => {
  if (positionals.length) usage("this command accepts no positional arguments");
  if (Object.keys(flags).length) usage(`unknown option --${Object.keys(flags)[0]}`);
  if (Object.keys(multi).length) usage(`unknown option --${Object.keys(multi)[0]}`);
};

const parseArgs = (argv) => {
  const positionals = [];
  const flags = Object.create(null);
  const multi = Object.create(null);
  const multiKeys = new Set(["author-id", "category-id"]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h" || arg === "--help") {
      flags.help = true;
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      flags.version = true;
      continue;
    }
    if (arg.startsWith("-") && !arg.startsWith("--")) {
      usage(`unknown option ${arg}`);
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    let key;
    let value;
    if (eq !== -1) {
      key = arg.slice(2, eq);
      value = arg.slice(eq + 1);
    } else {
      key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        value = next;
        i += 1;
      } else {
        value = true;
      }
    }
    if (!key) usage("invalid option");
    if (multiKeys.has(key)) {
      if (value === true) usage(`--${key} requires a value`);
      (multi[key] ??= []).push(value);
      continue;
    }
    if (flags[key] !== undefined) usage(`duplicate flag --${key}`);
    flags[key] = value;
  }

  return { positionals, flags, multi };
};

const takeAllowed = (flags, multi, allowed) => {
  const allowedSet = new Set(allowed);
  const outFlags = Object.create(null);
  const outMulti = Object.create(null);
  for (const [key, value] of Object.entries(flags)) {
    if (!allowedSet.has(key)) usage(`unknown option --${key}`);
    outFlags[key] = value;
  }
  for (const [key, value] of Object.entries(multi)) {
    if (!allowedSet.has(key)) usage(`unknown option --${key}`);
    outMulti[key] = value;
  }
  return { flags: outFlags, multi: outMulti };
};

const parseLiveScope = (flags, multi) => {
  const bookId = optionalFlag(flags, "book-id");
  const authorIds = parseIdList(multi["author-id"], "author-id", { max: 1 });
  const categoryIds = parseIdList(multi["category-id"], "category-id", { max: 1 });
  const scope = {};
  if (bookId !== undefined) scope.bookIds = [parsePositiveId(bookId, "book-id")];
  if (authorIds.length) scope.authorIds = authorIds;
  if (categoryIds.length) scope.categoryIds = categoryIds;
  return scope;
};

// --- command table ---

const GLOBAL_FLAGS = ["format", "timeout"];

const COMMANDS = {
  "find-books": {
    help: `nusus find-books [query] [--limit N] [--author-id <id>]... [--category-id <id>]...
  Offline catalog book search.
  Query optional only when --author-id and/or --category-id is set.
  --limit          default 20, max 100
  --author-id      repeatable offline author filter (max ${MAX_FILTER_IDS})
  --category-id    repeatable offline category filter (max ${MAX_FILTER_IDS})`,
    flags: [...GLOBAL_FLAGS, "limit", "author-id", "category-id"],
    run: async ({ turath, format, positionals, flags, multi }) => {
      const query = takeQuery(positionals, { required: false });
      const limit = parseIntFlag(flags.limit, "limit", { def: 20, min: 1, max: 100 });
      const authorIds = parseIdList(multi["author-id"], "author-id", { max: MAX_FILTER_IDS });
      const categoryIds = parseIdList(multi["category-id"], "category-id", { max: MAX_FILTER_IDS });
      if (!query.trim() && !authorIds.length && !categoryIds.length) {
        usage("find-books requires a <query> or --author-id/--category-id");
      }
      const books = turath.findBooks(query, {
        limit,
        ...(authorIds.length && { authorIds }),
        ...(categoryIds.length && { categoryIds }),
      });
      emit(format, {
        type: "meta",
        command: "find-books",
        query,
        ...(authorIds.length && { authorIds }),
        ...(categoryIds.length && { categoryIds }),
        limit,
        returned: books.length,
      });
      for (const book of books) emit(format, toBookRecord(book));
    },
  },
  "find-authors": {
    help: `nusus find-authors <query> [--limit N]
  Offline catalog author search.
  --limit          default 20, max 100`,
    flags: [...GLOBAL_FLAGS, "limit"],
    run: async ({ turath, format, positionals, flags }) => {
      const query = takeQuery(positionals);
      const limit = parseIntFlag(flags.limit, "limit", { def: 20, min: 1, max: 100 });
      const authors = turath.findAuthors(query, { limit });
      emit(format, {
        type: "meta",
        command: "find-authors",
        query,
        limit,
        returned: authors.length,
      });
      for (const author of authors) emit(format, toAuthorRecord(author));
    },
  },
  "list-categories": {
    help: `nusus list-categories
  Offline category list.`,
    flags: [...GLOBAL_FLAGS],
    run: async ({ turath, format, positionals, flags, multi }) => {
      rejectExtras(positionals, flags, multi);
      for (const category of turath.listCategories()) emit(format, toCategoryRecord(category));
    },
  },
  catalog: {
    help: `nusus catalog
  Offline catalog metadata.`,
    flags: [...GLOBAL_FLAGS],
    run: async ({ turath, format, positionals, flags, multi }) => {
      rejectExtras(positionals, flags, multi);
      emit(format, toCatalogRecord(turath.getCatalogMetadata()));
    },
  },
  search: {
    help: `nusus search <query> [--book-id ID] [--author-id ID] [--category-id ID]
                 [--page N] [--sort relevance|page]
  Live Turath search (JSONL meta + passages).
  --page           default 1
  --sort           relevance (default) | page
  At most one ID per filter; filters may be combined.`,
    flags: [...GLOBAL_FLAGS, "book-id", "author-id", "category-id", "page", "sort"],
    run: async ({ turath, format, positionals, flags, multi }) => {
      const query = takeQuery(positionals);
      const scope = parseLiveScope(flags, multi);
      const page = parseIntFlag(flags.page, "page", { def: 1, min: 1 });
      const sortRaw = optionalFlag(flags, "sort") ?? "relevance";
      if (sortRaw !== "relevance" && sortRaw !== "page") usage("--sort must be relevance or page");
      const result = await turath.search(query, {
        ...scope,
        page,
        ...(sortRaw === "page" && { sort: "page" }),
      });
      emit(format, {
        type: "meta",
        command: "search",
        query,
        totalMatches: result.totalMatches,
        page: result.page,
        ...(result.effectiveQuery && { effectiveQuery: result.effectiveQuery }),
        sort: sortRaw,
        ...(scope.bookIds && { bookIds: scope.bookIds }),
        ...(scope.authorIds && { authorIds: scope.authorIds }),
        ...(scope.categoryIds && { categoryIds: scope.categoryIds }),
      });
      for (const item of result.items) emit(format, toPassageRecord(item));
    },
  },
  retrieve: {
    help: `nusus retrieve <query> [--book-id ID] [--author-id ID] [--category-id ID]
                   [--max-passages N] [--max-chars N]
                   [--pages-before N] [--pages-after N]
  Live retrieve with citations/locators.
  --max-passages   default 5, max 20
  --max-chars      default 2000, max 20000
  --pages-before   default 0, max 2
  --pages-after    default 0, max 2
  At most one ID per filter; filters may be combined.`,
    flags: [
      ...GLOBAL_FLAGS,
      "book-id",
      "author-id",
      "category-id",
      "max-passages",
      "max-chars",
      "pages-before",
      "pages-after",
    ],
    run: async ({ turath, format, positionals, flags, multi }) => {
      const query = takeQuery(positionals);
      const scope = parseLiveScope(flags, multi);
      const maxPassages = parseIntFlag(flags["max-passages"], "max-passages", { def: 5, min: 1, max: 20 });
      const maxChars = parseIntFlag(flags["max-chars"], "max-chars", { def: 2000, min: 1, max: 20_000 });
      const pagesBefore = parseIntFlag(flags["pages-before"], "pages-before", { def: 0, min: 0, max: 2 });
      const pagesAfter = parseIntFlag(flags["pages-after"], "pages-after", { def: 0, min: 0, max: 2 });
      const result = await turath.retrieve(query, {
        maxPassages,
        maxCharsPerPassage: maxChars,
        pagesBefore,
        pagesAfter,
        ...(Object.keys(scope).length && { scope }),
      });
      emit(format, {
        type: "meta",
        command: "retrieve",
        query,
        totalMatches: result.totalMatches,
        ...(result.effectiveQuery && { effectiveQuery: result.effectiveQuery }),
        maxPassages,
        maxChars,
        pagesBefore,
        pagesAfter,
        ...(scope.bookIds && { bookIds: scope.bookIds }),
        ...(scope.authorIds && { authorIds: scope.authorIds }),
        ...(scope.categoryIds && { categoryIds: scope.categoryIds }),
      });
      for (const passage of result.passages) emit(format, toPassageRecord(passage));
    },
  },
  "get-page": {
    help: `nusus get-page --book-id <id> --page-id <id>
  Fetch one internal page.
  page-id is Turath internal page, not printed page.`,
    flags: [...GLOBAL_FLAGS, "book-id", "page-id"],
    run: async ({ turath, format, positionals, flags }) => {
      if (positionals.length) usage("get-page takes --book-id and --page-id flags only");
      const bookId = parsePositiveId(requireFlag(flags, "book-id"), "book-id");
      const pageId = parsePositiveId(requireFlag(flags, "page-id"), "page-id");
      const page = await turath.getPage(bookId, pageId);
      emit(format, toPassageRecord(page));
    },
  },
  "get-context": {
    help: `nusus get-context --book-id <id> --page-id <id>
                  [--pages-before N] [--pages-after N]
  Fetch page plus surrounding pages.
  --pages-before   default 1, max 3
  --pages-after    default 1, max 3
  page-id is Turath internal page, not printed page.`,
    flags: [...GLOBAL_FLAGS, "book-id", "page-id", "pages-before", "pages-after"],
    run: async ({ turath, format, positionals, flags }) => {
      if (positionals.length) usage("get-context takes --book-id and --page-id flags only");
      const bookId = parsePositiveId(requireFlag(flags, "book-id"), "book-id");
      const pageId = parsePositiveId(requireFlag(flags, "page-id"), "page-id");
      const pagesBefore = parseIntFlag(flags["pages-before"], "pages-before", { def: 1, min: 0, max: 3 });
      const pagesAfter = parseIntFlag(flags["pages-after"], "pages-after", { def: 1, min: 0, max: 3 });
      const ctx = await turath.getContextByPage(bookId, pageId, { pagesBefore, pagesAfter });
      emit(format, toPassageRecord(ctx));
    },
  },
  "get-book": {
    help: `nusus get-book <book-id>
  Book metadata + TOC (normalized from indexes).`,
    flags: [...GLOBAL_FLAGS],
    run: async ({ turath, format, positionals }) => {
      const bookId = takeIdArg(positionals, "get-book");
      const book = await turath.getBook(bookId);
      emit(format, toBookRecord(book));
    },
  },
  "get-author": {
    help: `nusus get-author <author-id>
  Author metadata.`,
    flags: [...GLOBAL_FLAGS],
    run: async ({ turath, format, positionals }) => {
      const authorId = takeIdArg(positionals, "get-author");
      const author = await turath.getAuthor(authorId);
      emit(format, toAuthorRecord(author));
    },
  },
  "get-pages": {
    help: `nusus get-pages --book-id <id> --from <n> --to <m>
  Fetch a contiguous internal page range (max span ${MAX_PAGE_SPAN}).
  Emits meta then one passage per page.
  page numbers are Turath internal pages, not printed pages.`,
    flags: [...GLOBAL_FLAGS, "book-id", "from", "to"],
    run: async ({ turath, format, positionals, flags }) => {
      if (positionals.length) usage("get-pages takes --book-id, --from, and --to flags only");
      const bookId = parsePositiveId(requireFlag(flags, "book-id"), "book-id");
      const from = parseIntFlag(flags.from, "from", { min: 1 });
      const to = parseIntFlag(flags.to, "to", { min: from });
      if (to - from + 1 > MAX_PAGE_SPAN) {
        usage(`page span must be at most ${MAX_PAGE_SPAN} (got ${to - from + 1})`);
      }
      const pages = await turath.getPages(bookId, { from, to });
      emit(format, {
        type: "meta",
        command: "get-pages",
        bookId,
        from,
        to,
        returned: pages.length,
      });
      for (const page of pages) emit(format, toPassageRecord(page));
    },
  },
  "find-toc": {
    help: `nusus find-toc <query> --book-id <id> [--limit N]
  Filter a book's TOC headings by substring match on title (no stemming).
  --limit          default 20, max 100`,
    flags: [...GLOBAL_FLAGS, "book-id", "limit"],
    run: async ({ turath, format, positionals, flags }) => {
      const query = takeQuery(positionals);
      const bookId = parsePositiveId(requireFlag(flags, "book-id"), "book-id");
      const limit = parseIntFlag(flags.limit, "limit", { def: 20, min: 1, max: 100 });
      const book = await turath.getBook(bookId);
      const toc = book.toc ?? [];
      const needle = String(query);
      const matches = [];
      for (const entry of toc) {
        if (!entry.title.includes(needle)) continue;
        matches.push(entry);
        if (matches.length >= limit) break;
      }
      emit(format, {
        type: "meta",
        command: "find-toc",
        query,
        bookId,
        limit,
        returned: matches.length,
      });
      for (const entry of matches) {
        emit(format, {
          type: "toc-entry",
          bookId,
          title: entry.title,
          ...(entry.level !== undefined && { level: entry.level }),
          ...(entry.page !== undefined && { page: entry.page }),
        });
      }
    },
  },
};

const GLOBAL_HELP = `nusus <command> [args] [options]

Commands:
  find-books [query]       Offline catalog book search (query optional with filters)
  find-authors <query>     Offline catalog author search
  list-categories          Offline category list
  catalog                  Offline catalog metadata
  search <query>           Live Turath search (JSONL meta + passages)
  retrieve <query>         Live retrieve with citations/locators
  get-page                 Fetch one internal page
  get-pages                Fetch a contiguous internal page range
  get-context              Fetch page plus surrounding pages
  get-book <book-id>       Book metadata + TOC
  find-toc <query>         Filter book TOC by title substring
  get-author <author-id>   Author metadata

Global options:
  --format jsonl|text      Output format (default: jsonl)
  --timeout <ms>           Request timeout (default: ${DEFAULT_TIMEOUT}, 0 = no timeout, max ${MAX_TIMEOUT})
  -h, --help               Show help
  -v, --version            Print package version

Notes:
  • page-id is Turath internal page (location.internalPage), not printed page.
  • search/retrieve accept at most one --book-id, one --author-id, and one --category-id
    (filters may be combined; multiple values of the same filter are rejected).
  • find-books allows repeated --author-id/--category-id (offline catalog only).
  • Errors are JSON on stderr; data only on stdout.
  • Exit: 0 ok (incl. zero hits), 1 usage/invalid, 2 not found, 3 http/rate/abort/invalid-response/internal.

nusus help | nusus --help | nusus <command> --help
`;

const printHelp = (command) => {
  if (command && COMMANDS[command]) {
    process.stdout.write(`${COMMANDS[command].help}\n\nGlobal: --format jsonl|text  --timeout <ms>  --version\n`);
  } else {
    process.stdout.write(GLOBAL_HELP);
  }
};

const createClient = (timeout) => {
  const options = { timeout };
  // Test-only override used by CLI subprocess tests. Not a supported public config surface.
  const baseUrl = process.env.NUSUS_TURATH_BASE_URL;
  if (baseUrl) options.baseUrl = baseUrl;
  return createTurathClient(options);
};

const run = async () => {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printHelp();
    process.exit(0);
  }

  const { positionals, flags, multi } = parseArgs(argv);

  if (flags.version) {
    const extraFlags = Object.keys(flags).filter((k) => k !== "version" && k !== "help");
    if (positionals.length || Object.keys(multi).length || extraFlags.length) {
      usage("--version does not accept other arguments");
    }
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }

  let command = positionals[0];
  let rest = positionals.slice(1);

  if (flags.help && !command) {
    printHelp();
    process.exit(0);
  }
  if (command === "help") {
    printHelp(rest[0]);
    process.exit(0);
  }
  if (!command || !COMMANDS[command]) {
    if (flags.help) {
      printHelp();
      process.exit(0);
    }
    usage(command ? `unknown command: ${command}` : "missing command");
  }
  if (flags.help) {
    printHelp(command);
    process.exit(0);
  }

  const spec = COMMANDS[command];
  const { flags: cmdFlags, multi: cmdMulti } = takeAllowed(flags, multi, spec.flags);

  const formatRaw = optionalFlag(cmdFlags, "format") ?? "jsonl";
  if (formatRaw !== "jsonl" && formatRaw !== "text") usage("--format must be jsonl or text");
  delete cmdFlags.format;

  const timeout = parseIntFlag(cmdFlags.timeout, "timeout", {
    def: DEFAULT_TIMEOUT,
    min: 0,
    max: MAX_TIMEOUT,
  });
  delete cmdFlags.timeout;

  const turath = createClient(timeout);

  try {
    await spec.run({
      turath,
      format: formatRaw,
      positionals: rest,
      flags: cmdFlags,
      multi: cmdMulti,
    });
  } catch (error) {
    if (error instanceof NususError) fail(error.code, error);
    fail("INTERNAL_ERROR", { message: error?.message ?? String(error) });
  }
};

await run();
