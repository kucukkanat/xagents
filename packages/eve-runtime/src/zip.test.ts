import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unzipBuffer, zipDirectory } from "./zip";

/** Decode a STORE/DEFLATE zip via the central directory into name→content. */
const unzip = (zip: Buffer): Map<string, Buffer> => {
  const eocd = zip.length - 22;
  const count = zip.readUInt16LE(eocd + 10);
  let ptr = zip.readUInt32LE(eocd + 16); // central-directory offset
  const out = new Map<string, Buffer>();

  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(ptr)).toBe(0x02014b50);
    const method = zip.readUInt16LE(ptr + 10);
    const crc = zip.readUInt32LE(ptr + 16);
    const compSize = zip.readUInt32LE(ptr + 20);
    const nameLen = zip.readUInt16LE(ptr + 28);
    const extraLen = zip.readUInt16LE(ptr + 30);
    const commentLen = zip.readUInt16LE(ptr + 32);
    const localOffset = zip.readUInt32LE(ptr + 42);
    const name = zip.toString("utf8", ptr + 46, ptr + 46 + nameLen);

    // Jump to the local header to find where the file data starts.
    const localNameLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = zip.subarray(dataStart, dataStart + compSize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);

    expect(crc32(data) >>> 0).toBe(crc);
    out.set(name, data);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
};

describe("zipDirectory", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xagents-zip-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("round-trips a nested directory tree", async () => {
    await writeFile(join(dir, "package.json"), '{"name":"a"}');
    await mkdir(join(dir, "agent", "skills", "demo"), { recursive: true });
    await writeFile(join(dir, "agent", "instructions.md"), "# Hello\n");
    const big = "x".repeat(10_000); // compressible payload exercises DEFLATE
    await writeFile(join(dir, "agent", "skills", "demo", "SKILL.md"), big);

    const zip = await zipDirectory(dir);
    const files = unzip(zip);

    expect(files.get("package.json")?.toString()).toBe('{"name":"a"}');
    expect(files.get("agent/instructions.md")?.toString()).toBe("# Hello\n");
    expect(files.get("agent/skills/demo/SKILL.md")?.toString()).toBe(big);
    expect(files.size).toBe(3);
  });

  test("stores forward-slash paths regardless of platform separators", async () => {
    await mkdir(join(dir, "a", "b"), { recursive: true });
    await writeFile(join(dir, "a", "b", "c.txt"), "deep");

    const files = unzip(await zipDirectory(dir));
    expect([...files.keys()]).toEqual(["a/b/c.txt"]);
  });

  test("is deterministic for identical input", async () => {
    await writeFile(join(dir, "f.txt"), "same");
    const a = await zipDirectory(dir);
    const b = await zipDirectory(dir);
    expect(a.equals(b)).toBe(true);
  });
});

describe("unzipBuffer", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "xagents-unzip-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("round-trips a zipDirectory archive", async () => {
    await writeFile(join(dir, "package.json"), '{"name":"a"}');
    await mkdir(join(dir, "agent"), { recursive: true });
    await writeFile(join(dir, "agent", "instructions.md"), "# Hi\n");
    const big = "x".repeat(5000);
    await writeFile(join(dir, "agent", "big.txt"), big);

    const res = unzipBuffer(await zipDirectory(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.get("package.json")?.toString()).toBe('{"name":"a"}');
    expect(res.value.get("agent/instructions.md")?.toString()).toBe("# Hi\n");
    expect(res.value.get("agent/big.txt")?.toString()).toBe(big);
    expect(res.value.size).toBe(3);
  });

  test("rejects a non-zip buffer", () => {
    const res = unzipBuffer(Buffer.from("this is not a zip file at all"));
    expect(res.ok).toBe(false);
  });

  test("rejects an entry whose path escapes the archive root", async () => {
    // Zip a same-length inner path, then binary-patch it to a traversal path so
    // the (name-independent) CRCs and header offsets stay valid.
    await mkdir(join(dir, "ab"), { recursive: true });
    await writeFile(join(dir, "ab", "bb.txt"), "payload");
    const zip = await zipDirectory(dir);
    const patched = Buffer.from(
      zip.toString("latin1").replaceAll("ab/bb.txt", "../bb.txt"),
      "latin1",
    );
    const res = unzipBuffer(patched);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/unsafe path/i);
  });
});
