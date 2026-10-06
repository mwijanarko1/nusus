# Project Goal

Build Nusus into the ultimate bridge between users and agents and the Turath library.

Prioritize faithful access to the source texts, reliable citations, efficient discovery and retrieval, and interfaces that work equally well for humans and AI agents.

## Tests

`bun run test` always appends to the existing `./tests` argument, so extra paths still run the whole suite. For a scoped check:

```bash
bun test tests/path.test.ts
```

Persist logs on long runs. A 60-120s timeout with no output is not a diagnosis.

Generated benchmark modules must be imported via a runtime path variable, not a literal `import()`, or bun resolves the specifier before the file exists.

## Coordinated SDK + MCP release

`~/.bunfig.toml` `minimumReleaseAge = 604800` (7 days) blocks `bun install` of a package published minutes ago. Do not disable the global age gate for verification.

Same-day MCP check against a newly published `nusus` SDK:

1. `npm pack` in the SDK root.
2. In `mcp/`, install the tarball (`bun install ../nusus-*.tgz`) or temporarily `"nusus": "file:.."`.
3. Run MCP tests against that local dependency.
4. After the SDK is 7 days old, restore the registry range (`"nusus": "^x.y.z"`).

The `update-agents` skill trap is only for updating coding agents, not for app dependency verification.
