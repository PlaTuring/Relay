import { sha256Text } from "./hash.ts";
import { assertNoSecrets, assertSafeText } from "./safe-text.ts";
import type { CommandSuccess } from "./types.ts";

export function validateExecutorOutput(
  value: unknown,
  maximumBytes: number
): value is CommandSuccess {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Partial<CommandSuccess>;
  if (result.ok !== true || typeof result.stdout !== "string" || typeof result.stderr !== "string") {
    return false;
  }
  const stdoutBytes = Buffer.byteLength(result.stdout, "utf8");
  const stderrBytes = Buffer.byteLength(result.stderr, "utf8");
  if (stdoutBytes + stderrBytes > maximumBytes) return false;
  try {
    assertSafeText(result.stdout, maximumBytes);
    assertSafeText(result.stderr, maximumBytes);
    assertNoSecrets(result.stdout);
    assertNoSecrets(result.stderr);
  } catch {
    return false;
  }
  return result.stdoutSha256 === sha256Text(result.stdout) && result.stderrSha256 === sha256Text(result.stderr);
}
