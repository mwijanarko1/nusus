import { afterAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dir, "..");
const cli = path.join(root, "scripts/search.mjs");
const distDir = path.join(root, "dist");
const packageVersion = createRequire(import.meta.url)(path.join(root, "package.json")).version as string;
const fixture = (name: string) => Bun.file(path.join(root, "tests/fixtures", `${name}.json`)).json();

/** Packaged bin imports ../dist; fresh clones have no committed dist. */
const ensureDist = () => {
  const built = spawnSync("bun", ["run", "build"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (built.status !== 0) {
    throw new Error(`bun run build failed:\n${built.stdout}\n${built.stderr}`);
  }
  if (!existsSync(path.join(distDir, "turath/index.js"))) {
    throw new Error("build succeeded but dist/turath/index.js is missing");
  }
};

// CLI integration tests must work on a clean checkout (CI runs bun test before a separate build step).
ensureDist();

const [author, book, page, search] = await Promise.all([
  fixture("author-44"),
  fixture("book-147927"),
  fixture("page-147927-5"),
  fixture("search-book-147927"),
]);

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/author")) {
      const id = url.searchParams.get("id");
      if (id === "44") return Response.json(author);
      return Response.json({});
    }
    if (url.pathname.endsWith("/book")) {
      const id = url.searchParams.get("id");
      if (id === "147927") return Response.json(book);
      return new Response("missing", { status: 404 });
    }
    if (url.pathname.endsWith("/page")) {
      const bookId = url.searchParams.get("book_id");
      const pg = url.searchParams.get("pg");
      if (bookId === "147927" && pg && /^[1-9]\d*$/.test(pg)) {
        const body = structuredClone(page) as { meta: string; text: string };
        const meta = JSON.parse(body.meta) as Record<string, unknown>;
        meta.page_id = Number(pg);
        meta.page = Number(pg);
        body.meta = JSON.stringify(meta);
        return Response.json(body);
      }
      return Response.json({});
    }
    if (url.pathname.endsWith("/search")) {
      return Response.json(search);
    }
    return new Response("not found", { status: 404 });
  },
});

const baseUrl = `http://127.0.0.1:${server.port}`;

afterAll(() => {
  server.stop(true);
});

type RunResult = { code: number; stdout: string; stderr: string; lines: Record<string, unknown>[] };

const run = (
  args: string[],
  env: Record<string, string> = {},
  { jsonl = true }: { jsonl?: boolean } = {},
): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NUSUS_TURATH_BASE_URL: baseUrl,
      ...env,
    };

    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const lines = jsonl
        ? stdout
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>)
        : [];
      resolve({ code: code ?? 1, stdout, stderr, lines });
    });
  });

const stderrError = (stderr: string) => {
  const line = stderr.trim().split("\n").at(-1) ?? "";
  return JSON.parse(line) as { ok: false; error: { code: string; message: string } };
};

