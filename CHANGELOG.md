# Changelog

Release sections for checkrein itself, newest first. The `## PR #<n>: <title>` grammar the adopter check enforces is for an adopter's own changelog, not this file.

## 0.2.0

### Added

- Enforcement for Claude Code, shipped as plugin hooks in `hooks/hooks.json` that run the scripts in `guards/`. Every hook is silent in a repository with no manifest or a version 1 manifest, and fails closed (an ask, or one block at the end of a turn, carrying the error text) when the manifest cannot be parsed or a guard fails internally.
- Four PreToolUse guards, run before every shell command and every file read, edit and search, in this precedence: production access (deny SSH-family clients, remote shell schemes and the manifest's production hosts, logins, ports and database URL patterns), protected trees (deny reading a folder in `protected_trees`, with metadata and retirement commands allowed and the `CHECKREIN_ALLOW_PROTECTED=1` prefix for a read the operator names), secret files (deny reading or writing a file in `secret_globs` unless it matches `example_globs`), and approval (ask before a push, a pull request creation or merge, and a dependency change). The first rule that fires decides.
- One shell-command evaluator (`guards/evaluator.mjs`) that every shell rule reads: quotes, separators, substitutions, subshells, heredocs, redirections, wrapper commands and `sh -c` style recursion.
- The consulted-evidence Stop hook (`guards/stop-consulted.mjs`): when a turn edited a file matching `consulted.code_globs` through the file tools and the session transcript shows no read of the corrections log (or of a `consulted.required_reads` file), it blocks the end of the turn once, or warns when `consulted.mode` is `warn`.
- The diff check (`guards/diff-check.mjs`), copied to an adopter's root as `checkrein-diff-check.mjs`, with pre-commit and pre-push templates under `templates/.githooks/` and a CI workflow template at `templates/.github/workflows/checkrein.yml`. It fails on an added or modified secret file and on a modified, deleted or moved-out file inside a protected tree, and warns on added lines that name a production host, login or database URL pattern.
- The allow, ask and deny case file `guards/cases.json`, run as tests by `guards/cases.test.mjs`, plus a test file per guard module.
- Manifest version 2: the optional keys `production_markers`, `example_globs`, `approval` and `consulted`, described in `skills/init/references/manifest-fields.md`.
- The `upgrade` skill, which moves a version 1 manifest to version 2 by adding keys only, copies the enforcement files without overwriting, writes the `.ignore` file, and prints the git hooks line and the plugin update line.
- The `.ignore` file that `init` and `upgrade` write in an adopter's repository: one line per protected tree and one for the reference tree, so repository-wide searches skip them.
- This changelog, and a repository check that the plugin and package versions agree and that this file has a section for the current version.

### Changed

- `init` writes a version 2 manifest, asks for the version 2 values, copies the diff check, the git hooks and the CI workflow, writes the `.ignore` file, and prints the `git config core.hooksPath .githooks` line.
- The adopter check (`checkrein-check.mjs`) accepts manifest versions 1 and 2 and checks the shape of each version 2 key that is present.
- The test command is `node --test scripts/*.test.mjs guards/*.test.mjs`, and the repository's pre-commit hook runs it.

## 0.1.0

### Added

- Tier 1, the method as text plus checks: the hub template, the living document templates with their filler guidance, the reference tree template, nine skills (`docs`, `dev-code`, `dev-review`, `github-story-writer`, `package-upgrade`, `post-merge`, `preflight-check`, `structured-debugging` and `init`), the manifest template, the zero-dependency adopter check with its tests, the repository hygiene checks, and packaging as a Claude Code plugin and as a plain folder.
