---
name: "init"
description: "Install checkrein into a repository. Copies the hub (AGENTS.md), the document templates, the manifest (checkrein.json, version 2), the check script, the diff check, the git hooks and the CI workflow into the repository root without overwriting any file, infers the manifest values it can, asks the operator for the rest (production markers, example files, approvals and code globs among them) in one message, writes the manifest and the .ignore file, prints the git config line for the hooks, and runs the check. Run it once, from the repository root, in a repository without checkrein.json. Every other checkrein skill points here when the manifest is missing. Trigger phrases include 'set up checkrein', 'install checkrein in this repo', 'init checkrein', 'initialize checkrein' and 'add checkrein to this project'. When checkrein.json already exists, do not run it: a version 1 manifest moves to version 2 through the upgrade skill, and otherwise the operator edits the manifest by hand."
---

# init

## Purpose

Put the checkrein records, the manifest and the enforcement fallbacks into the operator's repository so every other skill has something to read. The install is additive: an existing file always wins, and the operator reviews the result as an ordinary diff before committing it.

init writes a version 2 manifest. In Claude Code, with the checkrein plugin installed, version 2 switches on the guards; in any harness, the git hooks and the CI workflow it copies catch what reaches a commit. Every guard is a guardrail for a cooperative agent, not a security boundary; step 10 prints what that means.

## Names used in this skill

- `<repo>` is the operator's repository root (the current directory, confirmed in step 2).
- `<plugin>` is the checkrein folder resolved in step 1, and `<templates>` is `<plugin>/templates`.
- **Copy without overwriting** means: for every file under the source, check whether the destination file exists. If it does, leave it untouched and record **kept**. If it does not, create it with the source bytes, creating folders as needed, keep the source's executable bit, and record **created**. Copy the bytes; never retype a template, so nothing drifts from the source.

Keep a running action log of every destination file and its action (created, kept or appended). Step 10 prints it.

## Steps

Run the steps in order. Each step is one action. Report the result of each step before starting the next.

### Step 1: Locate the templates

Resolve `<plugin>`:

- **Claude Code:** the plugin root is the value of the variable below, so the templates are in its `templates` folder.

  ```
  ${CLAUDE_PLUGIN_ROOT}
  ```

- **Any other harness:** this file is `<plugin>/skills/init/SKILL.md`, so `<plugin>` is the folder two levels above the folder that holds this file (up from `init`, then up from `skills`).

Confirm that all of these exist: `<templates>/AGENTS.md`, `<templates>/CLAUDE.md`, `<templates>/checkrein.json`, `<templates>/project-documentation/`, `<templates>/reference-documentation/`, `<templates>/.githooks/pre-commit`, `<templates>/.githooks/pre-push`, `<templates>/.github/workflows/checkrein.yml`, `<plugin>/scripts/checkrein-check.mjs` and `<plugin>/guards/diff-check.mjs`. If any is missing, stop and ask the operator for the path to the checkrein folder.

Print one line: `Templates resolved at: <absolute path> (through <the variable or the relative fallback>)`.

### Step 2: Confirm the repository root and that init has not run

Confirm that the current directory is the repository root: `<repo>/.git` exists (a folder, or a file in a linked worktree) and `git rev-parse --show-prefix` prints an empty line (comparing `git rev-parse --show-toplevel` with the current folder works only after resolving both to real paths, because a symlinked path prints differently). If it is not the root, stop and tell the operator to start the session from the repository root.

Confirm that `<repo>/checkrein.json` does not exist. If it exists, read its checkrein.manifest_version and stop:

- **Version 1:** say "init already ran in this repository (the manifest is version 1). Run the upgrade skill to move it to version 2 and install the enforcement files; init does not run twice."
- **Version 2 or higher, or unreadable:** say "init already ran in this repository (the manifest exists). Edit the manifest by hand and run the check script; init does not run twice."

### Step 3: Copy the templates without overwriting

Copy each source to its destination with the copy-without-overwriting rule:

| Source | Destination | Notes |
|---|---|---|
| `<templates>/project-documentation/` | `<repo>/project-documentation/` | The whole tree, file by file. |
| `<templates>/reference-documentation/` | `<repo>/reference-documentation/` | The whole tree, file by file. |
| `<templates>/AGENTS.md` | `<repo>/AGENTS.md` | If the destination exists, follow 3a. |
| `<templates>/checkrein.json` | `<repo>/checkrein.json` | Step 6 fills in the values. |
| `<plugin>/scripts/checkrein-check.mjs` | `<repo>/checkrein-check.mjs` | The adopter check, at the repository root. |
| `<plugin>/guards/diff-check.mjs` | `<repo>/checkrein-diff-check.mjs` | The diff check the git hooks and CI run, at the repository root. |
| `<templates>/.githooks/pre-commit` | `<repo>/.githooks/pre-commit` | Executable. If the destination exists, follow 3c. |
| `<templates>/.githooks/pre-push` | `<repo>/.githooks/pre-push` | Executable. If the destination exists, follow 3c. |
| `<templates>/.github/workflows/checkrein.yml` | `<repo>/.github/workflows/checkrein.yml` | Step 7 sets its trunk branch. |
| `<templates>/CLAUDE.md` | `<repo>/CLAUDE.md` | Only when the destination is missing; otherwise follow 3b. |

**3a. The repository already has a hub file.** Do not overwrite `<repo>/AGENTS.md`. Copy `<templates>/AGENTS.md` to `<repo>/AGENTS.checkrein.md` instead (kept if that file also exists). Then, unless `<repo>/AGENTS.md` already names AGENTS.checkrein.md, append this section to the end of `<repo>/AGENTS.md` and record **appended**:

```
## checkrein

This repository uses checkrein. Its hub is AGENTS.checkrein.md: read it before any work. It names where each kind of knowledge lives and which protocol to run when. The operator merges it into this file.
```

Tell the operator to merge the two files into one hub and to remove AGENTS.checkrein.md once merged.

**3b. The repository already has a CLAUDE.md.** Read `<repo>/CLAUDE.md` and look for a line that imports the hub: a line containing @AGENTS.md that is not inside backticks or a code block. If one exists, record **kept**. If none exists, append one blank line and then a line holding only @AGENTS.md, and record **appended**. Change nothing else in the file.

**3c. The repository already has a git hook of the same name.** Keep it. Tell the operator that the kept hook does not run the diff check, and give the line to add to it: `node checkrein-diff-check.mjs --staged` for pre-commit, or the loop in the template's pre-push for pre-push. Also run `git config --get core.hooksPath` and report its value: when it already names another folder, the operator calls the diff check from the hooks in that folder instead of switching folders.

### Step 4: Infer the manifest values

Read only manifest and configuration files. Never read a file that matches the template's secret globs (.env and .env.* by default), even to infer a value; listing file names is fine.