describe("nusus CLI", () => {
  test("help exits 0 and lists commands", async () => {
    const result = await run(["--help"], {}, { jsonl: false });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    for (const command of [
      "find-books",
      "find-authors",
      "list-categories",
      "catalog",
      "search",
      "retrieve",
      "get-page",
      "get-context",
      "get-book",
      "get-author",
    ]) {
      expect(result.stdout).toContain(command);
    }
    expect(result.stdout).not.toContain("madhhab");
  });

  test("--version reads package.json", async () => {
    const result = await run(["--version"], {}, { jsonl: false });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(packageVersion);
    expect(result.stderr).toBe("");

    const short = await run(["-v"], {}, { jsonl: false });
    expect(short.code).toBe(0);
    expect(short.stdout.trim()).toBe(packageVersion);
  });

  test("retrieve emits meta + passage with citation/url and effective options", async () => {
    const result = await run([
      "retrieve",
      "الإسلام",
      "--book-id",
      "147927",
      "--max-passages",
      "1",
      "--max-chars",
      "500",
    ]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.lines[0]).toMatchObject({
      type: "meta",
      command: "retrieve",
      query: "الإسلام",
      totalMatches: search.count,
      maxPassages: 1,
      maxChars: 500,
      pagesBefore: 0,
      pagesAfter: 0,
      bookIds: ["147927"],
    });
    const passage = result.lines[1] as {
      type: string;
      citation: string;
      url: string;
      headings: string[];
      text: string;
      book: { id: string };
    };
    expect(passage.type).toBe("passage");
    expect(passage.book.id).toBe("147927");
    expect(passage.citation).toContain("تراث");
    expect(passage.url).toContain("https://app.turath.io/book/147927");
    expect(Array.isArray(passage.headings)).toBe(true);
    expect(passage.text.length).toBeGreaterThan(0);
  });

  test("search accepts single filter and combined filters", async () => {
    const single = await run(["search", "الإسلام", "--book-id", "147927"]);
    expect(single.code).toBe(0);
    expect(single.lines[0]).toMatchObject({
      type: "meta",
      command: "search",
      page: 1,
      sort: "relevance",
      bookIds: ["147927"],
    });
    expect(single.lines.some((line) => line.type === "passage")).toBe(true);

    const combined = await run([
      "search",
      "الإسلام",
      "--book-id",
      "147927",
      "--author-id",
      "44",
      "--category-id",
      "6",
    ]);
    expect(combined.code).toBe(0);
    expect(combined.lines[0]).toMatchObject({
      type: "meta",
      command: "search",
      bookIds: ["147927"],
      authorIds: ["44"],
      categoryIds: ["6"],
    });
  });

  test("rejects duplicate filter values and inapplicable flags with exit 1", async () => {
    const dup = await run(["search", "q", "--book-id", "1", "--book-id", "2"]);
    expect(dup.code).toBe(1);
    expect(dup.stdout).toBe("");
    expect(stderrError(dup.stderr).error.code).toBe("USAGE");

    const bad = await run(["get-book", "147927", "--page-id", "9"]);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toBe("");
    expect(stderrError(bad.stderr).error.message).toMatch(/unknown option --page-id/);

    const retrievePage = await run(["retrieve", "q", "--page", "3"]);
    expect(retrievePage.code).toBe(1);
    expect(stderrError(retrievePage.stderr).error.message).toMatch(/unknown option --page/);

    const short = await run(["search", "q", "-x"], {}, { jsonl: false });
    expect(short.code).toBe(1);
    expect(stderrError(short.stderr).error.message).toMatch(/unknown option -x/);
  });

  test("get-page missing flag exits 1 USAGE", async () => {
    const result = await run(["get-page", "--book-id", "147927"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(stderrError(result.stderr).error.code).toBe("USAGE");
  });

  test("mock 404 maps to exit 2 NOT_FOUND", async () => {
    const result = await run(["get-book", "999999"]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(stderrError(result.stderr).error.code).toBe("NOT_FOUND");
  });

  test("HTTP 500 and rate limit map to exit 3", async () => {
    const errServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith("/book") && url.searchParams.get("id") === "1") {
          return new Response("nope", { status: 500 });
        }
        if (url.pathname.endsWith("/book") && url.searchParams.get("id") === "2") {
          return new Response("slow down", { status: 429, headers: { "retry-after": "7" } });
        }
        return new Response("no", { status: 404 });
      },
    });
    try {
      const http = await run(["get-book", "1"], {
        NUSUS_TURATH_BASE_URL: `http://127.0.0.1:${errServer.port}`,
      });
      expect(http.code).toBe(3);
      expect(stderrError(http.stderr).error.code).toBe("HTTP_ERROR");

      const rate = await run(["get-book", "2"], {
        NUSUS_TURATH_BASE_URL: `http://127.0.0.1:${errServer.port}`,
      });
      expect(rate.code).toBe(3);
      const err = stderrError(rate.stderr);
      expect(err.error.code).toBe("RATE_LIMITED");
      expect((err.error as { retryAfter?: number }).retryAfter).toBe(7);
    } finally {
      errServer.stop(true);
    }
  });

  test("timeout abort maps to exit 3 ABORTED", async () => {
    const slow = Bun.serve({
      port: 0,
      fetch: () => new Promise(() => {}),
    });
    try {
      const result = await run(["get-book", "147927", "--timeout", "20"], {
        NUSUS_TURATH_BASE_URL: `http://127.0.0.1:${slow.port}`,
      });
      expect(result.code).toBe(3);
      expect(stderrError(result.stderr).error.code).toBe("ABORTED");
    } finally {
      slow.stop(true);
    }
  });

  test("timeout bounds: 0 accepted, overflow rejected", async () => {
    const zero = await run(["catalog", "--timeout", "0"]);
    expect(zero.code).toBe(0);
    expect(zero.lines[0]).toMatchObject({ type: "catalog" });

    const max = await run(["catalog", "--timeout", "600000"]);
    expect(max.code).toBe(0);

    const overflow = await run(["catalog", "--timeout", "600001"]);
    expect(overflow.code).toBe(1);
    expect(stderrError(overflow.stderr).error.message).toMatch(/timeout must be <= 600000/);
  });

  test("find-books is offline and supports author filters with meta", async () => {
    const result = await run(["find-books", "المدونة", "--limit", "3"], {
      NUSUS_TURATH_BASE_URL: "http://127.0.0.1:1",
    });
    expect(result.code).toBe(0);
    expect(result.lines[0]).toMatchObject({
      type: "meta",
      command: "find-books",
      query: "المدونة",
      limit: 3,
      returned: expect.any(Number),
    });
    expect(result.lines[1]).toMatchObject({ type: "book", id: "587", title: "المدونة" });

    const byAuthor = await run(["find-books", "--author-id", "44", "--limit", "5"], {
      NUSUS_TURATH_BASE_URL: "http://127.0.0.1:1",
    });
    expect(byAuthor.code).toBe(0);
    expect(byAuthor.lines[0]).toMatchObject({
      type: "meta",
      command: "find-books",
      query: "",
      authorIds: ["44"],
      returned: expect.any(Number),
    });
    expect(byAuthor.lines.slice(1).every((line) => (line.author as { id?: string } | undefined)?.id === "44")).toBe(true);

    const empty = await run(["find-books", "xyzzy-no-such-book"], {
      NUSUS_TURATH_BASE_URL: "http://127.0.0.1:1",
    });
    expect(empty.code).toBe(0);
    expect(empty.lines).toEqual([
      {
        type: "meta",
        command: "find-books",
        query: "xyzzy-no-such-book",
        limit: 20,
        returned: 0,
      },
    ]);

    const missing = await run(["find-books"], { NUSUS_TURATH_BASE_URL: "http://127.0.0.1:1" });
    expect(missing.code).toBe(1);
    expect(stderrError(missing.stderr).error.code).toBe("USAGE");
  });

  test("find-authors emits meta including zero returned", async () => {
    const hit = await run(["find-authors", "النووي", "--limit", "3"]);
    expect(hit.code).toBe(0);
    expect(hit.lines[0]).toMatchObject({ type: "meta", command: "find-authors", query: "النووي", returned: expect.any(Number) });
    expect(hit.lines.some((line) => line.type === "author" && line.id === "44")).toBe(true);

    const miss = await run(["find-authors", "zzz-no-author"]);
    expect(miss.code).toBe(0);
    expect(miss.lines).toEqual([
      { type: "meta", command: "find-authors", query: "zzz-no-author", limit: 20, returned: 0 },
    ]);
  });

  test("rebuilds dist when missing (clean checkout)", async () => {
    const backup = path.join(root, `.dist-cli-test-backup-${process.pid}`);
    rmSync(backup, { recursive: true, force: true });
    if (existsSync(distDir)) renameSync(distDir, backup);
    try {
      expect(existsSync(path.join(distDir, "turath/index.js"))).toBe(false);
      ensureDist();
      const result = await run(["--version"], {}, { jsonl: false });
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe(packageVersion);
      expect(result.stderr).toBe("");
    } finally {
      // Keep the rebuilt dist for later tests; drop the backup snapshot.
      rmSync(backup, { recursive: true, force: true });
    }
  });

  test("get-book includes toc from SDK-normalized indexes", async () => {
    const result = await run(["get-book", "147927"]);
    expect(result.code).toBe(0);
    const record = result.lines[0] as {
      type: string;
      id: string;
      toc?: { title: string; level?: number; page?: number }[];
      volumes?: string[];
    };
    expect(record.type).toBe("book");
    expect(record.id).toBe("147927");
    expect(record.toc?.length).toBeGreaterThan(0);
    expect(record.toc?.[0]).toMatchObject({ title: "تقديم مصطفى العدوي", level: 1, page: 2 });
    expect(record.volumes).toEqual(["1"]);
  });

  test("get-page, get-context, and get-author succeed", async () => {
    const pageResult = await run(["get-page", "--book-id", "147927", "--page-id", "5"]);
    expect(pageResult.code).toBe(0);
    expect(pageResult.lines[0]).toMatchObject({
      type: "passage",
      book: { id: "147927" },
    });

    const contextResult = await run([
      "get-context",
      "--book-id",
      "147927",
      "--page-id",
      "5",
      "--pages-before",
      "1",
      "--pages-after",
      "1",
    ]);
    expect(contextResult.code).toBe(0);
    expect(contextResult.lines[0]).toMatchObject({ type: "passage", book: { id: "147927" } });
    expect(String((contextResult.lines[0] as { text: string }).text).length).toBeGreaterThan(
      String((pageResult.lines[0] as { text: string }).text).length,
    );

    const authorResult = await run(["get-author", "44"]);
    expect(authorResult.code).toBe(0);
    expect(authorResult.lines[0]).toMatchObject({ type: "author", id: "44", name: "النووي" });
  });

  test("empty search still exits 0 with meta totalMatches", async () => {
    const emptyServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith("/search")) return Response.json({ count: 0, data: [] });
        return new Response("no", { status: 404 });
      },
    });
    try {
      const result = await run(["search", "لانتائج"], {
        NUSUS_TURATH_BASE_URL: `http://127.0.0.1:${emptyServer.port}`,
      });
      expect(result.code).toBe(0);
      expect(result.lines).toEqual([
        {
          type: "meta",
          command: "search",
          query: "لانتائج",
          totalMatches: 0,
          page: 1,
          sort: "relevance",
        },
      ]);
    } finally {
      emptyServer.stop(true);
    }
  });

  test("--format text writes human lines; errors still JSON on stderr", async () => {
    const ok = await run(["catalog", "--format", "text"], {}, { jsonl: false });
    expect(ok.code).toBe(0);
    expect(ok.stdout.startsWith("catalog\t")).toBe(true);

    const bad = await run(["get-page", "--format", "text"], {}, { jsonl: false });
    expect(bad.code).toBe(1);
    expect(bad.stdout).toBe("");
    expect(stderrError(bad.stderr).error.code).toBe("USAGE");
  });

  test("EPIPE from closed stdout exits 0 without stack", async () => {
    const result = await new Promise<RunResult>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["-e", `const {spawn}=require('child_process'); const c=spawn(process.execPath,[${JSON.stringify(cli)},'list-categories'],{env:{...process.env,NUSUS_TURATH_BASE_URL:${JSON.stringify(baseUrl)}}}); c.stdout.on('data',()=>c.stdout.destroy()); let err=''; c.stderr.on('data',d=>err+=d); c.on('close',code=>process.stdout.write(JSON.stringify({code,err})));`],
        { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({ code: code ?? 1, stdout, stderr, lines: [] });
      });
    });
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { code: number | null; err: string };
    expect(payload.code).toBe(0);
    expect(payload.err).not.toMatch(/EPIPE|Unhandled|stack/i);
  });
});
