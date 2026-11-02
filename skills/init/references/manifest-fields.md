# Manifest fields

The manifest (checkrein.json at the repository root) is the one place a checkrein repository records its project specifics. Skills never hardcode a path, a command or a vocabulary; they read the manifest in Step 0 and replace every token of the form `{{ref:<dotted.key>}}` with the value at that key. This page lists every key, its type, its default and what it means.

The keys below are the whole contract. The version 1 keys (checkrein through review) are required in every manifest. The version 2 keys (production_markers through consulted) are optional: a missing one takes its default, a present one must have the shape shown, and in a version 1 manifest they are unknown keys. The check script reports any other top-level key as unknown.

Each key is shown in the token form a skill uses to cite it. Default values that are repository paths are written as plain text.

## checkrein

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:checkrein.manifest_version}}` | integer, 1 or 2 | `2` | The version of this contract the manifest is written against. Version 1 is the method as text plus checks. Version 2 adds the keys below and switches on enforcement: in Claude Code the checkrein plugin's guards act only in a repository whose manifest says 2 or higher, and stay silent for version 1 or no manifest. init writes version 2; the upgrade skill moves a version 1 manifest to version 2. Never lower it to turn enforcement off for one command; the guards name the allowed alternative in every denial. |

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
| `{{ref:protected_trees}}` | list of strings | `[]` | Repository-relative folders an agent never reads as guidance, such as an archive of retired code or a frozen snapshot. Write each with a trailing slash. The hub states the rule. With manifest version 2, in Claude Code, the protected-tree guard denies reads of these folders through the file tools and through shell readers, allows metadata and retirement commands, and lifts for one command that starts with CHECKREIN_ALLOW_PROTECTED=1 when the operator names the path. The diff check fails a commit that modifies or deletes a file inside one (adding a file is retirement and passes). The .ignore file lists each folder so repository-wide searches skip it. |

## secret_globs

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:secret_globs}}` | list of strings | .env and .env.* | Glob patterns for files an agent never reads or edits, for any reason. Add every pattern that matches a credential or key file in the repository. A glob without a slash matches the file name at any depth; a glob with a slash matches the whole path from the repository root. With manifest version 2, in Claude Code, the secrets guard denies reading or writing a matching file (through the file tools, shell readers, redirections and sourcing) unless it also matches example_globs, and the diff check fails a commit that adds or modifies one. |

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

## production_markers (version 2)

The literals that identify production. With manifest version 2, in Claude Code, the production guard denies any shell command that names one, as well as any SSH-family client (ssh, scp, sftp, rsync and their relatives) and any ssh:// style address, whatever the manifest says. The diff check warns, never fails, when an added line in a tracked text file holds a host, login or database URL pattern, because runbooks legitimately name hosts. The manifest is committed: list names and addresses, never a password, a token or a full connection string with credentials in it.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:production_markers.hosts}}` | list of strings | `[]` | Production hostnames and IP addresses, matched as whole tokens, ignoring case. A token matches when it equals the host or is any subdomain of it (the token ends in "." plus the host), in both the tool-time guard and the commit-time diff check. For example "notes.example.internal" or "10.20.30.40". |
| `{{ref:production_markers.logins}}` | list of strings | `[]` | Login strings that reach production, written as a "user@" prefix or a full "user@host". |
| `{{ref:production_markers.ports}}` | list of integers | `[]` | Ports that only production or a tunnel to it uses, from 1 to 65535. Matched as ":<port>", "-p <port>" and "--port <port>". A port written as a string of digits is accepted. |
| `{{ref:production_markers.database_url_patterns}}` | list of strings | `[]` | JavaScript regular expression sources matched ignoring case against the raw command text in the guard and against added lines in the diff check, for production database URLs. Escape dots and backslashes as JSON requires, for example "[a-z]+://[^\\s]*@db\\.example\\.internal". The check fails a pattern that does not compile. |

## example_globs (version 2)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:example_globs}}` | list of strings | .env.example, *.example and *.sample | Glob patterns for files that look like secrets but are templates an agent may read and edit, such as an example environment file that documents the variables. A file matching both secret_globs and example_globs is allowed. Same glob rules as secret_globs. Keep real values out of these files. |

## approval (version 2)

With manifest version 2, in Claude Code, the approval guard asks the operator before the shell commands below. It asks; it never denies, and no permission allowlist switches it off.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:approval.ask}}` | list drawn from push, pr_create, pr_merge, dependency_change | all four | The action classes that ask. push: any git push. pr_create: creating a pull request. pr_merge: merging a pull request. Mutating tracker API calls that create or merge pull requests, move refs or write file contents ask under these classes too. dependency_change: any command that adds, removes or updates a dependency or rewrites a lockfile, from a built-in list for the common package managers plus dependency_commands. A lockfile-faithful install (the clean-install or frozen-lockfile form) never asks. Remove a class to stop it asking. |
| `{{ref:approval.dependency_commands}}` | list of strings | `[]` | Extra command prefixes that change dependencies in this project, for a package manager the built-in list does not cover (for example "uv add" or "bundle add"). Each asks under dependency_change. |

## consulted (version 2)

With manifest version 2, in Claude Code, the consulted-evidence check runs when the agent ends a turn. If the turn edited a file that matches code_globs through the file tools, it searches the session transcript for evidence that each required file was read (a read of that path, a search whose path names it, or a shell reader naming it). It cannot see edits made through shell commands, and it allows silently when the transcript is not yet readable.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `{{ref:consulted.mode}}` | "block" or "warn" | "block" | block: a turn that edited code without the evidence is stopped once, with the missing file names, so the agent reads them and finishes; the second stop always passes, so it cannot loop. warn: the turn ends and the operator sees a warning instead. |
| `{{ref:consulted.code_globs}}` | list of strings | src/** and **/src/** | Repository-relative globs for the files that count as code. Edits to anything else (documents, configuration) never trigger the check. An empty list turns the check off. |
| `{{ref:consulted.required_reads}}` | list of strings | `[]` | Extra repository-relative files that must have been read in the session before a code edit, such as the architecture record. The corrections log (paths.corrections_log) is always required and is not listed here. The check script warns when an entry is not a file. |

## Changing the manifest later

- Edit the manifest by hand; init runs only once per repository. To move a version 1 manifest to version 2, run the upgrade skill.
- When a paths value changes, move the file in the same commit, then run the check script so a stale path fails at once.
- Keep every version 1 key, even when its value is empty. Skills cite every key, so a missing key leaves a token in a skill with nothing to resolve to.
- When protected_trees or paths.refdocs_root changes, update the .ignore file at the repository root in the same commit.
