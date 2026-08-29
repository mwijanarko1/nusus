#!/usr/bin/env node
import { Server, type Tool } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { NususError } from "nusus";
import type { Author, Book, Passage, RetrievedContext } from "nusus";
import { createTurathClient } from "nusus/turath";

type JsonInput = string | number | boolean | null | JsonInput[] | { [key: string]: JsonInput };

const isInteger = (value: JsonInput): value is number =>
  typeof value === "number" && Number.isInteger(value);
const isString = (value: JsonInput): value is string => typeof value === "string";

declare const process: {
  env: Record<string, string | undefined>;
  stderr: { write(value: string): void };
  exitCode?: number;
};

type Arguments = {
  query?: JsonInput;
  bookId?: JsonInput;
  authorId?: JsonInput;
  categoryId?: JsonInput;
  limit?: JsonInput;
  maxPassages?: JsonInput;
  maxCharsPerPassage?: JsonInput;
  pagesBefore?: JsonInput;
  pagesAfter?: JsonInput;
  pageId?: JsonInput;
};

type ArgumentKey = keyof Arguments;

const positiveInteger = (args: Arguments, key: ArgumentKey): number | undefined => {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!isInteger(value) || value < 1) throw new NususError("INVALID_ARGUMENT", `${key} must be a positive integer`);
  return value;
};

const requiredPositiveInteger = (args: Arguments, key: ArgumentKey): number => {
  const value = positiveInteger(args, key);
  if (value === undefined) throw new NususError("INVALID_ARGUMENT", `${key} must be a positive integer`);
  return value;
};

const nonNegativeInteger = (args: Arguments, key: ArgumentKey): number | undefined => {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!isInteger(value) || value < 0) throw new NususError("INVALID_ARGUMENT", `${key} must be a non-negative integer`);
  return value;
};

const stringArgument = (args: Arguments, key: ArgumentKey): string => {
  const value = args[key];
  if (value === undefined || !isString(value)) throw new NususError("INVALID_ARGUMENT", `${key} must be a string`);
  return value;
};

const baseUrl = process.env.NUSUS_TURATH_BASE_URL;
const turath = createTurathClient(baseUrl ? { baseUrl } : {});

const tools: Tool[] = [
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
];

type ToolResult = Book | Author | RetrievedContext | Passage;
type Jsonable = ToolResult | ToolResult[] | { code: string; message: string };

const jsonContent = (value: Jsonable, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, (key, item) => key === "raw" ? undefined : item) }],
  ...(isError && { isError: true }),
});

const runTool = async (name: string, args: Arguments) => {
  switch (name) {
    case "find_books": {
      const authorId = positiveInteger(args, "authorId");
      const categoryId = positiveInteger(args, "categoryId");
      return turath.findBooks(stringArgument(args, "query"), {
        authorIds: authorId === undefined ? undefined : [authorId],
        categoryIds: categoryId === undefined ? undefined : [categoryId],
        limit: positiveInteger(args, "limit"),
      });
    }
    case "find_authors":
      return turath.findAuthors(stringArgument(args, "query"), { limit: positiveInteger(args, "limit") });
    case "retrieve": {
      const bookId = positiveInteger(args, "bookId");
      const authorId = positiveInteger(args, "authorId");
      const categoryId = positiveInteger(args, "categoryId");
      const bookIds = bookId === undefined ? undefined : [bookId];
      const authorIds = authorId === undefined ? undefined : [authorId];
      const categoryIds = categoryId === undefined ? undefined : [categoryId];
      const scope = bookIds || authorIds || categoryIds ? { bookIds, authorIds, categoryIds } : undefined;
      return turath.retrieve(stringArgument(args, "query"), {
        scope,
        maxPassages: positiveInteger(args, "maxPassages"),
        maxCharsPerPassage: positiveInteger(args, "maxCharsPerPassage"),
        pagesBefore: nonNegativeInteger(args, "pagesBefore"),
        pagesAfter: nonNegativeInteger(args, "pagesAfter"),
      });
    }
    case "get_context":
      return turath.getContextByPage(
        requiredPositiveInteger(args, "bookId"),
        requiredPositiveInteger(args, "pageId"),
        {
          pagesBefore: nonNegativeInteger(args, "pagesBefore"),
          pagesAfter: nonNegativeInteger(args, "pagesAfter"),
        },
      );
    case "get_book":
      return turath.getBook(requiredPositiveInteger(args, "bookId"));
    default:
      throw new NususError("INVALID_ARGUMENT", `Unknown tool: ${name}`);
  }
};

const createServer = () => {
  const server = new Server(
    { name: "nusus-mcp", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler("tools/list", async () => ({ tools: [...tools] }));
  server.setRequestHandler("tools/call", async (request) => {
    try {
      return jsonContent(await runTool(request.params.name, request.params.arguments ?? {}));
    } catch (error) {
      if (error instanceof NususError) return jsonContent({ code: error.code, message: error.message }, true);
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonContent({ code: "INTERNAL", message }, true);
    }
  });

  return server;
};

try {
  serveStdio(createServer, {
    onerror: (error) => {
      process.stderr.write(`nusus-mcp failed: ${error.message}\n`);
      process.exitCode = 1;
    },
  });
} catch (error) {
  process.stderr.write(`nusus-mcp failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
