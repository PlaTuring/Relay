export function formalVersionNumber(appVersion: string): string {
  const normalized = appVersion.trim();
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(normalized);
  return stable === null ? normalized : `${stable[1]}.${stable[2]}.${stable[3]}`;
}

export function formalVersionLabel(appVersion: string): string {
  const version = formalVersionNumber(appVersion);
  return version.length > 0 ? `版本 ${version}` : "版本 —";
}
