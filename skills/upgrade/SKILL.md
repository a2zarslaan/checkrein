---
name: "upgrade"
description: "Move a repository that already uses checkrein from manifest version 1 to version 2 and switch on enforcement. Reads checkrein.json and reports its version, explains in one table what each guard denies or asks and what it cannot see, asks the operator in one message for production markers, example files, approvals, the consulted-evidence mode and code globs, adds only the new keys to the manifest (existing keys keep their order and values), copies the diff check, the git hooks and the CI workflow without overwriting, writes the .ignore file, writes the new hub as AGENTS.checkrein.md to merge, prints the git config line for the hooks and the plugin update line, and runs the check. On a manifest that is already version 2 it only offers to copy missing enforcement files. Run it from the repository root. Trigger phrases include 'upgrade checkrein', 'checkrein upgrade', 'enable checkrein enforcement' and 'migrate checkrein.json'. For a repository with no checkrein.json, run init instead."
---

# upgrade

## Purpose

Turn on checkrein enforcement in a repository that installed checkrein at manifest version 1. Version 2 adds four optional manifest keys and three kinds of enforcement: in Claude Code, guards that run before every tool call and at the end of every turn; in any harness, git hooks and a CI job that check what reaches a commit. Nothing changes for the documents or the other skills.

The upgrade is additive, like init: the manifest gains keys and loses none, an existing file always wins, and the operator reviews the result as an ordinary diff before committing it.

## Names used in this skill

- `<repo>` is the operator's repository root (the current directory, confirmed in step 1).
- `<plugin>` is the checkrein folder resolved in step 1, and `<templates>` is `<plugin>/templates`.
- **Copy without overwriting** means: for every file under the source, check whether the destination file exists. If it does, leave it untouched and record **kept**. If it does not, create it with the source bytes, creating folders as needed, keep the source's executable bit, and record **created**. Copy the bytes; never retype a template.
- **The adopter files** are the five files of the version 2 install:

| Source | Destination |
|---|---|
| `<plugin>/guards/diff-check.mjs` | `<repo>/checkrein-diff-check.mjs` |
| `<templates>/.githooks/pre-commit` | `<repo>/.githooks/pre-commit` |
| `<templates>/.githooks/pre-push` | `<repo>/.githooks/pre-push` |
| `<templates>/.github/workflows/checkrein.yml` | `<repo>/.github/workflows/checkrein.yml` |
| written by step 6 | `<repo>/.ignore` |

Keep a running action log of every destination file and its action (created, kept, appended, edited or replaced). Step 9 prints it.

## Steps

Run the steps in order. Report the result of each step before starting the next.

### Step 1: Confirm the repository root, the manifest and the plugin

Confirm that the current directory is the repository root: `<repo>/.git` exists (a folder, or a file in a linked worktree) and `git rev-parse --show-prefix` prints an empty line (comparing `git rev-parse --show-toplevel` with the current folder works only after resolving both to real paths, because a symlinked path prints differently). If it is not the root, stop and tell the operator to start the session from the repository root.

Confirm that `<repo>/checkrein.json` exists. If it does not, stop and say: "This repository has no checkrein manifest. Run the init skill; it installs version 2 directly."

Resolve `<plugin>`. In Claude Code it is the value of the variable below; in any other harness it is the folder two levels above the folder that holds this file (up from `upgrade`, then up from `skills`).

```
${CLAUDE_PLUGIN_ROOT}
```

Confirm that `<plugin>/guards/diff-check.mjs`, `<plugin>/scripts/checkrein-check.mjs`, `<templates>/.githooks/pre-commit`, `<templates>/.githooks/pre-push`, `<templates>/.github/workflows/checkrein.yml` and `<templates>/checkrein.json` exist, and that `<templates>/checkrein.json` says manifest version 2. If `<templates>/checkrein.json` or `<plugin>/scripts/checkrein-check.mjs` is missing, the folder is not a checkrein folder (the skills may have been copied without the rest of checkrein): stop and ask the operator for the path to the checkrein folder, then check again under that path. If the folder resolves (both of those files exist) but the template says version 1 or another of the files above is missing, stop: the installed checkrein is older than release 0.2.0. Tell the operator to update it (in Claude Code, `claude plugin update checkrein`, then a new session) and to run upgrade again.

### Step 2: Read the manifest and report its version

Read `<repo>/checkrein.json` and parse it. Print one line: `Manifest version: <value>`.

