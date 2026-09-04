const ansiPattern = /[\u001b\u009b]/u;
const forbiddenControlPattern = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;

const secretPatterns: readonly RegExp[] = Object.freeze([
  /\b(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]\s*[^\s,;]+/giu,
  /\b(bearer)\s+[a-z0-9._~+/=-]+/giu,
  /([?&](?:token|key|secret|signature)=)[^&\s]+/giu
]);

const privatePathPatterns: readonly RegExp[] = Object.freeze([
  /file:\/\/{2,3}[a-z]:[\\/](?:"[^"]*"|'[^']*'|[^\s,;]*)/giu,
  /\\\\[?.]\\(?:"[^"]*"|'[^']*'|[^\r\n,;]*)/gu,
  /[a-z]:[\\/](?:"[^"]*"|'[^']*'|[^\s,;]*)/giu,
  /\\\\[^\r\n,;]+/gu,
  /(^|[\s=])\/(?!\/)(?:"[^"]*"|'[^']*'|[^\s,;]*)/gu
]);

export function assertSafeText(value: string, maxLength: number): void {
  if (value.length > maxLength || ansiPattern.test(value) || forbiddenControlPattern.test(value)) {
    throw new Error("MEDIA.OUTPUT_UNSAFE_TEXT");
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("MEDIA.OUTPUT_UNSAFE_TEXT");
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error("MEDIA.OUTPUT_UNSAFE_TEXT");
    }
  }
}

export function redactText(value: string, maxLength = 16_384): string {
  assertSafeText(value, maxLength);
  let redacted = value.replace(/\r\n?/gu, "\n");
  for (const pattern of secretPatterns) {
    redacted = redacted.replace(pattern, (_match, prefix: string | undefined) =>
      prefix?.startsWith("?") || prefix?.startsWith("&") ? `${prefix}<redacted>` : "<redacted-secret>"
    );
  }
  for (const pattern of privatePathPatterns) {
    redacted = redacted.replace(pattern, (match, prefix: string | undefined) =>
      prefix === " " || prefix === "\t" || prefix === "="
        ? `${prefix}<private-path>`
        : "<private-path>"
    );
  }
  return redacted;
}

export function assertSafeIdentifier(value: unknown, maximum = 128): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    !/^[A-Za-z0-9][A-Za-z0-9_.+:-]*$/u.test(value)
  ) {
    throw new Error("MEDIA.OUTPUT_INVALID");
  }
}

export function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function assertNoSecrets(value: string): void {
  const secret = /\b(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]/iu;
  if (secret.test(value)) {
    throw new Error("MEDIA.OUTPUT_UNSAFE_TEXT");
  }
}

export function assertNoPrivatePaths(value: string): void {
  const privatePath = /(?:file:\/\/{2,3}[A-Za-z]:[\\/]|\\\\[?.]\\|\\\\[^\\\s]+\\|[A-Za-z]:[\\/]|\/(?:home|users|private|tmp|var\/tmp)\/)/iu;
  if (privatePath.test(value)) throw new Error("MEDIA.OUTPUT_UNSAFE_TEXT");
}
