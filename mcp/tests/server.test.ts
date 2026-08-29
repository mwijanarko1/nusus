import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const isJsonObject = (value: JsonValue): value is { [key: string]: JsonValue } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const jsonObject = (value: JsonValue): { [key: string]: JsonValue } => {
  if (!isJsonObject(value)) throw new Error("expected a JSON object");
  return value;
};

const jsonArray = (value: JsonValue): JsonValue[] => {
  if (!Array.isArray(value)) throw new Error("expected a JSON array");
  return value;
};

const isStringValue = (value: JsonValue): value is string => typeof value === "string";

const mcpRoot = path.resolve(import.meta.dir, "..");
const root = path.resolve(mcpRoot, "..");
const serverEntry = path.join(mcpRoot, "dist/index.js");
const manifest = jsonObject(JSON.parse(readFileSync(path.join(mcpRoot, "package.json"), "utf8")));
const fixture = (name: string) => Bun.file(path.join(root, "tests/fixtures", `${name}.json`)).json();
const [page, search] = await Promise.all([fixture("page-147927-5"), fixture("search-book-147927")]);
const upstream = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/search")) return Response.json(search);
    if (url.pathname.endsWith("/page")) {
      const body = structuredClone(page);
      const meta = jsonObject(JSON.parse(body.meta));
      const pageId = Number(url.searchParams.get("pg"));
      meta.page_id = pageId;
      meta.page = pageId;
      body.meta = JSON.stringify(meta);
      return Response.json(body);
    }
    return new Response("not found", { status: 404 });
  },
});
const clients: Client[] = [];
let packageDirectory: string;
let legacyClient: Client;
let modernClient: Client;

const connectClient = async (options?: ConstructorParameters<typeof Client>[1]) => {
  const client = new Client({ name: "nusus-mcp-test", version: "1.0.0" }, options);
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    cwd: root,
    env: {
      PATH: process.env.PATH ?? "",
      NUSUS_TURATH_BASE_URL: `http://127.0.0.1:${upstream.port}`,
    },
    stderr: "pipe",
  }));
  clients.push(client);
  return client;
};

beforeAll(async () => {
  packageDirectory = mkdtempSync(path.join(tmpdir(), "nusus-mcp-test-"));
  const packed = spawnSync("npm", ["pack", root, "--pack-destination", packageDirectory], { cwd: root, encoding: "utf8" });
  if (packed.status !== 0) throw new Error(`npm pack failed:\n${packed.stdout}\n${packed.stderr}`);
  const tarball = path.join(packageDirectory, packed.stdout.trim().split("\n").at(-1)!);
  const installed = spawnSync(
    "npm",
    ["install", "--offline", "--no-save", "--package-lock=false", "--ignore-scripts", tarball],
    { cwd: mcpRoot, encoding: "utf8" },
  );
  if (installed.status !== 0) throw new Error(`Local nusus install failed:\n${installed.stdout}\n${installed.stderr}`);

  const mcpBuild = spawnSync("bun", ["run", "build"], { cwd: mcpRoot, encoding: "utf8" });
  if (mcpBuild.status !== 0) throw new Error(`Build failed in ${mcpRoot}:\n${mcpBuild.stdout}\n${mcpBuild.stderr}`);

  legacyClient = await connectClient();
  modernClient = await connectClient({ versionNegotiation: { mode: { pin: "2026-07-28" } } });
}, 120_000);

afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()));
  upstream.stop(true);
  if (packageDirectory) rmSync(packageDirectory, { recursive: true, force: true });
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
    const books = jsonArray(JSON.parse(content.text));
    expect(books.length).toBeGreaterThan(0);
    const first = jsonObject(books[0]);
    expect(isStringValue(first.title) ? first.title : "").toContain("الأربعون");
  });

  test("returns primary Turath and alternate Shamela URLs for passage output", async () => {
    const result = await legacyClient.callTool({
      name: "retrieve",
      arguments: { query: "الإسلام", maxPassages: 1, maxCharsPerPassage: 500 },
    });
    expect(result.isError).not.toBe(true);
    const content = result.content[0];
    if (content?.type !== "text") throw new Error("Expected text tool content");
    const response = jsonObject(JSON.parse(content.text));
    expect(jsonArray(response.passages)[0]).toMatchObject({
      provider: "turath",
      url: "https://app.turath.io/book/147927?page=25",
      alternateUrls: { shamela: "https://shamela.ws/book/147927/25" },
    });
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
    expect(jsonArray(JSON.parse(content.text)).length).toBeGreaterThan(0);
  });

  test("keeps manifest and server versions aligned", () => {
    const version = isStringValue(manifest.version) ? manifest.version : "";
    expect(legacyClient.getServerVersion()?.version).toBe(version);
    expect(modernClient.getServerVersion()?.version).toBe(version);
  });

  test("maps Nusus errors to MCP tool errors", async () => {
    const result = await legacyClient.callTool({ name: "find_books", arguments: { query: "" } });
    expect(result.isError).toBe(true);
    const content = result.content[0];
    if (content?.type !== "text") throw new Error("Expected text tool content");
    expect(jsonObject(JSON.parse(content.text))).toEqual({
      code: "INVALID_ARGUMENT",
      message: "query must not be empty unless authorIds or categoryIds are set",
    });
  });
});
