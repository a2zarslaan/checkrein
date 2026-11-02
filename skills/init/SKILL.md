---
name: init
description: Install checkrein into a repository. Copies the hub (AGENTS.md), the project-documentation and reference-documentation templates, the manifest (checkrein.json) and the check script into the repository root without overwriting any existing file, infers the manifest values it can, asks the operator for the rest in one message, writes the manifest, and runs the check. Run it once per repository, from the repository root, in a repository that does not yet have checkrein.json. Every other checkrein skill stops and points here when the manifest is missing. Trigger phrases include "set up checkrein", "install checkrein in this repo", "init checkrein", "initialize checkrein" and "add checkrein to this project". Do not run it when checkrein.json already exists; the operator edits the manifest by hand from then on.
---

# init

## Purpose

Put the checkrein records and the manifest into the operator's repository so every other skill has something to read. The install is additive: an existing file always wins, and the operator reviews the result as an ordinary diff before committing it.

## Names used in this skill

- `<repo>` is the operator's repository root (the current directory, confirmed in step 2).
- `<plugin>` is the checkrein folder resolved in step 1, and `<templates>` is `<plugin>/templates`.
- **Copy without overwriting** means: for every file under the source, check whether the destination file exists. If it does, leave it untouched and record **kept**. If it does not, create it with the source bytes, creating folders as needed, and record **created**. Copy the bytes; never retype a template, so nothing drifts from the source.

Keep a running action log of every destination file and its action (created, kept or appended). Step 8 prints it.

## Steps

Run the steps in order. Each step is one action. Report the result of each step before starting the next.

### Step 1: Locate the templates

Resolve `<plugin>`:

- **Claude Code:** the plugin root is the value of the variable below, so the templates are in its `templates` folder.

  ```
  ${CLAUDE_PLUGIN_ROOT}
  ```

- **Any other harness:** this file is `<plugin>/skills/init/SKILL.md`, so `<plugin>` is the folder two levels above the folder that holds this file (up from `init`, then up from `skills`).

Confirm that `<templates>/AGENTS.md`, `<templates>/CLAUDE.md`, `<templates>/checkrein.json`, `<templates>/project-documentation/`, `<templates>/reference-documentation/` and `<plugin>/scripts/checkrein-check.mjs` all exist. If any is missing, stop and ask the operator for the path to the checkrein folder.

Print one line: `Templates resolved at: <absolute path> (through <the variable or the relative fallback>)`.

### Step 2: Confirm the repository root and that init has not run

Confirm that the current directory is the repository root: `<repo>/.git` exists (a folder, or a file in a linked worktree) and `git rev-parse --show-toplevel` prints the current folder. If it is not the root, stop and tell the operator to start the session from the repository root.

Confirm that `<repo>/checkrein.json` does not exist. If it exists, stop and say: "init already ran in this repository (the manifest exists). Edit the manifest by hand and run the check script; init does not run twice."

### Step 3: Copy the templates without overwriting

Copy each source to its destination with the copy-without-overwriting rule:

| Source | Destination | Notes |
|---|---|---|
| `<templates>/project-documentation/` | `<repo>/project-documentation/` | The whole tree, file by file. |
| `<templates>/reference-documentation/` | `<repo>/reference-documentation/` | The whole tree, file by file. |
| `<templates>/AGENTS.md` | `<repo>/AGENTS.md` | If the destination exists, follow 3a. |
| `<templates>/checkrein.json` | `<repo>/checkrein.json` | Step 6 fills in the values. |
| `<plugin>/scripts/checkrein-check.mjs` | `<repo>/checkrein-check.mjs` | The check script, at the repository root. |
| `<templates>/CLAUDE.md` | `<repo>/CLAUDE.md` | Only when the destination is missing; otherwise follow 3b. |

**3a. The repository already has a hub file.** Do not overwrite `<repo>/AGENTS.md`. Copy `<templates>/AGENTS.md` to `<repo>/AGENTS.checkrein.md` instead (kept if that file also exists). Then, unless `<repo>/AGENTS.md` already names AGENTS.checkrein.md, append this section to the end of `<repo>/AGENTS.md` and record **appended**:

```
## checkrein

This repository uses checkrein. Its hub is AGENTS.checkrein.md: read it before any work. It names where each kind of knowledge lives and which protocol to run when. The operator merges it into this file.
```

Tell the operator to merge the two files into one hub and to remove AGENTS.checkrein.md once merged.

**3b. The repository already has a CLAUDE.md.** Read `<repo>/CLAUDE.md` and look for a line that imports the hub: a line containing @AGENTS.md that is not inside backticks or a code block. If one exists, record **kept**. If none exists, append one blank line and then a line holding only @AGENTS.md, and record **appended**. Change nothing else in the file.

### Step 4: Infer the manifest values

Read only manifest and configuration files. Never read a file that matches the template's secret globs (.env and .env.* by default), even to infer a value.

| Key | Where to look | Fallback |
|---|---|---|
| project.name | The name field of the root package manifest. | The repository folder name. |
| project.description | The description field of the root package manifest. | Empty; ask in step 5. |
| project.tracker | Keep "github" when the origin remote is on GitHub. | Flag it in step 5 for the operator to confirm. |
| vcs.trunk | The remote's default branch: the branch the origin remote's HEAD points to (git symbolic-ref on that ref), without the remote prefix. | The local init.defaultBranch setting, then the current branch. |
| commands.lint, commands.typecheck, commands.test, commands.build, commands.format_check | The root package manifest's scripts, or the ecosystem equivalent below. | Empty. |

Rules for commands:

