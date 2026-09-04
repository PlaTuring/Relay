export function isLocalDrivePath(value: unknown, executable: boolean): value is string {
  if (typeof value !== "string" || value.length < 4 || value.length > 32_767 || value.includes("\0")) {
    return false;
  }
  if (!/^[A-Za-z]:\\/u.test(value) || /^[A-Za-z]:\\[?.]\\/u.test(value)) return false;
  if (/^(?:\\\\|file:|[A-Za-z]:\/)/iu.test(value)) return false;
  if (value.slice(3).includes(":")) return false;
  const segments = value.slice(3).split("\\");
  if (segments.some((segment) => invalidWindowsSegment(segment))) return false;
  return !executable || /\.exe$/iu.test(value);
}

function invalidWindowsSegment(segment: string): boolean {
  if (
    segment === "" ||
    segment === "." ||
    segment === ".." ||
    /[<>:"/\\|?*\u0000-\u001f]/u.test(segment) ||
    /[. ]$/u.test(segment)
  ) {
    return true;
  }
  const basename = (segment.split(".")[0] ?? "").toUpperCase();
  return /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(basename);
}

export function isManagedRelativeExecutablePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 5 &&
    value.length <= 512 &&
    !value.includes("\\") &&
    !value.includes(":") &&
    !value.startsWith("/") &&
    !value.split("/").some((segment) => invalidWindowsSegment(segment)) &&
    /^[A-Za-z0-9_ .+/-]+\.exe$/u.test(value)
  );
}
