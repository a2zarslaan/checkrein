# Manifest fields

The manifest (checkrein.json at the repository root) is the one place a checkrein repository records its project specifics. Skills never hardcode a path, a command or a vocabulary; they read the manifest in Step 0 and replace every token of the form `{{ref:<dotted.key>}}` with the value at that key. This page lists every key, its type, its default and what it means. The keys below are the whole contract: a manifest has exactly these keys, no more and no fewer.

Each key is shown in the token form a skill uses to cite it. Default values that are repository paths are written as plain text.

## checkrein

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:checkrein.manifest_version}}` | integer | `1` | The version of this contract that the skills were written against. Leave it as shipped. |

## project

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:project.name}}` | string | `""` | The project's name, used in reports, the hub and the state document. init infers it from the root package manifest or the repository folder name. |
| `{{ref:project.description}}` | string | `""` | One sentence saying what the project is. init infers it from the root package manifest when one carries a description. |
| `{{ref:project.tracker}}` | string | `"github"` | The issue tracker the story-writing, review and post-merge skills work against. |

## vcs

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:vcs.trunk}}` | string | `"main"` | The branch pull requests target. preflight-check diffs against the merge base with this branch. |
| `{{ref:vcs.release_branch}}` | string | `""` | Optional. A project that promotes trunk to a separate release branch names it here. Empty means the project has no release branch. |

## commands

Every command is run verbatim from the repository root by preflight-check. An empty command is skipped and reported as "not configured", never treated as a pass.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:commands.lint}}` | string | `""` | Runs the linters. |
| `{{ref:commands.typecheck}}` | string | `""` | Runs the type checker. |
| `{{ref:commands.test}}` | string | `""` | Runs the test suites. |
| `{{ref:commands.build}}` | string | `""` | Builds the project. |
| `{{ref:commands.format_check}}` | string | `""` | Checks formatting without rewriting files. |

## paths

Every value is relative to the repository root. Folder values end with a slash.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:paths.docs_dir}}` | string | project-documentation/ | The folder that holds the living documents. The check scans it for em dashes and for cited paths that do not exist. |
| `{{ref:paths.brief}}` | string | project-documentation/project-brief.md | The project brief: what the product is, who it serves, its priorities and constraints. |
| `{{ref:paths.architecture}}` | string | project-documentation/architecture.md | The architecture record: why the system is built the way it is, with each decision's revisit conditions. |
| `{{ref:paths.business_rules}}` | string | project-documentation/business-rules.md | The business rules record: what the system does, as decided behavior. |
| `{{ref:paths.corrections_log}}` | string | project-documentation/corrections-log.md | The corrections log: anti-patterns and conventions, newest first, indexed by tagged headings. |
| `{{ref:paths.state_doc}}` | string | project-documentation/current-project-state.md | The state document: what exists right now in every workspace, with its delta log, open gaps and accepted debt. |
| `{{ref:paths.changelog}}` | string | project-documentation/CHANGELOG.md | The changelog: one section per merged pull request. |
| `{{ref:paths.working_docs_dir}}` | string | project-documentation/temp/ | The folder for working docs (plans and audits) of in-flight work. Each is retired when its work merges. |
| `{{ref:paths.runbooks_dir}}` | string | project-documentation/runbooks/ | The folder for operational runbooks. |
| `{{ref:paths.refdocs_root}}` | string | reference-documentation/ | The root of the vendored library and pattern docs. Every folder under it is fronted by an index file that the docs skill reads first. |

## workspaces

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:workspaces}}` | list of objects, each with name (string) and root (string) | one entry: name "app", root "." | The independently buildable parts of the repository, such as a web app, a mobile app and a backend. The root is a repository-relative folder, and "." means the repository root. A single-package project keeps the default. The state document records every workspace, and the review and preflight skills use the list to scope their checks. |

## protected_trees

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:protected_trees}}` | list of strings | `[]` | Repository-relative folders an agent never reads as guidance, such as an archive of retired code or a frozen snapshot. The hub states the rule; nothing in this release enforces it mechanically. |

## secret_globs

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:secret_globs}}` | list of strings | .env and .env.* | Glob patterns for files an agent never reads or edits, for any reason. Add every pattern that matches a credential or key file in the repository. |

## domains

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:domains}}` | list of strings | backend, frontend, database, auth, shared, infra, process | The closed vocabulary for the tags in corrections-log headings. Every tag in a heading must be on this list, and the check fails a heading that uses any other tag. process must always be present, because process rules apply to every change. Add a domain when a part of the system needs its own rules; keep the list short so the tags stay useful for searching. |

## areas

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:areas}}` | list of strings | `[]` | The vocabulary for the area word in issue titles, pull request titles and branch names (for example auth, billing, tables). Use the same word for the same area everywhere so a search finds all of its work. |

## review

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:review.confidence_floor}}` | integer from 0 to 100 | `75` | The minimum confidence a review finding needs before dev-review posts it. A finding below the floor is not posted. |

## Changing the manifest later

- Edit the manifest by hand; init runs only once per repository.
- When a paths value changes, move the file in the same commit, then run the check script so a stale path fails at once.
- Keep every key, even when its value is empty. Skills cite every key, so a missing key leaves a token in a skill with nothing to resolve to.
