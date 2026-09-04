import { spawn } from "node:child_process";

export function installMissingPackage(requirement) {
  return spawn("pip", ["install", requirement]);
}
