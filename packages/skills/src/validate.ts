import {
  type AppError,
  type CreateSkillInput,
  type Result,
  type SkillFrontmatter,
  appError,
  err,
  ok,
  slugSchema,
} from "@xagents/core";
import { parseSkillMd } from "./skill-md";

/**
 * Derive a kebab-case slug from a human skill name: lowercase, non-alphanumeric
 * runs collapsed to single hyphens, edges trimmed, capped at the slug max (64).
 * The result is still validated by the caller so odd inputs fail loudly.
 */
const toSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");

/**
 * Validate a create-skill request end to end: parse its `SKILL.md`, then derive
 * and validate a routing slug from the frontmatter name. Everything here is an
 * expected failure surface, so all paths return a typed `validation` error.
 */
export const validateSkill = (
  input: CreateSkillInput,
): Result<{ frontmatter: SkillFrontmatter; body: string; slug: string }, AppError> => {
  const parsed = parseSkillMd(input.skillMd);
  if (!parsed.ok) {
    return parsed;
  }
  const { frontmatter, body } = parsed.value;

  const slug = slugSchema.safeParse(toSlug(frontmatter.name));
  if (!slug.success) {
    return err(
      appError(
        "validation",
        `Skill name ${JSON.stringify(frontmatter.name)} does not yield a valid slug`,
        slug.error,
      ),
    );
  }
  return ok({ frontmatter, body, slug: slug.data });
};
