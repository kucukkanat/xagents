import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Skill, type SkillResource, asId } from "@xagents/core";
import { materializeSkill } from "./index";

const skill: Skill = {
  id: asId("SkillId", "skl_test"),
  ownerId: asId("UserId", "usr_test"),
  name: "Release Checklist",
  slug: "release-checklist",
  description: "does releases",
  skillMd: "---\nname: Release Checklist\ndescription: does releases\n---\nBody.\n",
  visibility: "private",
  forkedFrom: null,
  resourceCount: 1,
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
};

const resource = (path: string): SkillResource => ({
  id: asId("SkillResourceId", "res_test"),
  skillId: skill.id,
  path,
  content: "print('hi')\n",
});

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "xagents-skills-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("materializeSkill", () => {
  test("writes SKILL.md and nested resources under destRoot/<slug>", async () => {
    const result = await materializeSkill({
      skill,
      resources: [resource("scripts/run.py")],
      destRoot: root,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const skillDir = join(root, "release-checklist");
    expect(result.value.skillDir).toBe(skillDir);
    expect(result.value.files).toEqual([
      join(skillDir, "SKILL.md"),
      join(skillDir, "scripts/run.py"),
    ]);

    expect(await readFile(join(skillDir, "SKILL.md"), "utf8")).toBe(skill.skillMd);
    expect(await readFile(join(skillDir, "scripts/run.py"), "utf8")).toBe("print('hi')\n");
  });

  test("rejects a parent-traversal resource path", async () => {
    const result = await materializeSkill({
      skill,
      resources: [resource("../escape.txt")],
      destRoot: root,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
  });

  test("rejects an absolute resource path", async () => {
    const result = await materializeSkill({
      skill,
      resources: [resource("/etc/passwd")],
      destRoot: root,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation");
  });
});
