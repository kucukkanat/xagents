import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { type AppError, type Result, appError, err, ok } from "./result";

/**
 * Symmetric secret sealing for provider API keys. Keys live in the SQLite file,
 * so we encrypt them at rest with AES-256-GCM under a master key the server
 * loads from `SECRETS_KEY` (never persisted, never sent to the client, never
 * seen by the DB layer). GCM gives us authenticated encryption: a wrong key or
 * a tampered blob fails `open` loudly instead of returning garbage.
 */

const ALG = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce length

/** A sealed secret. Self-describing (versioned, all base64) so it round-trips
 *  through JSON in a single DB column with no external schema. */
export const SealedSecretSchema = z.object({
  v: z.literal(1),
  iv: z.string().min(1),
  tag: z.string().min(1),
  data: z.string(),
});
export type SealedSecret = z.infer<typeof SealedSecretSchema>;

/**
 * Resolve `SECRETS_KEY` into a 32-byte master key, or `null` when it is unset or
 * blank (`null` => "encryption not configured": keys go read-only and
 * key-dependent turns fail with a clear message, never a silent plaintext
 * fallback). A value that is already a base64-encoded 32-byte key is used as-is;
 * any other non-empty value is treated as a passphrase and stretched to 32 bytes
 * via SHA-256, so an arbitrary `SECRETS_KEY` just works. For production, prefer a
 * random key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
 */
export const parseMasterKey = (raw: string | undefined): Buffer | null => {
  const value = raw?.trim();
  if (value === undefined || value.length === 0) return null;
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === KEY_BYTES) return decoded;
  return createHash("sha256").update(value, "utf8").digest();
};

/** A fresh base64 master key, for documenting `SECRETS_KEY` generation. */
export const generateMasterKey = (): string => randomBytes(KEY_BYTES).toString("base64");

/** Seal `plaintext` under `key`. Throws only on a programmer error (bad key size). */
export const sealSecret = (plaintext: string, key: Buffer): SealedSecret => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
};

/**
 * Open a sealed secret. Authentication failure (wrong master key or tampered
 * ciphertext) is an expected, recoverable condition, so it is modeled as an
 * `Err` rather than a throw — the server surfaces it as a turn/test error.
 */
export const openSecret = (sealed: SealedSecret, key: Buffer): Result<string, AppError> => {
  try {
    const decipher = createDecipheriv(ALG, key, Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    const out = Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]);
    return ok(out.toString("utf8"));
  } catch (cause) {
    return err(appError("internal", "failed to decrypt secret (wrong SECRETS_KEY or corrupted value)", cause));
  }
};

/** Last 4 chars of a secret, for a masked "••••1234" hint. Short secrets mask fully. */
export const secretHint = (plaintext: string): string =>
  plaintext.length <= 4 ? "" : plaintext.slice(-4);
