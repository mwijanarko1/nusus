#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { NususError } from "nusus";
import { createTurathClient } from "nusus/turath";

declare const process: {
  env: Record<string, string | undefined>;
  stderr: { write(value: string): void };
  exitCode?: number;
};

type Arguments = Record<string, unknown>;

const positiveInteger = (args: Arguments, key: string, required = false): number | undefined => {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1) throw new NususError("INVALID_ARGUMENT", `${key} must be a positive integer`);
  return value as number;
};

const nonNegativeInteger = (args: Arguments, key: string): number | undefined => {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) throw new NususError("INVALID_ARGUMENT", `${key} must be a non-negative integer`);
  return value as number;
};

const stringArgument = (args: Arguments, key: string): string => {
  const value = args[key];
  if (typeof value !== "string") throw new NususError("INVALID_ARGUMENT", `${key} must be a string`);
  return value;
};

const optional = <T extends Record<string, unknown>>(values: T): T =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as T;

const baseUrl = process.env.NUSUS_TURATH_BASE_URL;
const turath = createTurathClient(baseUrl ? { baseUrl } : {});

const tools = [
  {
    name: "find_books",
    description: "Find books in Nusus's bundled offline Turath catalog by Arabic title and optional single author/category filters.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Title query; may be empty when authorId or categoryId is provided." },
        authorId: { type: "integer", minimum: 1 },
        categoryId: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "find_authors",
    description: "Find authors by Arabic name in Nusus's bundled offline Turath catalog.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "retrieve",
    description: "Retrieve bounded, citable Turath passages. Each filter accepts at most one ID because that is the verified upstream limit.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        bookId: { type: "integer", minimum: 1 },
        authorId: { type: "integer", minimum: 1 },
        categoryId: { type: "integer", minimum: 1 },
        maxPassages: { type: "integer", minimum: 1 },
        maxCharsPerPassage: { type: "integer", minimum: 1 },
        pagesBefore: { type: "integer", minimum: 0 },
        pagesAfter: { type: "integer", minimum: 0 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_context",
    description: "Get one Turath page with optional adjacent pages. pageId is Turath's internal page ID, not the printed page.",
    inputSchema: {
      type: "object",
      properties: {
        bookId: { type: "integer", minimum: 1 },
        pageId: { type: "integer", minimum: 1 },
        pagesBefore: { type: "integer", minimum: 0 },
        pagesAfter: { type: "integer", minimum: 0 },
      },
      required: ["bookId", "pageId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_book",
    description: "Get Turath book metadata and table of contents by book ID.",
    inputSchema: {
      type: "object",
      properties: { bookId: { type: "integer", minimum: 1 } },
      required: ["bookId"],
      additionalProperties: false,
    },
  },
] as const;

const jsonContent = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, (key, item) => key === "raw" ? undefined : item) }],
  ...(isError && { isError: true }),
});

const runTool = async (name: string, args: Arguments) => {
  switch (name) {
    case "find_books": {
      const authorId = positiveInteger(args, "authorId");
      const categoryId = positiveInteger(args, "categoryId");
      return turath.findBooks(stringArgument(args, "query"), optional({
        authorIds: authorId === undefined ? undefined : [authorId],
        categoryIds: categoryId === undefined ? undefined : [categoryId],
        limit: positiveInteger(args, "limit"),
      }));
    }
    case "find_authors":
      return turath.findAuthors(stringArgument(args, "query"), optional({ limit: positiveInteger(args, "limit") }));
    case "retrieve": {
      const bookId = positiveInteger(args, "bookId");
      const authorId = positiveInteger(args, "authorId");
      const categoryId = positiveInteger(args, "categoryId");
      const scope = optional({
        bookIds: bookId === undefined ? undefined : [bookId],
        authorIds: authorId === undefined ? undefined : [authorId],
        categoryIds: categoryId === undefined ? undefined : [categoryId],
      });
      return turath.retrieve(stringArgument(args, "query"), optional({
        scope: Object.keys(scope).length ? scope : undefined,
        maxPassages: positiveInteger(args, "maxPassages"),
        maxCharsPerPassage: positiveInteger(args, "maxCharsPerPassage"),
        pagesBefore: nonNegativeInteger(args, "pagesBefore"),
        pagesAfter: nonNegativeInteger(args, "pagesAfter"),
      }));
    }
    case "get_context":
      return turath.getContextByPage(
        positiveInteger(args, "bookId", true)!,
        positiveInteger(args, "pageId", true)!,
        optional({
          pagesBefore: nonNegativeInteger(args, "pagesBefore"),
          pagesAfter: nonNegativeInteger(args, "pagesAfter"),
        }),
      );
    case "get_book":
      return turath.getBook(positiveInteger(args, "bookId", true)!);
    default:
      throw new NususError("INVALID_ARGUMENT", `Unknown tool: ${name}`);
  }
};

const server = new Server(
  { name: "nusus-mcp", version: "0.1.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    return jsonContent(await runTool(request.params.name, request.params.arguments ?? {}));
  } catch (error) {
    if (error instanceof NususError) return jsonContent({ code: error.code, message: error.message }, true);
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonContent({ code: "INTERNAL", message }, true);
  }
});

try {
  await server.connect(new StdioServerTransport());
} catch (error) {
  process.stderr.write(`nusus-mcp failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
