import type { SearchKey } from "@xagents/search";

/**
 * The default fuzzy-search fields for every list surface: match on name and
 * description, with the name weighted higher so a title hit outranks a body
 * hit. Shared so every list, picker, and the ⌘K palette rank identically.
 */
export const NAME_DESC_KEYS: readonly SearchKey[] = [
  { name: "name", weight: 2 },
  { name: "description", weight: 1 },
];
