import { parse, stringify } from "yaml";
import {
  type AppError,
  type Result,
  type SkillFrontmatter,
  SkillFrontmatterSchema,
  appError,
  err,
  ok,
} from "@xagents/core";

/**
 * Matches a leading YAML frontmatter block fenced by `---` lines, capturing the
 * YAML source (group 1) and the remaining Markdown body (group 2). The newline
 * after the closing fence is consumed so the body starts at real content.
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Split a `SKILL.md` into its validated frontmatter and Markdown body.
 * Malformed YAML or frontmatter that fails `SkillFrontmatterSchema` is an
 * expected failure, returned as a typed `validation` error rather than thrown.
 */
export const parseSkillMd = (
  raw: string,
): Result<{ frontmatter: SkillFrontmatter; body: string }, AppError> => {
  const match = FRONTMATTER_RE.exec(raw);
  if (match === null) {
    return err(
      appError("validation", "SKILL.md is missing a `---` fenced YAML frontmatter block"),
    );
  }
  const [, yamlSource = "", body = ""] = match;

  // `yaml.parse` throws on syntactically invalid YAML; model it as a value.
  let data: unknown;
  try {
    data = parse(yamlSource);
  } catch (cause) {
    return err(appError("validation", "SKILL.md frontmatter is not valid YAML", cause));
  }

  const parsed = SkillFrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    return err(appError("validation", "SKILL.md frontmatter failed validation", parsed.error));
  }
  return ok({ frontmatter: parsed.data, body });
};

/**
 * Render canonical `SKILL.md` text from frontmatter and body. Inverse of
 * `parseSkillMd`: `parseSkillMd(buildSkillMd(fm, body))` round-trips both.
 */
export const buildSkillMd = (frontmatter: SkillFrontmatter, body: string): string =>
  // `stringify` emits a trailing newline, so it butts directly against the fence.
  `---\n${stringify(frontmatter)}---\n${body}`;
