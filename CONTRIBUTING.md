# Contributing to checkrein

## Set up

Enable the repository's git hooks once per clone, so the checks run before every commit:

```sh
git config core.hooksPath .githooks
```

The checks need Node 20 or newer and nothing else. There are no dependencies to install.

## Run the checks

- `node scripts/repo-checks.mjs` runs the hygiene checks for this repository: no em dash, no leaked terms, valid skill frontmatter, valid plugin manifests, the manifest template, the README skills table, the hooks file, the case file, matching release versions with a changelog section, and the adopter check against `templates/`.
- `node --test scripts/*.test.mjs guards/*.test.mjs` runs the tests for both scripts and for the guards, including every row of `guards/cases.json`. Each top-level `guards/` module has a same-named test file except `guards/pretooluse.mjs`, which `guards/cases.test.mjs` covers, and the `guards/rules/*.mjs` modules are covered through the case file.
- `claude plugin validate . --strict` validates the plugin packaging, when Claude Code is installed.

The leak check reads a private term list at `.leakcheck/terms.txt`, which is gitignored. Copy `.leakcheck/terms.example.txt` to start one. Without it, the leak check prints a notice and passes.

## The rules

1. No em dash (U+2014) in any file, code and fixtures included. Use a period, comma, colon, semicolon or parentheses. Do not use a spaced hyphen as a separator either. A test that needs the character builds it from its code point.
2. No project or stack specifics. The kit is a generic workflow: a project's paths, commands and vocabulary come from the manifest (`checkrein.json`) through `{{ref:<key>}}` tokens. Where an example is needed, invent a neutral one such as a notes app or a team wiki.
3. Portable skill frontmatter only: `name`, `description`, and optionally `license`, `compatibility`, `metadata` and `allowed-tools`. Quote a description that holds `: ` or ` #`, or it is not valid YAML.
4. No dates in docs. Git owns history. The LICENSE year is the one exception.
5. Plain, direct prose with one name per thing: checkrein, the hub, the manifest, the corrections log, the state document, working docs, the operator, the agent.
6. Every guard bypass or false positive becomes a case in `guards/cases.json` before its fix lands: the exact tool input, the expected decision, the rule and a one-line reason. Run the tests, watch the new case fail, then fix the guard. Test fixtures use invented names only (`example.internal`, `deploy-user@`, port `55000`, `retired/`).
7. A release bumps `.claude-plugin/plugin.json` and `package.json` to the same version and adds its section to `CHANGELOG.md` in the same change.

## Report a guard case

If you are not changing the code, open an issue with the exact command or tool input, the decision the guard gave, and the decision you expected. The case is then added as a row of `guards/cases.json`.

## Add a skill

1. Create `skills/<name>/SKILL.md`. The folder name and the frontmatter `name` must match, and the file stays under 500 lines.
2. Write the description so an agent can decide to run the skill from the description alone, in at most 1024 characters.
3. A skill that reads project files begins with Step 0: read the manifest, substitute every token, and stop with a message to run `init` if the manifest is missing.
4. Put supporting files in `skills/<name>/references/` and link them by relative path.
5. Add the skill to the Mandatory Skill Protocol and the skill quick-reference table in `templates/AGENTS.md`, and to the skills table in `README.md`. The repository check fails until the README row exists.

## Test the adopter flow

Install the templates into a scratch repository and run the adopter check there, from the root of this repository:

```sh
SCRATCH="$(mktemp -d)" && git -C "$SCRATCH" init -q
cp -R templates/. "$SCRATCH"/ && cp scripts/checkrein-check.mjs "$SCRATCH"/
cp guards/diff-check.mjs "$SCRATCH"/checkrein-diff-check.mjs
node "$SCRATCH"/checkrein-check.mjs
```

The check prints `checkrein-check: OK (7 checks)` on a fresh install. To try the guards, start Claude Code in the scratch repository with `claude --plugin-dir <path-to-checkrein>`; the template manifest is version 2, so the hooks act there (the protected-tree guard only after you add a folder to `protected_trees` and create it, because the template list is empty). Edit a document in the scratch repository to break a rule and run the check again to see the finding. Delete the scratch folder when you are done.
