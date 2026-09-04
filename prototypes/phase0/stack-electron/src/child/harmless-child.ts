function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const token = readArgument("--token");
const label = readArgument("--label");

if (!token || !label || token !== process.env.MINIMAX_H3_SPIKE_CHILD_TOKEN) {
  process.stderr.write("Invalid owned-child identity.\n");
  process.exit(2);
}

process.stdout.write(
  `${JSON.stringify({ event: "ready", token, label, pid: process.pid })}\n`
);

const keepAlive = setInterval(() => {
  // The direct child intentionally remains idle until its owner terminates it.
}, 1_000);

function finish(): void {
  clearInterval(keepAlive);
  process.exit(0);
}

process.once("SIGINT", finish);
process.once("SIGTERM", finish);
