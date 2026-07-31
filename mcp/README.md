# nusus-mcp

Local [Model Context Protocol](https://modelcontextprotocol.io/) stdio server for searching and citing classical Islamic and Arabic texts through Nusus and Turath.

## Claude Desktop

Node.js 20+ is required. Add this to `claude_desktop_config.json`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "nusus": {
      "command": "npx",
      "args": ["-y", "nusus-mcp"]
    }
  }
}
```

`npx` downloads the npm package automatically; users do not need to clone this repository. Claude Desktop may start with a limited `PATH`. If it cannot find `npx`, replace `"npx"` with the absolute path printed by `which npx` (macOS/Linux) or `where.exe npx` (Windows).

The server uses stdio only and writes protocol messages to stdout. It calls Turath's public API for live tools; `find_books` and `find_authors` use Nusus's bundled offline catalog.

## Tools

| Tool | Purpose and arguments |
| --- | --- |
| `find_books` | Find books offline. Required `query` (may be empty with a filter); optional `authorId`, `categoryId`, `limit`. |
| `find_authors` | Find authors offline. Required `query`; optional `limit`. |
| `retrieve` | Retrieve bounded, citable passages. Required `query`; optional `bookId`, `authorId`, `categoryId`, `maxPassages`, `maxCharsPerPassage`, `pagesBefore`, `pagesAfter`. |
| `get_context` | Get an internal Turath page with adjacent context. Required `bookId`, `pageId`; optional `pagesBefore`, `pagesAfter`. |
| `get_book` | Get book metadata and table of contents. Required `bookId`. |

Each live search filter accepts at most one ID. `pageId` is Turath's internal page ID, not the printed page.

## Development

`nusus-mcp` declares the publishable dependency `"nusus": "^0.6.0"` and is installed independently from the root package. Publish `nusus@0.6.0` before installing or publishing `nusus-mcp@0.1.0` so npm can resolve the SDK dependency. Then run:

```bash
cd mcp
bun install
bun run build
bun run typecheck
bun run test
```

`NUSUS_TURATH_BASE_URL` overrides the Turath API base URL, primarily for fixture-backed tests.
