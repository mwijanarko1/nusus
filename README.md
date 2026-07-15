# Nusus

TypeScript SDK for retrieving citable context from classical Islamic and Arabic texts. The first provider is [Turath](https://app.turath.io/).

```bash
npm install nusus
# or
bun add nusus
```

```ts
import { createTurathClient } from "nusus/turath";

const turath = createTurathClient({ timeout: 10_000 });
const results = await turath.search("إنما الأعمال بالنيات", {
  bookIds: [147927],
});
const context = await turath.getContext(results.items[0]);

console.log(context.text);
console.log(context.citation);
console.log(context.url);
```

Agent-ready retrieval is one call:

```ts
const context = await turath.retrieve("النية", {
  maxPassages: 5,
  maxCharsPerPassage: 2_000,
});
```

All requests support `AbortSignal`; failures use the exported `NususError` codes. Source text is returned unchanged. Search filters currently accept one Turath ID each because that is all the upstream API has verified.

## Agent CLI

```bash
npx nusus "إنما الأعمال بالنيات" 3
npx nusus --book-id 147927 "النية" 3
npx nusus --page 147927 5

# Bun
bunx nusus "إنما الأعمال بالنيات" 3
```

The CLI emits JSON Lines with passage text, source metadata, citations, and direct Turath URLs. It also supports `--madhhab hanafi|maliki|shafii|hanbali` and `--books "title one,title two"`.

## Known limitations

Turath does not expose verified catalog-discovery endpoints, so book, author, and category filters require numeric IDs. Browser support is not claimed because the checked API responses do not advertise CORS support.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```

