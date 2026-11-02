# AGENTS.md

This file is for agents working on the checkrein repository itself. The hub that checkrein installs into an adopter's repository is `templates/AGENTS.md`; do not confuse the two.

## What checkrein is

checkrein is a free, MIT licensed, harness-neutral engineering workflow for coding agents: a hub document, a small set of living documents, and skills that read those documents before acting and write to them after. It ships as a Claude Code plugin at the repository root and as plain files anyone can copy into another harness.

## Repository layout

- `.claude-plugin/`: the plugin manifest and the marketplace manifest.
- `.githooks/`: the pre-commit hook that runs the repository checks.
- `.leakcheck/`: the leak-check term list format; only `.leakcheck/terms.example.txt` is committed, a private list stays gitignored.
- `docs/`: plans for this repository, starting with `docs/plans/three-tier-roadmap.md`.
- `scripts/`: the adopter check (`scripts/checkrein-check.mjs`), the repository hygiene checks (`scripts/repo-checks.mjs`), their tests and fixtures.
- `skills/`: one folder per skill, each holding a `SKILL.md` plus optional `references/` and `evals/` folders.
- `templates/`: everything the `init` skill copies into an adopter's repository: the hub, the Claude Code import file, the manifest and the document templates.
- `templates/project-documentation/`: the living document templates and their filler guidance.
- `templates/reference-documentation/`: the scaffold and indexing guidance for vendored library and pattern docs.

## Rules

1. **No em dash anywhere.** The em dash character must not appear in any file, including code, JSON, comments and fixtures. Use a period, comma, colon, semicolon or parentheses. Do not use a spaced hyphen as a stand-in separator either. The repository checks fail on the glyph.
2. **Nothing project-specific or stack-specific.** checkrein reads as a generic workflow. A value that differs between projects (a path, a command, a vocabulary) becomes a manifest key or a placeholder. Where an example is needed, invent a neutral one (a notes app, a team wiki, an inventory tool).
3. **No dates in documentation.** Git owns history. No change stamps, no dates, no years in markdown. The LICENSE year is the one exception.
4. **No renames narrated.** When something changes name, use the new name everywhere and say nothing about the old one.
5. **No third-party documentation content.** Templates describe how to vendor and index docs, with placeholder names only.
6. **Harness-neutral language.** Protocol text says "the agent", "read", "search", "edit", "run", and calls the human who owns a repository "the operator". Tool names and harness specifics belong only in a section clearly marked as a Claude Code note.
7. **Portable SKILL.md frontmatter only.** The keys are `name` (equal to the folder name; lowercase letters, digits and hyphens; at most 64 characters), `description` (at most 1024 characters), and optionally `license`, `compatibility`, `metadata` and `allowed-tools`. No other key: other harnesses reject unknown keys.
8. **Every SKILL.md stays under 500 lines.** Move detail into the skill's `references/` folder and point to it by relative path.
9. **The manifest keys are the contract.** `templates/checkrein.json` defines every key a skill may cite. Skills cite values as `{{ref:<dotted.key>}}` tokens and never hardcode a project path or command. Adding a key means updating the manifest template, the adopter check, and every document that describes the manifest, in the same change.
10. **The templates are part of the product.** The document templates and their filler guidance under `templates/project-documentation/` and `templates/reference-documentation/` are maintained with the same care as the skills. When a skill's expectations of a document change, update the template and its filler guidance in the same change, so an adopter's first copy already matches what the skills read and the adopter check enforces.
11. **Plain, direct prose.** Second person imperative for instructions. No marketing adjectives. Use one name for one thing: checkrein, the hub, the manifest, the corrections log, the state document, working docs, the operator, the agent.

## Running the checks

Run all three before every commit; the pre-commit hook runs the first two.

- `node scripts/repo-checks.mjs` runs the repository hygiene checks, among them the em dash scan, the leak scan (when a private term list is present) and the SKILL.md frontmatter and length checks.
- `node --test scripts/*.test.mjs` runs the tests for both check scripts.
- `claude plugin validate . --strict` validates the plugin manifests and every skill. It must exit 0.

To use the pre-commit hook, run `git config core.hooksPath .githooks` once in your clone.

## Trying the adopter flow

Use a scratch directory outside this repository, never the repository itself.

1. Create an empty folder and run `git init` inside it.
2. In Claude Code, start a session in that folder with `claude --plugin-dir <path-to-checkrein>` and run `/checkrein:init`. In another harness, copy the contents of `templates/` and the file `scripts/checkrein-check.mjs` into the folder's root by hand.
3. Fill the manifest values `init` asks for, or edit `checkrein.json` directly.
4. Run `node checkrein-check.mjs` in the scratch folder. A fresh install must pass.
5. Run a skill such as `/checkrein:docs` against a small change and confirm it prints its file resolution table.

After editing a skill during a Claude Code session, run `/reload-plugins` to pick up the change.

## Adding a skill

1. Create `skills/<name>/SKILL.md` with the portable frontmatter (rule 7). The `description` says when to use the skill, in one paragraph, so an agent can decide from the description alone.
2. If the skill needs any project value, begin the body with **Step 0: Resolve the manifest**: read `checkrein.json` at the repository root, substitute every `{{ref:<dotted.key>}}` token, and stop with a message telling the operator to run `init` if the manifest is missing. A skill that reads living documents then prints its file resolution table.
3. Cite only keys that exist in `templates/checkrein.json`. If a new key is needed, follow rule 9.
4. Put long material in `skills/<name>/references/` and test prompts in `skills/<name>/evals/`.
5. Add the skill to the Mandatory Skill Protocol and the skill quick-reference table in `templates/AGENTS.md`, and to the README's skill list.
6. Run the three checks.

## No root CLAUDE.md

This repository deliberately has no root CLAUDE.md. The plugin validator warns on a CLAUDE.md at the plugin root, and Claude Code reads AGENTS.md natively when no CLAUDE.md exists. Adopters still receive `templates/CLAUDE.md`, which imports their hub.
