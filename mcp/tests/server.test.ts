import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const mcpRoot = path.resolve(import.meta.dir, "..");
const root = path.resolve(mcpRoot, "..");
const serverEntry = path.join(mcpRoot, "dist/index.js");
let client: Client;

beforeAll(async () => {
  for (const [cwd, script] of [[root, "build"], [mcpRoot, "build"]] as const) {
    const result = spawnSync("bun", ["run", script], { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Build failed in ${cwd}:\n${result.stdout}\n${result.stderr}`);
  }

  client = new Client({ name: "nusus-mcp-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    cwd: root,
    stderr: "pipe",
  }));
}, 120_000);

afterAll(async () => {
  await client?.close();
});

describe("nusus-mcp stdio server", () => {
  test("lists exactly the five Nusus tools", async () => {
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "find_books",
      "find_authors",
      "retrieve",
      "get_context",
      "get_book",
    ]);
  });

  test("runs find_books against the offline catalog", async () => {
    const result = await client.callTool({
      name: "find_books",
      arguments: { query: "الأربعون النووية", limit: 3 },
    });
    expect(result.isError).not.toBe(true);
    const content = result.content[0];
    expect(content?.type).toBe("text");
    if (content?.type !== "text") throw new Error("Expected text tool content");
    const books = JSON.parse(content.text) as Array<{ id: string; title: string }>;
    expect(books.length).toBeGreaterThan(0);
    expect(books[0]?.title).toContain("الأربعون");
  });

  test("maps Nusus errors to MCP tool errors", async () => {
    const result = await client.callTool({ name: "find_books", arguments: { query: "" } });
    expect(result.isError).toBe(true);
    const content = result.content[0];
    if (content?.type !== "text") throw new Error("Expected text tool content");
    expect(JSON.parse(content.text)).toEqual({
      code: "INVALID_ARGUMENT",
      message: "query must not be empty unless authorIds or categoryIds are set",
    });
  });
});