- **It does not parse:** show the parse error and stop. The operator fixes the file by hand. Say that while a manifest fails to parse, the Claude Code guards ask before every tool call with the error text, by design.
- **Version 2 or higher:** say "The manifest is already version <n>; enforcement is switched on by the manifest." Check which adopter files are missing at their destinations and list them. If none is missing, say so and stop. If some are missing, offer to copy them; on the operator's yes, copy them as step 6 does (the copy-without-overwriting rule, the workflow's trunk, the .ignore entries), print the action log, and stop. Change nothing in the manifest.
- **Version 1:** continue.
- **Any other value** (missing, zero, not a number): show it and stop. The operator fixes the version by hand.

For a version 1 manifest, also compare `<repo>/checkrein-check.mjs` with `<plugin>/scripts/checkrein-check.mjs` byte for byte. A copy installed with version 1 rejects a version 2 manifest. If the file is missing, step 6 copies it. If it differs, step 4 asks whether to replace it.

Also run `git config --get core.hooksPath` and note its value for step 4.

### Step 3: Explain what version 2 turns on

Print this table, then one line: "The guards are a guardrail for a cooperative agent, not a security boundary. Step 9 repeats the limits."

| Guard | Where it runs | What it does | What it cannot see |
|---|---|---|---|
| Production access | Claude Code, before every shell command | Denies SSH-family clients (ssh, scp, sftp, rsync and their relatives, including absolute paths and wrappers such as sudo or env), ssh:// style addresses, and any production host, login, port or database URL pattern from the manifest. The denial tells the agent to diagnose on a local copy and hand the operator a single-line command. | A host or command assembled from variables; a script written now and run later; a connection made by a tool other than the shell. |
| Protected trees | Claude Code, before shell commands and file reads, edits and searches | Denies reading any folder in protected_trees: file tools aimed inside one, shell readers that name one, a reader fed from one through a pipe or substitution, a move out of one, and a recursive grep from the repository root. Allows metadata and retirement commands (list, test, stat, count, make a folder, version-control add, move into a tree, commit, status). A command starting with CHECKREIN_ALLOW_PROTECTED=1 lifts this one rule, only when the operator names the path. | A symlink made in an earlier command; a path assembled from variables; a search that names no path (the .ignore file keeps rg out instead). |
| Secret files | Claude Code, before shell commands and file reads and edits | Denies reading or writing a file that matches secret_globs, through the file tools, shell readers and editors, redirections and sourcing, unless it also matches example_globs. Listing and metadata commands are allowed. | A program that opens the file itself (a test runner or a framework that loads an environment file); a path assembled from variables. |
| Approval | Claude Code, before every shell command | Asks the operator before each class in approval.ask: a git push in any form, creating or merging a pull request, mutating tracker API calls that create or merge pull requests, move refs or write contents, and dependency changes (the common package managers built in, plus approval.dependency_commands). A lockfile-faithful install never asks. It asks; it never denies. | The same action through a script, an alias, or a tool other than the shell. |
| Consulted evidence | Claude Code, at the end of every turn | When the turn edited a file matching consulted.code_globs through the file tools, checks the session transcript for a read of the corrections log and of each consulted.required_reads file. Missing evidence blocks the turn once (or warns, in warn mode); the second stop always passes. | Edits made through shell commands; whether the read was understood; a transcript not yet written (it allows rather than block falsely). |
| Diff check | Any harness: the pre-commit and pre-push hooks, and CI on every pull request to the trunk | Fails a commit or range that adds or modifies a secret file, or modifies or deletes a file inside a protected tree (adding one is retirement and passes). Warns, never fails, on added lines that name a production host, login or database URL. | Anything that never reaches a commit: a read, a live connection. Hooks skipped with --no-verify are caught only by CI. |

### Step 4: Ask the operator for the version 2 values

Before asking, prepare proposals from file names and configuration only (never read a file that matches secret_globs, even to propose a value):

