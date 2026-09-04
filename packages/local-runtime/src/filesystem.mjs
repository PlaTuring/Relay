import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";

async function livePathSafety(filePath) {
  const parsed = path.win32.parse(filePath);
  const segments = filePath.slice(parsed.root.length).split("\\").filter(Boolean);
  let current = parsed.root;
  for (const segment of segments) {
    current = path.win32.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) return "reparse_forbidden";
    } catch {
      return "unavailable";
    }
  }
  return "safe";
}

export function createLiveFileAdapter() {
  return Object.freeze({
    pathSafety: livePathSafety,

    async inspect(filePath) {
      try {
        const stats = await lstat(filePath, { bigint: true });
        if (stats.isSymbolicLink()) return Object.freeze({ kind: "reparse", byte_length: null, modified_ns: null });
        if (stats.isFile()) {
          const size = Number(stats.size);
          return Object.freeze({
            kind: Number.isSafeInteger(size) ? "file" : "invalid",
            byte_length: Number.isSafeInteger(size) ? size : null,
            modified_ns: stats.mtimeNs.toString()
          });
        }
        if (stats.isDirectory()) return Object.freeze({ kind: "directory", byte_length: null, modified_ns: stats.mtimeNs.toString() });
        return Object.freeze({ kind: "other", byte_length: null, modified_ns: null });
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") return Object.freeze({ kind: "missing", byte_length: null, modified_ns: null });
        return Object.freeze({ kind: "unavailable", byte_length: null, modified_ns: null });
      }
    },

    async sha256(filePath, expectedByteLength) {
      const before = await this.inspect(filePath);
      if (before.kind !== "file" || before.byte_length !== expectedByteLength) {
        return Object.freeze({ status: "identity_changed", artifact_sha256: null });
      }
      const hash = createHash("sha256");
      let readBytes = 0;
      try {
        for await (const chunk of createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 })) {
          readBytes += chunk.byteLength;
          if (!Number.isSafeInteger(readBytes) || readBytes > expectedByteLength) {
            return Object.freeze({ status: "length_overflow", artifact_sha256: null });
          }
          hash.update(chunk);
        }
      } catch {
        return Object.freeze({ status: "read_failed", artifact_sha256: null });
      }
      const after = await this.inspect(filePath);
      if (
        readBytes !== expectedByteLength ||
        after.kind !== "file" ||
        after.byte_length !== before.byte_length ||
        after.modified_ns !== before.modified_ns
      ) {
        return Object.freeze({ status: "identity_changed", artifact_sha256: null });
      }
      return Object.freeze({ status: "complete", artifact_sha256: `sha256:${hash.digest("hex")}` });
    }
  });
}

export function createFixtureFileAdapter(entries) {
  const normalized = new Map([...entries].map(([key, value]) => [key.toUpperCase(), structuredClone(value)]));
  return Object.freeze({
    async pathSafety(filePath) {
      const upper = filePath.toUpperCase();
      for (const [candidate, value] of normalized) {
        if ((upper === candidate || upper.startsWith(`${candidate}\\`)) && value.kind === "reparse") return "reparse_forbidden";
      }
      return "safe";
    },
    async inspect(filePath) {
      const value = normalized.get(filePath.toUpperCase());
      return Object.freeze(value ? structuredClone(value) : { kind: "missing", byte_length: null, modified_ns: null });
    },
    async sha256(filePath, expectedByteLength) {
      const value = normalized.get(filePath.toUpperCase());
      if (!value || value.kind !== "file" || value.byte_length !== expectedByteLength || typeof value.artifact_sha256 !== "string") {
        return Object.freeze({ status: "identity_changed", artifact_sha256: null });
      }
      return Object.freeze({ status: "complete", artifact_sha256: value.artifact_sha256 });
    }
  });
}
