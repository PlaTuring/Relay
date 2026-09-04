# MiniMax H3 Tool — Agent Operating Contract

## 1. Non-negotiable product boundary

This repository builds a **Windows installer/configurator and ComfyUI workflow compiler**. It detects hardware, discovers and reuses compatible local assets, installs missing runtime components, resolves a certified recipe, creates project/workflow files, and hands the workflow to ComfyUI.

**MiniMax H3, invoked inside ComfyUI after the user clicks Run, is the only component that generates video and native audio.**

No agent may add any of the following without an approved scope ADR:

- a video/audio generation model or replacement inference backend;
- a tool-side “Generate video” action or automatic submission of the user's first formal ComfyUI queue job;
- cloud/partner inference API nodes, hidden uploads, or runtime dependency downloads;
- prompt expansion, story writing, shot planning, content-type classification, music generation, or other creative-director behavior.

Installer/CI smoke tests may submit a fixed minimal local H3 test job only when the assigned task explicitly requires it. Test media are disposable technical evidence, not product output.

## 2. Agent hierarchy

### Root integration agent (`/root`)

The root agent is the sole scheduler and integration owner. It:

- owns the optimized execution plan, task graph, decision log, release gates, shared contracts, and resource locks;
- issues bounded context packets with task ID, dependencies, allowed paths, acceptance tests, and locks;
- reviews evidence, rejects scope drift, integrates compatible outputs, and unlocks dependent work;
- does not compete with workers for a business module during a parallel wave; root work is orchestration, contracts, review, and integration.

### Worker agents

Workers execute only the assigned atomic task. Before implementation, each worker must confirm:

> I only implement installation, detection, configuration, workflow compilation, deterministic orchestration, or technical verification. MiniMax H3 generates the actual video and audio inside ComfyUI.

Workers must:

1. read this file, the task context packet, and every directly referenced contract;
2. stay inside `allowed_paths`; request a contract change instead of editing root-owned files;
3. avoid broad refactors, unrelated cleanup, dependency upgrades, and speculative features;
4. leave user files, external models, existing ComfyUI instances, and unrelated worktree changes untouched;
5. report changed files, tests/evidence, contract impact, unresolved risks, and the exact next dependency unlocked.

Workers do not commit, merge, rebase, or edit a shared lockfile unless their task explicitly grants ownership.

## 3. File ownership

Root-owned files (workers read only unless explicitly assigned):

- `MINIMAX_H3_TOOL_EXECUTION_PLAN.md`
- `README.md`
- `AGENTS.md`
- `docs/MASTER_ORCHESTRATION.md`
- `docs/DECISION_LOG.md`
- `docs/RISK_REGISTER.md`
- `tasks/registry.json`
- repository-level package/build lockfiles

Shared contracts under `schemas/` have one named Contract Owner per wave. Other workers submit a proposed patch or change note under their own allowed path; they do not directly change a shared schema.

Each review or spike has a unique output path. Two active workers may not edit the same file or directory subtree.

## 4. Resource locks

The task registry may grant at most one holder for each lock:

- `GPU-H3`: local H3 load or generation test;
- `COMFY-DESKTOP`: Desktop install, launch, UI automation, or private-state inspection;
- `WIN-VM`: destructive installer/update/uninstall VM test;
- `MODEL-DOWNLOAD`: large model download, materialization, or full-file hashing;
- `SCHEMA`: shared contract change;
- `ROOT-LOCKFILE`: repository package/build lockfile mutation.

Code, document, and fixture tasks can run concurrently. GPU, Desktop, VM, and large model I/O are serialized regardless of agent count. A worker must not acquire an unlisted resource opportunistically.

## 5. Truth and capability rules

- A capability is `proven` only when an immutable upstream revision or an accepted PoC provides repeatable evidence.
- `inferred` and `experimental` capabilities are never shown as Stable defaults.
- Match Comfy nodes by locked `class_type` and schema fingerprint, never by display name. Partner/API and unknown nodes fail closed.
- A version lower bound such as “ComfyUI 0.30.0+” is not a capability check. Recipes pin the backend, frontend, templates, nodes, runtime, models, and hashes.
- Existing models progress through `found → identified → verified → compatible → approved → selected`. Detection alone never authorizes reuse.
- Existing ComfyUI/Desktop/Portable environments are attach-only by default. Static discovery must not import or execute unknown custom-node Python.

## 6. Safety and reproducibility

- Managed large files default to a visible `D:\MiniMaxH3` root when D is a supported local NTFS volume; the user may change it. Never silently fall back to C for models, runtime, caches, temp media, or output.
- Never move, overwrite, or delete an external model. Uninstall removes only ledger entries marked as tool-managed, after containment/reparse-point checks.
- Build Python environments in their final immutable generation directory; activate by replacing a small pointer. Do not move a populated venv from staging.
- Stable runtime is local and pinned: loopback only, API nodes disabled, unknown custom nodes disabled, Manager/runtime downloads disabled, no `latest` references.
- Use parameter arrays for child processes. Do not assemble shell command strings from user data.
- Secrets, full prompts, local usernames, tokens, and absolute private paths must not enter ordinary logs or support bundles.

## 7. Task completion format

Every worker completion must provide:

1. scope confirmation and task ID;
2. files created/changed;
3. acceptance commands and results;
4. evidence paths and whether each conclusion is proven, inferred, or blocked;
5. schema/API/lockfile impact;
6. open risks and human/external dependencies;
7. next tasks that are now ready.

A report is not “done” merely because prose or code exists. The task's acceptance evidence must be present, or its status remains blocked/partial.
