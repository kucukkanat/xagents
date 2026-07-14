import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, resolve, sep } from "node:path";
import {
  type AppError,
  type Result,
  type Skill,
  type SkillResource,
  appError,
  err,
  ok,
} from "@xagents/core";

/**
 * Reject anything that would escape the skill directory: absolute paths, empty
 * paths, or any that normalize to include a `..` segment. We test both POSIX
 * and native separators because `resource.path` is authored as a POSIX-style
 * relative path but is joined against a possibly-Windows `destRoot`.
 */
const isUnsafeRelativePath = (p: string): boolean => {
  if (p.length === 0 || isAbsolute(p)) {
    return true;
  }
  const normalized = posix.normalize(p.replaceAll(sep, "/"));
  return normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/");
};

/**
 * Write a skill into `destRoot/<slug>/` as the packaged Agent-Skill layout eve
 * discovers natively (`skills/<name>/SKILL.md` plus sibling resource files).
 * No `defineSkill` wrapper is emitted: eve's discovery reads raw `SKILL.md`
 * packages directly, so the raw layout is the more portable form.
 */
export const materializeSkill = async (args: {
  skill: Skill;
  resources: readonly SkillResource[];
  destRoot: string;
}): Promise<Result<{ skillDir: string; files: string[] }, AppError>> => {
  const { skill, resources, destRoot } = args;

  // Fail before touching disk so a bad resource never leaves a partial write.
  const unsafe = resources.find((r) => isUnsafeRelativePath(r.path));
  if (unsafe !== undefined) {
    return err(
      appError(
        "validation",
        `Skill resource path ${JSON.stringify(unsafe.path)} escapes the skill directory`,
      ),
    );
  }

  const skillDir = resolve(destRoot, skill.slug);
  const written: string[] = [];

  const skillMdPath = join(skillDir, "SKILL.md");
  await mkdir(skillDir, { recursive: true });
  await writeFile(skillMdPath, skill.skillMd, "utf8");
  written.push(skillMdPath);

  for (const resource of resources) {
    const target = join(skillDir, resource.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, resource.content, "utf8");
    written.push(target);
  }

  return ok({ skillDir, files: written });
};