- **Example files:** file names ending in .example, .sample or .template, on top of the default example_globs.
- **Dependency commands:** the add and remove prefixes of any package manager whose lockfile is present and that is not built in (the common JavaScript, Python, Rust and Go managers are built in), for example "uv add" and "uv remove", or "bundle add" and "bundle remove".
- **Code globs:** the source folder of each workspace in the manifest (src, lib, app, cmd, internal, or what the workspace's own manifest names), as `<root>/<folder>/**` patterns, on top of the default src/** and **/src/**.

Then send one message that asks for every value, and wait for the answer. Do not continue on an assumed answer.

1. **Production markers:** the hostnames or IP addresses, login strings (user@ or user@host), ports and database URL patterns (regular expressions) that identify production. The manifest is committed, so ask for names and addresses only, never a password or a token. Empty lists are allowed; the SSH-family clients are denied either way.
2. **Example files:** confirm the proposed example_globs.
3. **Approvals:** which of push, pull request create, pull request merge and dependency change should ask first (default: all four), and confirm the proposed extra dependency command prefixes.
4. **Consulted mode:** whether a code edit without the reads blocks the end of the turn (block, the default) or only warns (warn), and any extra files that must be read before a code edit beyond the corrections log.
5. **Code globs:** confirm the proposed consulted.code_globs.
6. **The check script (only when step 2 found it differs):** show a short summary of the difference (the line counts of both copies and the number of changed lines from a line diff, never the full diff), then ask: "Your checkrein-check.mjs differs from this release's copy; the version 1 copy rejects a version 2 manifest. Replace it with the copy from this release? Any local edits to it are lost." Replace it only on a yes.
7. **Existing hooks (only when needed):** when `<repo>/.githooks/pre-commit` or `<repo>/.githooks/pre-push` already exists, or core.hooksPath already names another folder, say that the existing hooks are kept and step 7 gives the line to add to them.

### Step 5: Rewrite the manifest

Edit `<repo>/checkrein.json` in place. Keep the original text in memory first, so a failed edit can be put back exactly.

- Change only the value of checkrein.manifest_version, from 1 to 2.
- Add the version 2 keys after the last existing top-level key, in this order: production_markers, example_globs, approval, consulted. Write each with every sub-key, using the operator's answers and the template defaults for anything the operator left unchanged.
- If a version 2 key is already present, keep its value as it is, do not add it twice, and report it.
- Never reorder, rename, reformat or drop an existing key or value. Match the file's indent for the new keys.
- approval.ask holds only push, pr_create, pr_merge and dependency_change. consulted.mode is block or warn. Never list the corrections log in consulted.required_reads; it is always required. Ports are numbers. Each database URL pattern is a JavaScript regular expression source, escaped for JSON.

Parse the file back. If it does not parse, write the original text back, record nothing, show the error, and stop. Otherwise record **edited** and show the added keys.

### Step 6: Copy the adopter files

Copy the first four adopter files with the copy-without-overwriting rule. Then:

- **The check script.** If `<repo>/checkrein-check.mjs` is missing, copy it from `<plugin>/scripts/checkrein-check.mjs` and record **created**. If the operator said yes in step 4, replace it with that copy and record **replaced**; this is the one file upgrade may replace, because it is checkrein's own copy and only on the operator's word. Otherwise record **kept**.
- **The workflow's trunk.** When this step created `<repo>/.github/workflows/checkrein.yml` and vcs.trunk is not main, replace main with the trunk in its two places: the pull_request branches list and the origin/main part of the diff check's range. A kept workflow is left as it is; tell the operator to compare it with the template.
- **The .ignore file.** It keeps repository-wide searches (rg, and the search tools built on it) out of the protected trees and the vendored docs; the guards allow a search that names no path, so this file is what keeps such a search out. A search that names a path inside one still searches it. The entries are one line per protected_trees entry and one for paths.refdocs_root, each anchored to the repository root with a leading slash and ending with a slash. If `<repo>/.ignore` does not exist, create it with the first line `# checkrein: protected trees and vendored docs, skipped by repository-wide searches` followed by the entries, and record **created**. If it exists, append only the missing entries (after the same comment line, if the file lacks it) and record **appended**, or **kept** when nothing was missing. Change no existing line.
- **The hub and CLAUDE.md.** Release 0.2.0 changed both templates, and upgrade never edits the repository's own copies. Compare `<repo>/AGENTS.md` with `<templates>/AGENTS.md`. If they are identical, record **kept**. Otherwise copy `<templates>/AGENTS.md` to `<repo>/AGENTS.checkrein.md` (kept if that file exists) and record **created**, then list the 0.2.0 hub text the repository's hub lacks, checking for each marker: the deliberate-read prefix rule (`CHECKREIN_ALLOW_PROTECTED=1`, set only when the operator names the path), the rule to keep `.ignore` in step with protected_trees, the section `### Approvals and Consulted Evidence (Mandatory)`, and the paragraph on a hook reason that starts with "checkrein guard error". Also report when the hub still says "A later checkrein release may add harness hooks"; the 0.2.0 text replaces that sentence. Then compare `<repo>/CLAUDE.md` (when it exists) with `<templates>/CLAUDE.md`: if the Claude Code notes paragraph differs, show the template's paragraph and say it replaces the one that says a later release may add plugin hooks. Tell the operator to merge the new text into the hub (and CLAUDE.md) and to remove AGENTS.checkrein.md once merged.

### Step 7: Print the enablement lines

Print each line in its own code block. Run neither: the git setting and the plugin are the operator's.

1. The git hooks, once per clone (when core.hooksPath already names another folder, print instead the line to add to the hooks there: `node checkrein-diff-check.mjs --staged` for pre-commit, and the loop in the template's pre-push for pre-push):

   ```
   git config core.hooksPath .githooks
   ```

2. The plugin, in Claude Code, so the guards are release 0.2.0 or later; then start a new session in this repository so the hooks load:

   ```
   claude plugin update checkrein
   ```

### Step 8: Run the check

Run this from the repository root and show the full output:

```
node checkrein-check.mjs
```

If Node 20 or newer is not available, say so and list the check under the next steps. If the check reports that the manifest version must be 1, the kept check script is the version 1 copy: say so and point to step 4's question. Report any other finding and change nothing; the operator decides.

### Step 9: Print the summary

Print the action log as a table with the columns File and Action (created, kept, appended, edited, replaced).

Then print the next steps:

1. Review the diff and commit it yourself. upgrade committed nothing.
2. Run the git config line and the plugin update from step 7, then start a new session.
3. If step 6 wrote AGENTS.checkrein.md or listed missing hub text, merge the 0.2.0 text into the hub (and the CLAUDE.md paragraph), then remove AGENTS.checkrein.md.
4. If the project's CI is not GitHub Actions, run the workflow's two commands (the adopter check, and the diff check over the pull request's range) in the project's own CI, and delete the workflow file.
5. Add any further production markers, secret globs or protected trees to the manifest by hand, and keep the .ignore file in step with protected_trees.
6. Report a false positive as a guard case: the exact command, the decision and the decision expected.

Close with the honest scope, in these words or close to them: "The guards are a guardrail for a cooperative agent, not a security boundary. They match command text, so a path assembled from variables, a symlink made in an earlier command, or a script written now and run later gets past them; the hub rule is what stops that, and the harness sandbox is the operating-system boundary. The end-of-turn check sees edits made through the file tools, not edits made through shell commands. The git hooks and CI see only what reaches a commit: never a read or a live connection, and a commit made with the hooks skipped is caught by CI on the pull request. Outside Claude Code, the git hooks and CI are the only enforcement."

## Turning enforcement off

Enforcement follows the manifest. To switch the Claude Code guards off, the operator sets checkrein.manifest_version back to 1 and removes the four version 2 keys (the check reports them as unknown in a version 1 manifest). To switch the git hooks off, the operator unsets core.hooksPath. upgrade never does either.

## What upgrade never does

- **Never drops, reorders or rewrites an existing manifest key or value.** It changes the version number and adds the version 2 keys; a key already present keeps its value.
- **Never overwrites a file,** with one exception: `<repo>/checkrein-check.mjs`, replaced only when the operator says yes after seeing the summary of the difference, because the version 1 copy rejects a version 2 manifest. Every other existing file is kept, the hub and CLAUDE.md included (the new hub text goes to AGENTS.checkrein.md for the operator to merge); the only other changes to existing files are the appends to .ignore.
- **Never edits code.** It reads manifests and configuration files to propose values and changes no source, test, build or configuration file.
- **Never commits.** It stages nothing, commits nothing, pushes nothing and creates no branch.
- **Never changes git configuration or installs the plugin.** It prints both lines; the operator runs them.
- **Never reads a file that matches the secret globs,** for any reason, and never asks for or writes a credential into the manifest.
- **Never runs on a missing manifest or lowers a version.** A missing manifest goes to init; a version 2 manifest gets only the missing adopter files.
- **Never runs the project's own commands.** It runs only the checkrein check.

## Claude Code note

This section applies only in Claude Code; the steps above are the same in every harness.

- The plugin root is `${CLAUDE_PLUGIN_ROOT}` and this skill's folder is `${CLAUDE_SKILL_DIR}`, so the fallback in step 1 is the folder two levels above `${CLAUDE_SKILL_DIR}`.
- Use Bash for the existence checks, the byte comparison (cmp) and the copies (cp without overwriting keeps the executable bit), Read for the manifest, Edit for the manifest rewrite and the .ignore appends, and Write for a new .ignore file.
- In step 4, ask in one message and end the turn; resume at step 5 when the operator answers.
- The guards are the plugin's hooks and read the manifest on every call. When this session already runs a 0.2.0 or later plugin, they act from the moment step 5 writes version 2, for the rest of the session. Otherwise they load in the next session after the update.
