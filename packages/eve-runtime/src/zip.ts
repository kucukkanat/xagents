import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import { type AppError, type Result, appError, err, ok } from "@xagents/core";

/**
 * A minimal, dependency-free ZIP writer (APPNOTE 6.3.3, DEFLATE method) so we
 * can hand back an agent's materialized eve project as a single download.
 * Node's `node:zlib` supplies both the compressor and CRC-32, so no third-party
 * archiver is needed. Timestamps are fixed to the DOS epoch to keep archives
 * deterministic (byte-identical for identical input).
 */

interface ZipEntry {
  /** Forward-slash relative path, as stored in the archive. */
  readonly name: string;
  readonly data: Buffer;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const VERSION = 20; // 2.0 — the minimum that supports DEFLATE
const METHOD_DEFLATE = 8;
const DOS_TIME = 0;
const DOS_DATE = 33; // 1980-01-01, the earliest representable DOS date

/** Recursively collect every file under `root` as an archive entry. */
const collectFiles = async (root: string, dir: string = root): Promise<ZipEntry[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: ZipEntry[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, full)));
    } else if (entry.isFile()) {
      files.push({
        name: relative(root, full).split(sep).join("/"),
        data: await readFile(full),
      });
    }
  }
  return files;
};

const buildZip = (files: readonly ZipEntry[]): Buffer => {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(file.data) >>> 0;
    const compressed = deflateRawSync(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(0, 6); // general-purpose flags
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra-field length
    parts.push(local, name, compressed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(CENTRAL_SIG, 0);
    cd.writeUInt16LE(VERSION, 4); // version made by
    cd.writeUInt16LE(VERSION, 6); // version needed
    cd.writeUInt16LE(0, 8); // general-purpose flags
    cd.writeUInt16LE(METHOD_DEFLATE, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(file.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30); // extra-field length
    cd.writeUInt16LE(0, 32); // comment length
    cd.writeUInt16LE(0, 34); // disk number
    cd.writeUInt16LE(0, 36); // internal attributes
    cd.writeUInt32LE(0, 38); // external attributes
    cd.writeUInt32LE(offset, 42); // local-header offset
    central.push(cd, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // this disk number
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(files.length, 8); // entries on this disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16); // central-directory offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...parts, centralBuf, eocd]);
};

/** Zip a directory tree into a single ZIP archive buffer. */
export const zipDirectory = async (dir: string): Promise<Buffer> => buildZip(await collectFiles(dir));

// --- Reading -----------------------------------------------------------------

const METHOD_STORE = 0;
/** Hard caps so a malicious/broken archive can't exhaust memory on import. */
const MAX_ENTRIES = 5_000;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

/** Reject entry names that would escape a target dir if ever written out. */
const isUnsafeEntryName = (name: string): boolean =>
  name.length === 0 ||
  name.startsWith("/") ||
  name.includes("\\") ||
  name.split("/").some((seg) => seg === "..");

/** Scan backwards for the End-Of-Central-Directory signature (past any comment). */
const findEocd = (zip: Buffer): number => {
  const min = Math.max(0, zip.length - (22 + 0xffff));
  for (let i = zip.length - 22; i >= min; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
};

/**
 * Parse a ZIP archive into an in-memory `path -> bytes` map. Reads the central
 * directory (authoritative sizes/offsets), so it tolerates archives written by
 * any tool — including data-descriptor and STORE/DEFLATE mixes. Never writes to
 * disk, so a hostile path can't traverse; unsafe names are still rejected up
 * front. Zip64 is unsupported (agents are tiny) and reported as an error.
 */
export const unzipBuffer = (zip: Buffer): Result<Map<string, Buffer>, AppError> => {
  try {
    if (zip.length < 22) return err(appError("validation", "not a zip archive (too small)"));
    const eocd = findEocd(zip);
    if (eocd < 0) return err(appError("validation", "not a zip archive (no end-of-central-directory)"));

    const count = zip.readUInt16LE(eocd + 10);
    if (count > MAX_ENTRIES) return err(appError("validation", `zip has too many entries (${count})`));
    let ptr = zip.readUInt32LE(eocd + 16);
    if (ptr === 0xffffffff) return err(appError("validation", "zip64 archives are not supported"));

    const files = new Map<string, Buffer>();
    let totalBytes = 0;

    for (let i = 0; i < count; i++) {
      if (ptr + 46 > zip.length || zip.readUInt32LE(ptr) !== CENTRAL_SIG) {
        return err(appError("validation", "corrupt zip: bad central directory record"));
      }
      const method = zip.readUInt16LE(ptr + 10);
      const crc = zip.readUInt32LE(ptr + 16);
      const compSize = zip.readUInt32LE(ptr + 20);
      const uncompSize = zip.readUInt32LE(ptr + 24);
      const nameLen = zip.readUInt16LE(ptr + 28);
      const extraLen = zip.readUInt16LE(ptr + 30);
      const commentLen = zip.readUInt16LE(ptr + 32);
      const localOffset = zip.readUInt32LE(ptr + 42);
      const name = zip.toString("utf8", ptr + 46, ptr + 46 + nameLen);

      if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
        return err(appError("validation", "zip64 archives are not supported"));
      }
      totalBytes += uncompSize;
      if (totalBytes > MAX_TOTAL_BYTES) {
        return err(appError("validation", "zip exceeds the maximum uncompressed size"));
      }

      // Skip directory entries (trailing slash) — we reconstruct dirs from paths.
      if (!name.endsWith("/")) {
        if (isUnsafeEntryName(name)) {
          return err(appError("validation", `unsafe path in zip: ${JSON.stringify(name)}`));
        }
        // Local header's name/extra lengths locate the data; central sizes are trusted.
        const localNameLen = zip.readUInt16LE(localOffset + 26);
        const localExtraLen = zip.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const raw = zip.subarray(dataStart, dataStart + compSize);
        const data =
          method === METHOD_STORE
            ? Buffer.from(raw)
            : method === METHOD_DEFLATE
              ? inflateRawSync(raw)
              : null;
        if (data === null) {
          return err(appError("validation", `unsupported compression method ${method} for ${name}`));
        }
        if ((crc32(data) >>> 0) !== crc) {
          return err(appError("validation", `checksum mismatch for ${name} (archive is corrupt)`));
        }
        files.set(name, data);
      }
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return ok(files);
  } catch (cause) {
    return err(appError("validation", "failed to read zip archive", cause));
  }
};
