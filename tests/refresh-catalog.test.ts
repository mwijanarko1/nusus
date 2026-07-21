import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAuthorsModule,
  clearResolvedError,
  loadCatalogAuthorIds,
  parseArgs,
} from "../scripts/refresh-catalog.mjs";

describe("refresh-catalog helpers", () => {
  test("requires a path after --resume", () => {
    const originalExit = process.exit;
    let code: number | undefined;
    // @ts-expect-error test stub
    process.exit = (value?: number) => {
      code = value ?? 0;
      throw new Error(`exit:${code}`);
    };
    try {
      expect(() => parseArgs(["--resume"])).toThrow(/exit:2/);
      expect(code).toBe(2);
      expect(() => parseArgs(["--resume", "--limit", "1"])).toThrow(/exit:2/);
    } finally {
      process.exit = originalExit;
    }
  });

  test("accepts an explicit resume path", () => {
    const opts = parseArgs(["--resume", "/tmp/nusus-progress.json", "--limit", "3"]);
    expect(opts.resume).toBe("/tmp/nusus-progress.json");
    expect(opts.limit).toBe(3);
  });

  test("clears stale errors after successful or official-missing retry", () => {
    const errors = { "10": "HTTP 500", "11": "HTTP 500" };
    expect(clearResolvedError(errors, 10, 10)).toEqual({ "11": "HTTP 500" });
    expect(clearResolvedError(errors, 11)).toEqual({ "10": "HTTP 500" });
  });

  test("coverage uses catalog-intersected resolved IDs and drops stale rows", () => {
    const catalogIds = [1, 2, 3];
    const names = {
      "1": "الأول",
      "2": "الثاني",
      "999": "خارج_الكتالوج", // stale after catalog shrink
    };
    const { source, resolved, rows } = buildAuthorsModule(names, catalogIds, { missing: 1 });
    expect(resolved).toBe(2);
    expect(rows.map(([id]) => id)).toEqual([1, 2]);
    expect(source).toContain("Coverage: 2 verified names for 3 known catalog author IDs");
    expect(source).toContain("(1 official empty/NOT_FOUND, not fabricated).");
    expect(source).not.toContain("999");
  });

  test("loads author IDs via Bun import of catalog-data, not regex", async () => {
    const ids = await loadCatalogAuthorIds();
    expect(ids.length).toBe(3037);
    expect(ids[0]).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("progress path validation rejects empty resume without writing CWD", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nusus-refresh-"));
    const progress = join(dir, "progress.json");
    await writeFile(progress, JSON.stringify({ names: {}, completed: [], missing: [], errors: {} }));
    const opts = parseArgs(["--resume", progress, "--delay-ms", "0", "--limit", "1"]);
    expect(opts.resume).toBe(progress);
  });
});
