import { describe, expect, test } from "bun:test";
import type { SkillFrontmatter } from "@xagents/core";
import { buildSkillMd, parseSkillMd } from "./index";

const SAMPLE = `---
name: Release Checklist
description: Use when the user needs a release checklist or changelog workflow.
---
When cutting a release, verify the changelog, tag, and publish.
`;

describe("parseSkillMd", () => {
  test("splits validated frontmatter from body", () => {
    const result = parseSkillMd(SAMPLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.frontmatter.name).toBe("Release Checklist");
    expect(result.value.frontmatter.description).toContain("release checklist");
    expect(result.value.body).toBe(
      "When cutting a release, verify the changelog, tag, and publish.\n",
    );
  });

  test("rejects content with no frontmatter fence", () => {
    const result = parseSkillMd("just a body, no frontmatter");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
  });

  test("rejects frontmatter missing name", () => {
    const result = parseSkillMd(`---\ndescription: only a description\n---\nbody`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
  });

  test("rejects frontmatter missing description", () => {
    const result = parseSkillMd(`---\nname: no-desc\n---\nbody`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
  });

  test("rejects syntactically invalid YAML", () => {
    const result = parseSkillMd(`---\nname: "unterminated\n---\nbody`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
  });
});

describe("buildSkillMd", () => {
  test("round-trips with parseSkillMd", () => {
    const parsed = parseSkillMd(SAMPLE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const rebuilt = buildSkillMd(parsed.value.frontmatter, parsed.value.body);
    const reparsed = parseSkillMd(rebuilt);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;

    expect(reparsed.value.frontmatter).toEqual(parsed.value.frontmatter);
    expect(reparsed.value.body).toBe(parsed.value.body);
  });

  test("emits a canonical fenced document", () => {
    const fm: SkillFrontmatter = { name: "demo", description: "a demo skill" };
    const md = buildSkillMd(fm, "Body line.\n");
    expect(md).toBe("---\nname: demo\ndescription: a demo skill\n---\nBody line.\n");
  });
});
