# @xagents/skills

Parse, validate, and compile Anthropic-style **Agent Skills** (`SKILL.md` +
bundled resources) into the on-disk form an [eve](https://github.com/vercel/eve)
agent auto-discovers.

## Layout decision

eve discovers packaged skills rooted at `agent/skills/<slug>/SKILL.md`, with
sibling files (`references/`, `scripts/`, `assets/`) resolved relative to that
`SKILL.md` (see eve's `discover/skills` and the Skills docs). Because raw
`SKILL.md` packages are discovered natively, `materializeSkill` emits the **raw
layout** — no `defineSkill` TypeScript wrapper. The raw form is the more
portable one: it ports as-is to any Agent Skills runtime.

## API

| Function | Purpose |
| --- | --- |
| `parseSkillMd(raw)` | Split validated frontmatter from the Markdown body. |
| `buildSkillMd(frontmatter, body)` | Inverse of `parseSkillMd`; renders canonical `SKILL.md`. |
| `validateSkill(input)` | Parse a `CreateSkillInput` and derive a validated kebab-case slug. |
| `materializeSkill({ skill, resources, destRoot })` | Write `destRoot/<slug>/SKILL.md` + resources to disk. |

Expected failures are returned as `Result<_, AppError>` (`@xagents/core`), never
thrown.

## Example

```ts
import { parseSkillMd, materializeSkill } from "@xagents/skills";

const skillMd = `---
name: Release Checklist
description: Use when the user needs a release checklist or changelog workflow.
---
When cutting a release, verify the changelog, tag, and publish.
`;

const parsed = parseSkillMd(skillMd);
if (!parsed.ok) throw new Error(parsed.error.message);
console.log(parsed.value.frontmatter.name); // "Release Checklist"

// Compile into an eve agent project under agent/skills/<slug>/.
const result = await materializeSkill({
  skill: {
    id: skillId,
    ownerId,
    name: parsed.value.frontmatter.name,
    slug: "release-checklist",
    description: parsed.value.frontmatter.description,
    skillMd,
    visibility: "private",
    forkedFrom: null,
    resourceCount: 1,
    createdAt: now,
    updatedAt: now,
  },
  resources: [
    { id: resId, skillId, path: "references/checklist.md", content: "# Checklist\n" },
  ],
  destRoot: "agent/skills",
});
if (!result.ok) throw new Error(result.error.message);
console.log(result.value.files); // ["agent/skills/release-checklist/SKILL.md", ...]
```

## Development

```sh
# Type-check
./node_modules/.bin/tsc --noEmit -p packages/skills/tsconfig.json

# Unit + integration tests (pure logic + tmp-dir writes)
bun test packages/skills
```