| Key | Where to look | Fallback |
|---|---|---|
| project.name | The name field of the root package manifest. | The repository folder name. |
| project.description | The description field of the root package manifest. | Empty; ask in step 5. |
| project.tracker | Keep "github" when the origin remote is on GitHub. | Flag it in step 5 for the operator to confirm. |
| vcs.trunk | The remote's default branch: the branch the origin remote's HEAD points to (git symbolic-ref on that ref), without the remote prefix. | The local init.defaultBranch setting, then the current branch. |
| commands.lint, commands.typecheck, commands.test, commands.build, commands.format_check | The root package manifest's scripts, or the ecosystem equivalent below. | Empty. |
| example_globs | File names (never contents) that look like secret templates: names ending in .example, .sample or .template, such as an example environment file. | The template default. |
| approval.dependency_commands | The lockfiles and package manager files present, for a package manager outside the built-in list (the common JavaScript, Python, Rust and Go managers are built in). Propose its add and remove prefixes, for example "uv add" and "uv remove" next to a uv lockfile, or "bundle add" and "bundle remove" next to a Gemfile lock. | Empty. |
| consulted.code_globs | The source folders of each workspace (src, lib, app, cmd, internal, or the folder a workspace's manifest names as its source). | The template default (src/** and **/src/**). |

Rules for commands:

- Fill a command only when the repository already defines it (a script, a task runner target) or configures the tool it runs. Never invent one. An empty command is skipped by preflight-check and reported as "not configured".
- Write the command exactly as a developer would type it at the repository root, using the runner the repository's lockfile or task file implies.
- Ecosystem equivalents: a JavaScript package manifest's scripts (lint, typecheck or type-check, test, build, and a format check such as format:check); a task runner file's targets (Makefile, justfile, Taskfile); the configured linters, type checkers and test runners of a Python project; the toolchain's own commands for a Rust or Go project (clippy, check, test, build, and fmt in check mode; vet, build, test, and a gofmt listing that fails when non-empty).

Also collect workspace candidates from the repository's workspace declarations (a workspaces field, a workspace configuration file, a Cargo workspace members list, a go.work file). Propose them in step 5; do not decide them.

Never infer production markers. They come only from the operator.

Show the operator a table: key, inferred value, and where it came from.

### Step 5: Ask the operator for the rest

Send one message that asks for every value that cannot be inferred, then wait for the answer. Do not continue on an assumed answer.

Ask for:

1. **Workspaces:** the independently buildable parts of the repository, each as a name and a repository-relative root. Show the candidates from step 4. A single-package project keeps the default (app at the root).
2. **Areas:** the vocabulary for issue, PR and branch names (for example auth, billing, search, settings). An empty list is allowed.
3. **Domains to add or remove:** the default corrections-log domains are backend, frontend, database, auth, shared, infra and process. Ask which to add and which to remove. process always stays.
4. **Protected trees:** folders an agent must never read as guidance, such as an archive of retired code or a frozen snapshot. An empty list is allowed.
5. **Release branch:** the branch trunk is promoted to, if the project has one. Empty means none.
6. **Production markers:** the hostnames or IP addresses, login strings (user@ or user@host), ports and database URL patterns (regular expressions) that identify production. The manifest is committed, so ask for names and addresses only, never a password or a token. Empty lists are allowed; the SSH-family clients are denied either way.
7. **Example files:** confirm the proposed example_globs, the secret-looking files an agent may read because they hold no real values.
8. **Approvals:** which of push, pull request create, pull request merge and dependency change should ask first (default: all four), and confirm the proposed extra dependency command prefixes.
9. **Consulted evidence:** confirm the proposed code globs (the files whose edit requires the corrections log to have been read), any extra files that must be read before a code edit, and whether a missing read blocks the end of the turn (block, the default) or only warns (warn).
10. **Description (when not inferred):** one sentence for project.description, asked only when step 4 found none.
11. **Tracker (when the origin remote is not on GitHub):** the issue tracker for project.tracker, asked only when step 4 flagged it.

Close the message by inviting the operator to correct any value from step 4 in the same reply.

### Step 6: Write the manifest

Edit `<repo>/checkrein.json`, the copy init created in step 3, with the final values. This is the only write to a file init did not just copy or append to, and the file did not exist before step 3.

- Keep every key from the template, in the template's order. Add no key and remove no key. Keep checkrein.manifest_version at 2.
- Keep each value's type: strings stay strings, lists stay lists, confidence_floor and ports stay numbers.
- domains is the default list minus the operator's removals plus the operator's additions: lowercase, no duplicates, process always present.
- areas are lowercase words or hyphenated words.
- Folder values end with a slash. Each workspace has a name and a root; "." means the repository root.
- Leave review.confidence_floor at 75 unless the operator gave a number from 0 to 100.
- approval.ask holds only push, pr_create, pr_merge and dependency_change. consulted.mode is block or warn. Never list the corrections log in consulted.required_reads; it is always required.
- Each database URL pattern is a JavaScript regular expression source, escaped for JSON (a literal dot is written as two backslashes and a dot).
- Write valid JSON with a two-space indent and no comments, then parse the file back to prove it is valid.

Show the final manifest. Every key is described in [manifest-fields.md](references/manifest-fields.md).

### Step 7: Write the .ignore file and set the workflow's trunk

**The .ignore file.** It keeps repository-wide searches (rg, and the search tools built on it) out of the protected trees and the vendored docs. The guards allow a search that names no path, so this file is what keeps such a search out. A search that names a path inside one of them still searches it, which is how the docs skill reads its index files. List one line per protected tree and one for paths.refdocs_root, each anchored to the repository root with a leading slash and ending with a slash.

- If `<repo>/.ignore` does not exist, create it with a first comment line `# checkrein: protected trees and vendored docs, skipped by repository-wide searches` followed by the entries, and record **created**.
- If it exists, append only the entries it does not already hold (after the same comment line, if the file lacks it), and record **appended**, or **kept** when nothing was missing. Change no existing line.

**The workflow's trunk.** When step 3 created `<repo>/.github/workflows/checkrein.yml` and vcs.trunk is not main, replace main with the trunk in its two places: the pull_request branches list and the origin/main part of the diff check's range. A kept workflow is left as it is; tell the operator to compare it with the template.

### Step 8: Run the check

Run this from the repository root and show the full output:

```
node checkrein-check.mjs
```

If Node 20 or newer is not available, say so, skip this step, and list the check under the next steps in step 10.

Handle what the check reports:

- **A missing path** that has a template counterpart (a manifest path, a file under the docs folder or the reference-documentation tree): create it from the template with the copy-without-overwriting rule, then run the check again. Repeat until no fixable path remains.
- **A missing path with no template counterpart:** report it and leave it to the operator.
- **Any other failure in a file that existed before init** (a heading, a working-doc name, an em dash): show it and change nothing. The operator decides.
- **Any failure in a file init created:** report it as a checkrein defect.

### Step 9: Print the enablement lines

Print each line in its own code block. Run neither: the git setting and the plugin are the operator's.

1. The git hooks, once per clone (skip it when step 3c found core.hooksPath already set to another folder):

   ```
   git config core.hooksPath .githooks
   ```

2. In Claude Code, the guards act once the checkrein plugin is installed at release 0.2.0 or later. Tell the operator to install or update it (`claude plugin update checkrein`) and to start a new session in this repository so the hooks load. The plugin's install pane lists the hooks it adds.

### Step 10: Print the summary

Print the action log as a table with the columns File and Action (created, kept, appended), one row per destination file. Group rows under a folder when every file under it has the same action.

Then print the next steps:

1. Review the diff and commit it yourself. init committed nothing.
2. If init wrote AGENTS.checkrein.md, merge it into the existing hub and remove it.
3. Read the hub (AGENTS.md). It is the map every skill follows.
4. Fill in the document templates. Each one carries filler guidance that says what belongs in it; replace the guidance with the project's own content, starting with the project brief. Keep the reference-documentation tree and its index files; vendor library and pattern docs there as the template's guidance describes.
5. Add any further secret globs, protected trees or production markers to the manifest by hand, and keep the .ignore file in step with protected_trees.
6. If the project's CI is not GitHub Actions, run the workflow's two commands (the adopter check, and the diff check over the pull request's range) in the project's own CI, and delete the workflow file.
7. Run the docs skill before writing any code.
8. Send the first pull request through preflight-check.

Close with the honest scope, in these words or close to them: "The guards are a guardrail for a cooperative agent, not a security boundary. They match command text, so a path assembled from variables, a symlink made in an earlier command, or a script written now and run later gets past them; the hub rule is what stops that, and the harness sandbox is the operating-system boundary. The end-of-turn check sees edits made through the file tools, not edits made through shell commands. The git hooks and CI see only what reaches a commit: never a read or a live connection, and a commit made with the hooks skipped is caught by CI on the pull request. Outside Claude Code, the git hooks and CI are the only enforcement."

## What init never does

- **Never deletes or overwrites a file.** An existing file is kept as it is. The only changes to files that existed before init are the appends in steps 3 and 7 (the hub section, the CLAUDE.md import line and missing .ignore entries).
- **Never edits code.** It reads manifests and configuration files to infer values and changes no source, test, build or configuration file.
- **Never commits.** It stages nothing, commits nothing, pushes nothing and creates no branch. The operator reviews the diff and commits.
- **Never changes git configuration.** It prints the core.hooksPath line; the operator runs it.
- **Never installs or updates the plugin.** It prints the line.
- **Never reads a file that matches the secret globs,** for any reason, and never asks for or writes a credential into the manifest.
- **Never runs twice.** When the manifest exists it stops at step 2 and names the upgrade skill for a version 1 manifest.
- **Never runs the project's own commands.** It writes them into the manifest; preflight-check runs them.

## Claude Code note

This section applies only in Claude Code; the steps above are the same in every harness.

- The plugin root is `${CLAUDE_PLUGIN_ROOT}` and this skill's folder is `${CLAUDE_SKILL_DIR}`, so the fallback in step 1 is the folder two levels above `${CLAUDE_SKILL_DIR}`.
- Use Bash for the existence checks and the byte-for-byte copies (cp without overwriting keeps the executable bit), Read for the manifests in step 4, Edit for the appends in steps 3 and 7, and Write or Edit for the manifest in step 6 and the .ignore file in step 7.
- In step 5, ask in one message and end the turn; resume at step 6 when the operator answers.
- Claude Code reads the hub through the @AGENTS.md import in CLAUDE.md. Without a CLAUDE.md anywhere above the folder, it reads AGENTS.md directly.
- The guards come from the plugin's hooks, not from any file init copies. A session that started before the plugin was installed or updated has not loaded them; the operator starts a new session.
