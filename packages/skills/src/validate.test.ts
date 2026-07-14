import { describe, expect, test } from "bun:test";
import { CreateSkillInput } from "@xagents/core";
import { validateSkill } from "./index";

const makeInput = (skillMd: string) =>
  CreateSkillInput.parse({ name: "x", skillMd });

describe("validateSkill", () => {
  test("derives a kebab-case slug from the frontmatter name", () => {
    const result = validateSkill(
      makeInput(`---\nname: My Cool Skill!\ndescription: does cool things\n---\nbody`),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slug).toBe("my-cool-skill");
    expect(result.value.frontmatter.name).toBe("My Cool Skill!");
    expect(result.value.body).toBe("body");
  });

  test("collapses and trims separators", () => {
    const result = validateSkill(
      makeInput(`---\nname: "  Release   __  Notes  "\ndescription: notes\n---\nb`),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slug).toBe("release-notes");
  });

  test("propagates parse failures", () => {
    const result = validateSkill(makeInput("no frontmatter here"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
  });

  test("fails when the name yields no slug characters", () => {
    const result = validateSkill(
      makeInput(`---\nname: "***"\ndescription: only symbols\n---\nb`),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
  });
});
