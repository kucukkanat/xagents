# @xagents/search

Tiny, framework-agnostic **fuzzy search** for xagents' in-memory lists, built on
[Fuse.js](https://fusejs.io). It powers every list filter, picker, and the ⌘K
command palette in the web app, so they all rank and highlight identically.

- **Predictable, not sloppy** — tuned strict (`threshold: 0.3`, location-ignored)
  so partial and word matches land but outright misspellings don't.
- **Highlight-ready** — results carry the matched character ranges, and
  `highlightSegments` turns them into render-ready segments.
- **Pure** — no React, no DOM. Just data in, ranked results out.

## Install

Workspace-internal:

```jsonc
// package.json
{ "dependencies": { "@xagents/search": "workspace:*" } }
```

## Usage

### Search a list

```ts
import { fuzzySearch } from "@xagents/search";

const agents = [
  { name: "Research Bot", description: "Summarizes academic papers" },
  { name: "Resume Helper", description: "Improves your CV" },
];

const results = fuzzySearch(agents, "research", [
  { name: "name", weight: 2 }, // title hits outrank body hits
  { name: "description", weight: 1 },
]);

results[0]?.item.name; // "Research Bot"
```

An empty or whitespace-only query returns **every item in its original order**,
so a cleared search box shows the untouched list:

```ts
fuzzySearch(agents, "", keys).map((r) => r.item); // === agents
```

### Highlight the matches

Each result reports where it matched. Pair `rangesForKey` with
`highlightSegments` to wrap the matched characters:

```ts
import { fuzzySearch, rangesForKey, highlightSegments } from "@xagents/search";

const [top] = fuzzySearch(agents, "research", keys);
if (top) {
  const ranges = rangesForKey(top, "name"); // [[0, 7]] → "Research"
  highlightSegments(top.item.name, ranges);
  // → [ { text: "Research", match: true }, { text: " Bot", match: false } ]
}
```

### Reuse the index

When you query the same list repeatedly (e.g. once per keystroke), build the
index once with `createSearcher` and call `searchWith`:

```ts
import { createSearcher, searchWith } from "@xagents/search";

const searcher = createSearcher(agents, keys);
searchWith(searcher, agents, "res");
searchWith(searcher, agents, "resu");
```

### Tune strictness

Every entry point accepts Fuse option overrides. `threshold: 0` demands an exact
substring; higher values are more forgiving:

```ts
fuzzySearch(agents, "resu", keys, { threshold: 0 }); // only exact-substring hits
```

## API

| Export              | Description                                                             |
| ------------------- | ----------------------------------------------------------------------- |
| `fuzzySearch`       | One-shot: index `items` and query them, returning ranked `SearchResult`s. |
| `createSearcher`    | Build a reusable Fuse index for a fixed item set.                        |
| `searchWith`        | Query a `createSearcher` index (empty query → identity).                |
| `rangesForKey`      | The matched ranges for one field of a result, or `[]`.                  |
| `highlightSegments` | Split text into matched/unmatched segments for rendering.              |
| `DEFAULT_THRESHOLD` | The default (`0.3`) strictness.                                          |

Types: `SearchKey`, `SearchResult<T>`, `FieldMatch`, `MatchRange`, `Segment`.

## Test

```sh
bun test packages/search
```
