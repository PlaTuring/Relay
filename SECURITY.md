# Security policy

## Supported versions

Security fixes are targeted at the current `1.0.x` line. Older builds may no
longer receive fixes. Check the version shown in Relay against the most recent
GitHub Release before reporting a problem.

## Reporting a vulnerability

Use GitHub's private vulnerability-reporting or Security Advisory flow for
this repository. Do not open a public issue for an unpatched vulnerability.
Include the affected Relay version, Windows version and architecture, a short
reproduction, and the stable diagnostic code when available.

Do not include credentials, access tokens, complete prompts, private project
files, generated media, usernames, or private absolute paths. Redact logs to
the minimum evidence needed to reproduce the issue.

## Security boundaries

Relay prepares local components and compiles editable workflows. It does not
submit ComfyUI queues or generate media. Reports about MiniMax H3, ComfyUI,
FFmpeg, Electron, Windows, or another third-party component may need to be
reported to that upstream project as well.

Downloaded release installers are accepted only through the product's bounded
Stable Release contract. A SHA-256 digest detects changed bytes; it does not
authenticate a publisher and does not replace Authenticode.