- Fill a command only when the repository already defines it (a script, a task runner target) or configures the tool it runs. Never invent one. An empty command is skipped by preflight-check and reported as "not configured".
- Write the command exactly as a developer would type it at the repository root, using the runner the repository's lockfile or task file implies.
- Ecosystem equivalents: a JavaScript package manifest's scripts (lint, typecheck or type-check, test, build, and a format check such as format:check); a task runner file's targets (Makefile, justfile, Taskfile); the configured linters, type checkers and test runners of a Python project; the toolchain's own commands for a Rust or Go project (clippy, check, test, build, and fmt in check mode; vet, build, test, and a gofmt listing that fails when non-empty).

Also collect workspace candidates from the repository's workspace declarations (a workspaces field, a workspace configuration file, a Cargo workspace members list, a go.work file). Propose them in step 5; do not decide them.

Show the operator a table: key, inferred value, and where it came from.

### Step 5: Ask the operator for the rest

Send one message that asks for every value that cannot be inferred, then wait for the answer. Do not continue on an assumed answer.

Ask for:

1. **Workspaces:** the independently buildable parts of the repository, each as a name and a repository-relative root. Show the candidates from step 4. A single-package project keeps the default (app at the root).
2. **Areas:** the vocabulary for issue, PR and branch names (for example auth, billing, search, settings). An empty list is allowed.
3. **Domains to add or remove:** the default corrections-log domains are backend, frontend, database, auth, shared, infra and process. Ask which to add and which to remove. process always stays.
4. **Protected trees:** folders an agent must never read as guidance, such as an archive of retired code or a frozen snapshot. An empty list is allowed.
5. **Release branch:** the branch trunk is promoted to, if the project has one. Empty means none.
6. **Description (when not inferred):** one sentence for project.description, asked only when step 4 found none.
7. **Tracker (when the origin remote is not on GitHub):** the issue tracker for project.tracker, asked only when step 4 flagged it.

Close the message by inviting the operator to correct any value from step 4 in the same reply.

### Step 6: Write the manifest

Edit `<repo>/checkrein.json`, the copy init created in step 3, with the final values. This is the only write to a file init did not just copy or append to, and the file did not exist before step 3.

- Keep every key from the template, in the template's order. Add no key and remove no key.
- Keep each value's type: strings stay strings, lists stay lists, confidence_floor stays a number.
- domains is the default list minus the operator's removals plus the operator's additions: lowercase, no duplicates, process always present.
- areas are lowercase words or hyphenated words.
- Folder values end with a slash. Each workspace has a name and a root; "." means the repository root.
- Leave review.confidence_floor at 75 unless the operator gave a number from 0 to 100.
- Write valid JSON with a two-space indent and no comments, then parse the file back to prove it is valid.

Show the final manifest. Every key is described in [manifest-fields.md](references/manifest-fields.md).

### Step 7: Run the check

Run this from the repository root and show the full output:

```
node checkrein-check.mjs
```

If Node 20 or newer is not available, say so, skip this step, and list the check under the next steps in step 8.

Handle what the check reports:

- **A missing path** that has a template counterpart (a manifest path, a file under the docs folder or the reference-documentation tree): create it from the template with the copy-without-overwriting rule, then run the check again. Repeat until no fixable path remains.
- **A missing path with no template counterpart:** report it and leave it to the operator.
- **Any other failure in a file that existed before init** (a heading, a working-doc name, an em dash): show it and change nothing. The operator decides.
- **Any failure in a file init created:** report it as a checkrein defect.

### Step 8: Print the summary

Print the action log as a table with the columns File and Action (created, kept, appended), one row per destination file. Group rows under a folder when every file under it has the same action.

Then print the next steps:

1. Review the diff and commit it yourself. init committed nothing.
2. If init wrote AGENTS.checkrein.md, merge it into the existing hub and remove it.
3. Read the hub (AGENTS.md). It is the map every skill follows.
4. Fill in the document templates. Each one carries filler guidance that says what belongs in it; replace the guidance with the project's own content, starting with the project brief. Keep the reference-documentation tree and its index files; vendor library and pattern docs there as the template's guidance describes.
5. Add any further secret globs or protected trees to the manifest by hand.
6. Run the docs skill before writing any code.
7. Send the first pull request through preflight-check.

## What init never does

- **Never deletes or overwrites a file.** An existing file is kept as it is. The only changes to files that existed before init are the two appends in step 3 (the hub section and the CLAUDE.md import line).
- **Never edits code.** It reads manifests and configuration files to infer values and changes no source, test, build or configuration file.
- **Never commits.** It stages nothing, commits nothing, pushes nothing and creates no branch. The operator reviews the diff and commits.
- **Never reads a file that matches the secret globs,** for any reason.
- **Never runs twice.** When the manifest exists it stops at step 2.
- **Never runs the project's own commands.** It writes them into the manifest; preflight-check runs them.

## Claude Code note

This section applies only in Claude Code; the steps above are the same in every harness.

- The plugin root is `${CLAUDE_PLUGIN_ROOT}` and this skill's folder is `${CLAUDE_SKILL_DIR}`, so the fallback in step 1 is the folder two levels above `${CLAUDE_SKILL_DIR}`.
- Use Bash for the existence checks and the byte-for-byte copies, Read for the manifests in step 4, Edit for the appends in step 3, and Write or Edit for the manifest in step 6.
- In step 5, ask in one message and end the turn; resume at step 6 when the operator answers.
- Claude Code reads the hub through the @AGENTS.md import in CLAUDE.md. Without a CLAUDE.md anywhere above the folder, it reads AGENTS.md directly.
