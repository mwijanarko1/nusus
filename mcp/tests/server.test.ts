import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const mcpRoot = path.resolve(import.meta.dir, "..");
const root = path.resolve(mcpRoot, "..");
const serverEntry = path.join(mcpRoot, "dist/index.js");
const manifest = JSON.parse(readFileSync(path.join(mcpRoot, "package.json"), "utf8")) as { version: string };
const clients: Client[] = [];
let legacyClient: Client;
let modernClient: Client;

const connectClient = async (options?: ConstructorParameters<typeof Client>[1]) => {
  const client = new Client({ name: "nusus-mcp-test", version: "1.0.0" }, options);
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    cwd: root,
    stderr: "pipe",
  }));
  clients.push(client);
  return client;
};

beforeAll(async () => {
  for (const [cwd, script] of [[root, "build"], [mcpRoot, "build"]] as const) {
    const result = spawnSync("bun", ["run", script], { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Build failed in ${cwd}:\n${result.stdout}\n${result.stderr}`);
  }

  legacyClient = await connectClient();
  modernClient = await connectClient({ versionNegotiation: { mode: { pin: "2026-07-28" } } });
}, 120_000);

afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()));
});

describe("nusus-mcp stdio server", () => {
  test("serves legacy clients and lists exactly the five Nusus tools", async () => {
    expect(legacyClient.getProtocolEra()).toBe("legacy");
    const result = await legacyClient.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "find_books",
      "find_authors",
      "retrieve",
      "get_context",
      "get_book",
    ]);
  });

  test("runs find_books against the offline catalog for legacy clients", async () => {
    const result = await legacyClient.callTool({
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

  test("serves a modern 2026-07-28 client that can list and call tools", async () => {
    expect(modernClient.getProtocolEra()).toBe("modern");
    expect((await modernClient.listTools()).tools).toHaveLength(5);
    const result = await modernClient.callTool({
      name: "find_authors",
      arguments: { query: "النووي", limit: 3 },
    });
    expect(result.isError).not.toBe(true);
    const content = result.content[0];
    if (content?.type !== "text") throw new Error("Expected text tool content");
    expect((JSON.parse(content.text) as unknown[]).length).toBeGreaterThan(0);
  });

  test("keeps manifest and server versions aligned", () => {
    expect(manifest.version).toBe("0.2.0");
    expect(legacyClient.getServerVersion()?.version).toBe(manifest.version);
    expect(modernClient.getServerVersion()?.version).toBe(manifest.version);
  });

  test("maps Nusus errors to MCP tool errors", async () => {
    const result = await legacyClient.callTool({ name: "find_books", arguments: { query: "" } });
    expect(result.isError).toBe(true);
    const content = result.content[0];
    if (content?.type !== "text") throw new Error("Expected text tool content");
    expect(JSON.parse(content.text)).toEqual({
      code: "INVALID_ARGUMENT",
      message: "query must not be empty unless authorIds or categoryIds are set",
    });
  });
});
