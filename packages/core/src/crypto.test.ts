import { describe, expect, test } from "bun:test";
import {
  generateMasterKey,
  openSecret,
  parseMasterKey,
  sealSecret,
  secretHint,
} from "./crypto";

const key = (): Buffer => {
  const k = parseMasterKey(generateMasterKey());
  if (k === null) throw new Error("generated key must parse");
  return k;
};

describe("parseMasterKey", () => {
  test("uses a valid 32-byte base64 key verbatim", () => {
    const b64 = generateMasterKey();
    const key = parseMasterKey(b64);
    expect(key).not.toBeNull();
    expect(key?.equals(Buffer.from(b64, "base64"))).toBe(true);
  });

  test("returns null only for unset / blank values", () => {
    expect(parseMasterKey(undefined)).toBeNull();
    expect(parseMasterKey("")).toBeNull();
    expect(parseMasterKey("   ")).toBeNull();
  });

  test("derives a 32-byte key from an arbitrary passphrase", () => {
    const key = parseMasterKey("my-passphrase");
    expect(key?.length).toBe(32);
    // Deterministic: the same passphrase always yields the same key.
    expect(parseMasterKey("my-passphrase")?.equals(key as Buffer)).toBe(true);
    expect(parseMasterKey("different")?.equals(key as Buffer)).toBe(false);
  });
});

describe("seal/open round-trip", () => {
  test("open recovers the exact plaintext", () => {
    const k = key();
    const sealed = sealSecret("sk-super-secret-123", k);
    const opened = openSecret(sealed, k);
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.value).toBe("sk-super-secret-123");
  });

  test("uses a fresh IV each time (ciphertext differs for same input)", () => {
    const k = key();
    expect(sealSecret("same", k).data).not.toBe(sealSecret("same", k).data);
  });

  test("open fails under a different key (authentication)", () => {
    const sealed = sealSecret("secret", key());
    expect(openSecret(sealed, key()).ok).toBe(false);
  });

  test("open fails when the ciphertext is tampered with", () => {
    const k = key();
    const sealed = sealSecret("secret", k);
    const tampered = { ...sealed, data: Buffer.from("evil").toString("base64") };
    expect(openSecret(tampered, k).ok).toBe(false);
  });
});

describe("secretHint", () => {
  test("returns the last 4 chars for a long secret", () => {
    expect(secretHint("sk-abcd1234")).toBe("1234");
  });
  test("masks fully for short secrets", () => {
    expect(secretHint("1234")).toBe("");
    expect(secretHint("ab")).toBe("");
  });
});
