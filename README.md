# Nusus

TypeScript SDK, **agent CLI, and local MCP server** for searching and citing classical Islamic and Arabic texts through [Turath](https://app.turath.io/), a Shamela-style digital library. Use Nusus to retrieve source text, metadata, citations, locators, and direct links from Arabic heritage books for research tools and AI agents. The `nusus` binary ships with the SDK; the optional MCP server ships as [`nusus-mcp`](https://www.npmjs.com/package/nusus-mcp).

**Links:** [npm](https://www.npmjs.com/package/nusus) · [GitHub](https://github.com/mwijanarko1/nusus)

## Which interface do I need?

All three wrap the same retrieval core and return the same citations. Pick by how you (or your agent) work:

| You are… | Use | Setup |
| --- | --- | --- |
| Chatting in an MCP app (Claude Desktop, Cursor, …) | **MCP server** (`nusus-mcp`) | Paste a 6-line config → [Local MCP server](#local-mcp-server) |
| Using a coding agent with a terminal (pi, Claude Code, Codex, …) | **CLI** (`nusus`) | `npm install -g nusus` → [Set up an AI agent](#set-up-an-ai-agent) |
| In a terminal yourself | **CLI** (`nusus`) | `npm install -g nusus` → [Quick start](#quick-start-humans-or-ai-agents) |
| Writing TypeScript/JavaScript code | **SDK** (`nusus`) | `npm install nusus` → [SDK](#sdk) |

## Quick start (humans or AI agents)

Needs **Node.js 20+** (ships with `npm`). If you already have that:

```bash
npm install -g nusus   # or: npx nusus …
# or, in a project: npm install nusus / bun add nusus
nusus --help
```

### No Node yet?

Install Node first, then run the commands above.

| OS | Easiest path |
| --- | --- |
| **Windows** | Install **[Node.js](https://nodejs.org/en/download/current)** (the `.msi` installer). Or in PowerShell (Windows 10+): `winget install OpenJS.NodeJS.LTS` |
| **macOS** | Install **[Node.js](https://nodejs.org/en/download/current)** (the `.pkg` installer). Homebrew is optional: `brew install node` |
| **Linux** | Install **[Node.js](https://nodejs.org/en/download/current)** from the Node site, or your distro (`apt`/`dnf`/etc.). |

You do **not** need Homebrew, Bun, Claude Desktop, or a local Shamela library. After Node is installed, open a **new** terminal and check:

```bash
node -v   # v20 or newer
npm -v
```

## Set up an AI agent

Nusus works with AI agents three ways. Use whichever matches your agent — they expose the same tools and citations.

### 1. Coding agents with a terminal (pi, Claude Code, Codex, Cursor agents, …)

These agents can run shell commands, so the CLI needs zero configuration. Give your agent the npm or GitHub link and this prompt:

```
Set up Nusus for classical Islamic text research via Turath.

Package: https://www.npmjs.com/package/nusus
Repo: https://github.com/mwijanarko1/nusus

1. If `node -v` is missing or older than v20, install Node.js from https://nodejs.org/en/download/current (Windows: .msi or `winget install OpenJS.NodeJS.LTS`; macOS: .pkg or `brew install node`; Linux: Node from that page or the distro package manager). Open a new shell after install.
2. Install the CLI: `npm install -g nusus` (or use `npx nusus …` without a global install).
3. Research with the CLI (prefer these tools):
   - nusus find-books "<title>" / nusus find-authors "<name>"
   - nusus retrieve "<query>" --max-passages 5 --max-chars 2000
   - nusus search "<query>" --book-id <id> after resolving the book
   - nusus get-page / get-context / get-book for a specific page or TOC
4. Always cite book + page + URL from the output. page-id is Turath internal page, not printed page. Retrieval only — no fatwas.

Topic: [YOUR QUESTION]
```

For a reusable version of these instructions, install [`docs/turath-research-SKILL.md`](docs/turath-research-SKILL.md) as an agent skill.

### 2. MCP apps (Claude Desktop, Cursor, and other MCP clients)

If your agent lives in an app that supports the [Model Context Protocol](https://modelcontextprotocol.io/), add the [`nusus-mcp`](https://www.npmjs.com/package/nusus-mcp) server instead — no terminal use by the agent, tools appear natively. Config and details: [Local MCP server](#local-mcp-server).

### 3. Agents you are building in code

Call the [SDK](#sdk) directly — `retrieve()` returns bounded, citation-carrying passages designed to drop into a prompt, and you can wire it up as a custom tool in any agent framework.

## SDK

```ts
import { createTurathClient } from "nusus/turath";

const turath = createTurathClient({ timeout: 10_000 });
const books = turath.findBooks("الأربعون النووية");
const authors = turath.findAuthors("النووي");
const categories = turath.listCategories();
const catalog = turath.getCatalogMetadata();
const results = await turath.search("إنما الأعمال بالنيات", {
  bookIds: [147927],
});
const context = await turath.getContext(results.items[0]);

console.log(context.text);
console.log(context.citation);
console.log(context.locator);
console.log(context.url);
```

Agent-ready retrieval is one call. By default each hit is a single page with a match-centered excerpt; adjacent pages are opt-in:

```ts
const context = await turath.retrieve("النية", {
  maxPassages: 5,
  maxCharsPerPassage: 2_000,
  // pagesBefore: 1,
  // pagesAfter: 1,
});

for (const passage of context.passages) {
  console.log(passage.citation); // includes تراث bookId + صفحة تراث
  console.log(passage.locator); // { bookId, internalPage, url, ... }
  console.log(passage.provenance); // rank, truncation, scope, ...
}
```

All requests support `AbortSignal`; failures use the exported `NususError` codes. Public passage text is plain Arabic with Turath presentation/highlight tags removed; low-level page/search/book calls retain the exact upstream payload in optional `raw`, while agent-ready `retrieve()` omits it. If an exact live query has zero matches, search tries normalized Arabic variants and reports the first successful one as `effectiveQuery`. Multi-page context includes `segments` with per-page text offsets, citations, locators, and URLs. Search filters currently accept one Turath ID each because that is all the upstream API has verified. The core SDK is retrieval-only: no madhhab ranking, fatwa logic, or hadith grading.

## Agent CLI

The package installs a `nusus` binary (`scripts/search.mjs`) that wraps the SDK as explicit research tools. Prefer the CLI from agents; use the SDK from application code.

```bash
npm install -g nusus   # or: npx nusus …
nusus --help
nusus --version

# Discover (offline bundled catalog)
nusus find-books "الأربعون النووية" --limit 5
nusus find-books --author-id 44 --limit 10
nusus find-authors "النووي" --limit 5
nusus list-categories
nusus catalog

# Search / retrieve (live Turath)
nusus search "إنما الأعمال بالنيات" --book-id 147927
nusus retrieve "النية" --max-passages 3 --max-chars 2000

# Page / metadata (live)
nusus get-page --book-id 147927 --page-id 5
nusus get-pages --book-id 147927 --from 5 --to 7
nusus get-context --book-id 147927 --page-id 5 --pages-before 1 --pages-after 1
nusus get-book 147927
nusus find-toc "الحديث الأول" --book-id 147927 --limit 10
nusus get-author 44
```

Default stdout is **JSONL** (one object per line, camelCase, every line has `type`). Use `--format text` for compact human lines. Diagnostics are JSON on **stderr** only. Unknown or command-inapplicable flags are rejected.

| Record `type` | Commands |
| --- | --- |
| `meta` | First line of `find-books`, `find-authors`, `search`, `retrieve`, `get-pages`, `find-toc` |
| `book` / `author` / `category` / `catalog` | Discovery + `get-book` / `get-author` |
| `passage` | `search`, `retrieve`, `get-page`, `get-pages`, `get-context` |
| `toc-entry` | `find-toc` |

| Exit | Meaning |
| --- | --- |
| 0 | Success (including zero hits; find/search/retrieve emit a `meta` line; offline finders report `returned`, live search/retrieve report `totalMatches`) |
| 1 | Usage / invalid argument |
| 2 | Not found |
| 3 | Rate limit / HTTP / invalid response / timeout (`ABORTED`) / internal |

`page-id` is Turath’s internal page (`location.internalPage`), not the printed page. `search`/`retrieve` accept at most one `--book-id`, one `--author-id`, and one `--category-id` (filters may be combined). Offline `find-books` accepts repeated `--author-id`/`--category-id` and may omit the title query when those filters are set. `--timeout 0` disables the request timeout (max `600000`). There is no madhhab ranking or multi-book fanout in the CLI.

Repo layout and module boundaries: [`docs/CODEBASE_MAP.md`](docs/CODEBASE_MAP.md). Agent skill copy: [`docs/turath-research-SKILL.md`](docs/turath-research-SKILL.md).

## Local MCP server

[`nusus-mcp`](https://www.npmjs.com/package/nusus-mcp) is an optional stdio server for MCP clients. It exposes five tools: `find_books`, `find_authors`, `retrieve`, `get_context`, and `get_book`. Requires Node.js 20+ (see [Quick start](#quick-start-humans-or-ai-agents)); nothing else to install — `npx` fetches the package on first launch.

**Claude Desktop:** add this to `claude_desktop_config.json` (Settings → Developer → Edit Config) and restart the app:

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

**Other MCP clients** (Cursor, VS Code, etc.): register the same stdio server — command `npx`, args `["-y", "nusus-mcp"]` — using that client's MCP settings.

### Paste this to an AI agent to install it for you

If you have any coding agent with shell access (pi, Claude Code, Codex, Cursor, …), paste this and it will configure the MCP server in your apps:

```
Install the nusus-mcp MCP server (classical Islamic text research via Turath) into my MCP client apps.

Package: https://www.npmjs.com/package/nusus-mcp (local stdio server, no API key)

1. Verify Node.js 20+: `node -v`. If missing/old, install from https://nodejs.org/en/download/current, then open a new shell.
2. Server command for every client: command `npx`, args ["-y", "nusus-mcp"]. If the app launches with a limited PATH, use the absolute npx path from `which npx` / `where.exe npx` instead.
3. Detect which of these apps I have and configure each one (create the file/entry if absent, MERGE into existing JSON — never overwrite other servers):
   - Claude Desktop: add to "mcpServers" in claude_desktop_config.json (macOS: ~/Library/Application Support/Claude/; Windows: %APPDATA%\Claude\; Linux: ~/.config/Claude/).
   - Claude Code: run `claude mcp add nusus -- npx -y nusus-mcp`.
   - Cursor: add to "mcpServers" in ~/.cursor/mcp.json (or .cursor/mcp.json in a project).
   - VS Code: add to "servers" in the user mcp.json via the "MCP: Open User Configuration" command, type "stdio".
   - Codex CLI: add to ~/.codex/config.toml: [mcp_servers.nusus] command = "npx" args = ["-y", "nusus-mcp"].
   - ChatGPT: skip — it only supports remote MCP connectors, not local stdio servers.
4. Verify: `npx -y nusus-mcp` should start and wait on stdin (Ctrl+C to exit). Tell me which apps you configured and that I must restart them.

Do not add API keys or env vars; none are needed. Optional: NUSUS_TURATH_BASE_URL overrides the Turath API base URL for testing.
```

If the app cannot find `npx` because it starts with a limited `PATH`, use the absolute path from `which npx` (macOS/Linux) or `where.exe npx` (Windows). See [`mcp/README.md`](mcp/README.md) for tool arguments and development instructions.

## Known limitations

Book and category discovery uses a bundled snapshot of 8,124 Turath books scanned in March 2026 because Turath does not expose verified catalog endpoints. Newly added or changed upstream records may therefore be absent until the snapshot is refreshed.

Offline author discovery uses an ID→name map verified via official `GET /author` only (no fabricated names), plus live `getAuthor()` for full metadata. `getCatalogMetadata()` reports known book/author ID counts, resolved offline names, and unresolved author IDs. Re-hydrate or resume with `bun scripts/refresh-catalog.mjs authors` (resumable, rate-limit aware). Book listing refresh is fail-closed: `bun scripts/refresh-catalog.mjs books` refuses unofficial sources.

Browser support is not claimed because the checked API responses do not advertise CORS support.

## Development

```bash
bun install
bun run build   # CLI bin loads dist/; also auto-built by CLI tests if missing
bun test
bun run typecheck

# optional live contract (also scheduled via GitHub Actions)
bun run test:live

# official-API catalog tooling
bun scripts/refresh-catalog.mjs authors --limit 10
bun scripts/refresh-catalog.mjs books   # fails closed on purpose
```
