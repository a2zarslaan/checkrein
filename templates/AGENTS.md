# AGENTS.md

This file is the hub: the first thing an agent reads in this repository. It is a **navigation map, not a content store**. It tells you where each kind of knowledge lives and which protocol to run when. Anything below that looks like it duplicates a canonical source is stale by definition: go to the source. When this file and a source disagree, **trust the source**.

`checkrein.json` (the manifest) at the repository root is the source of truth for every project-specific path, command, workspace, domain and area. The paths written in this file are the manifest's defaults; if the manifest names a different path, the manifest wins. Run `node checkrein-check.mjs` to verify that the paths this hub and the living documents cite exist and that the documents follow their grammar.

The project's own context (what the product is, who it serves, its priorities and constraints) lives in `project-documentation/project-brief.md`. Why the system is built the way it is lives in `project-documentation/architecture.md`. This file holds neither.

## Why the hub is shaped this way

Agents fail in predictable ways: they invent APIs, repeat mistakes that were already fixed, reopen decisions that were already made, widen the scope of a change, and write comments that defend code instead of fixing it. Each failure has a cheap counter, provided the counter runs at the right moment. This repository keeps one record per kind of knowledge and makes every procedure read the record before acting and write to it after. The documents are the memory an agent does not carry between sessions. Where a rule can be checked by a script, it is checked; where it cannot, it is stated once, here or in its canonical document, and every skill points back to it.

## Documentation Map (read this first)

| Question | Canonical source |
|---|---|
| What paths, commands, workspaces, domains and areas does this project use? | `checkrein.json` |
| What is the product, who is it for, what are its priorities? | `project-documentation/project-brief.md` |
| What exists in the codebase right now (modules, routes, endpoints, models, commands, per workspace)? | `project-documentation/current-project-state.md`, Part 1 |
| What debt has been accepted, and which decisions are settled? | `project-documentation/current-project-state.md`, Part 4 |
| What changed, per merged pull request? | `project-documentation/CHANGELOG.md` |
| Which anti-patterns must I avoid? | `project-documentation/corrections-log.md`: the tagged rule headings are the index; search them and pull matching entries (Standard Corrections Log Check below); never read the whole file |
| What are the business rules (lifecycles, cascades, gating, calculations)? | `project-documentation/business-rules.md`: behavior lives there, mechanism lives in the architecture record; one fact, one home |
| Why is the system built this way (platform choices, mechanisms, revisit conditions)? | `project-documentation/architecture.md` |
| Where is the plan or audit for in-flight work? | `project-documentation/temp/`: `plan - <descriptor>.md` or `audit - <descriptor>.md` (Working Doc Convention below) |
| What does the data schema look like? | The schema file in the codebase, never a hand-described table in a document |
| Which library API or pattern do I use for X? | Run the `docs` skill; it routes to the right `reference-documentation/<folder>/_INDEX.md` |
| Which procedure applies to an operational task (deploy, rollback, setup)? | `project-documentation/runbooks/` |
| What is the story-level work and its acceptance criteria? | The GitHub issue for the ticket |

**GitHub issues are the durable record of story-level work.** There is no per-story or per-initiative file in the repository. An initiative's stories are found by their shared issue-title prefix; the working plan or audit for in-flight work lives in `project-documentation/temp/` and is retired when the work merges.

**One fact, one home.** Each fact lives in exactly one document. Another document that needs it links to it and does not restate it. A restated fact is a second copy that drifts the moment the first one changes.

**Shared first, then per workspace.** The living documents are organized by concern (why, rules, what exists, what went wrong, what changed), not by workspace. The manifest's `workspaces` list names the independently buildable parts of the repository. In `project-documentation/business-rules.md` and `project-documentation/architecture.md`, content under `## Shared` holds for every workspace. Content that holds for one workspace only sits under `## Workspace: <name>`, where `<name>` is an entry of the manifest's `workspaces` list. The `docs` skill's Governing-Docs Check searches for exactly these two heading shapes: a task pulls the shared sections plus its own workspace's section, never another workspace's. The state document records every workspace in one file by default; a project may split the record per workspace by adding files and naming them in this map.

## Critical Rules

### Cross-Reference Verification (Mandatory)

- Never trust a pull request number, issue number or file path taken from a document without verifying it. Earlier sessions attribute rules to the wrong pull request, cite paths that moved, and imply ranges that never existed.
- Before citing a pull request or issue, run `gh pr view <N>` or `gh issue view <N>` and confirm it exists and its title matches the context.
- Before citing a file path from any document (a plan, a runbook, the state document, a corrections entry), confirm the file exists at that path.
- A numeric range such as "#40 to #46" may contain issue numbers as well as pull request numbers. Never assume every number in a range is a pull request.

### Shell Commands Given to the Operator (Mandatory)

Every shell command handed to the operator, for any purpose, must be **one line and paste-safe**. Multi-line paste blocks fail in real terminals: stuck continuation prompts from mismatched heredoc markers, leading spaces read as commands, a stray space after a backslash breaking a pipeline.

**One line is necessary but not sufficient: keep it short, under about 80 characters.** A long line wraps in the terminal and can paste as two broken lines. Prefer paths relative to the repository root. If a command cannot be shortened, split it into steps or use the editor workflow.

Never use, in a command given to the operator:
- heredocs of any form
- trailing backslash line continuations
- pipelines split across lines
- `if`, `for`, `while` or any block that spans lines

To stay on one line, in order of preference:
1. Short file content (one to three lines): one `printf '...' > <file>` or `echo '...' > <file>`.
2. A short script body: `printf '%s\n' 'line one' 'line two' > <file> && chmod +x <file>` on one line.
3. Anything longer than about five lines: tell the operator to open the file in an editor and paste the content. Show the content as a reference block; the instruction is the editor workflow.
4. Several commands: chain them with `&&` on one line, or give them as separate one-line steps.
5. Control flow: put it in a script file (created by step 3) and give a one-line command that runs it.

There is no exception. If it does not fit on one line, use the editor workflow.

### Production Access (Mandatory)

The agent never opens a connection to production: no remote shell, no file copy to or from a production host, no tunnel, no production database connection string. **A read-only query is not an exception.** Diagnose against a local copy instead: the operator fetches a backup, the agent restores it locally and queries that. When a production-side action is genuinely required, hand the operator the exact one-line command (rules above) and stop.

If the harness or a hook denies a command, the denial is final. Never reword a command to get around it. A later checkrein release may add harness hooks that enforce this rule; the rule stands on its own without them.

### Protected Trees (Mandatory)

The manifest's `protected_trees` list names folders that are never read as guidance: an archive of retired code, a frozen snapshot, records of delivered work. What a feature should do comes from the live codebase, the issue and the plan, never from a protected tree.

- Do not read a protected tree, search inside it, or cite it as the authority for a current rule.
- The one exception is a deliberate read the operator asked for by path. Never start such a read on your own initiative. When a task seems to need a file in a protected tree, ask the operator for the path.
- A pointer into a protected tree that sends an agent there for current guidance is removed, not repointed. A pointer that only records provenance (where a historical baseline now lives) may keep its path.
- Search from the repository root with a tool that honours the project's ignore file, and keep protected trees listed in it, so a broad search does not pull them into context.

The manifest's `secret_globs` list names files the agent never reads or edits, whatever the task.

`reference-documentation/` is read-only. Never edit, install or run anything inside it. The only writes allowed there are edits to an _INDEX.md file.

### Version Parity Across Environments (Mandatory)

Development machines, CI and production run **the exact same version** of every dependency whose version can change runtime behavior. Drift between environments turns "works on my machine" into a production outage.

- Never use a floating container tag (latest, a bare major, or a major and minor). Pin the full major.minor.patch.
- Never use a version range in a dependency manifest. Every declared dependency is an exact x.y.z, so a direct dependency never moves without a visible manifest edit. Any exception is decided and recorded in `project-documentation/architecture.md`.
- The lockfile freezes the transitive tree only if every path that reproduces an environment (CI, image builds, deploys) installs from the lockfile without re-resolving it. A re-resolving install belongs only to a deliberate manifest edit.
- The language runtime and the package manager are pinned to the same exact version in every place that declares them (container base image, version file, manifest engine field). They must match.
- When bumping a pinned version, update every location in the same commit, including runbook examples, since operators copy what they see. Use the `package-upgrade` skill for every dependency change.
- When a bug appears in one environment only, compare the exact versions (image digests, lockfile entries) across environments before any other diagnosis, and reconcile them first.

### Settled Code and Recorded Decisions (Mandatory)

Merged code is a decision, not a draft. An agent working in one area sees shapes in another that look wrong; most were chosen deliberately, for reasons not in the current context. Raising one again costs the operator a decision already paid for, and fixing one silently reverses earlier work.

**Scope boundary for edits.** A ticket changes the code its own issue names. Merged code in another workspace or another area is touched only when it **blocks** the work, and the pull request body then names what blocked it. "It would be better if" is not a blocker, and neither is an older pattern that predates the one being applied now.

**Scope boundary for findings.** A review's findings are about its diff. An observation about code the pull request did not touch is never a finding and is never handed to the operator as an open question. It ends in exactly one of three dispositions, decided by the agent that raised it:

1. **Fold:** fix it in this pull request. Only when the fix is certain, small, and inside code the pull request already changes.
2. **Record:** one row in Part 4 of `project-documentation/current-project-state.md` when it is accepted debt, or a rule in the governing section of `project-documentation/business-rules.md` or `project-documentation/architecture.md` when it is a decided rule. The record carries the shape, why it stands, and the source pull request.
3. **Drop:** one line, inside the review that raised it, saying it is not worth recording.

The test between Record and Drop is **whether a competent reviewer would find it again**. A visible structural shape gets recorded, because otherwise it is found and decided again every round. A one-off wording preference gets dropped.

**Read the record before reporting.** Part 4 of the state document and the corrections-log heading index are the list of settled items, and every skill that reviews or writes code loads them. An observation that matches a recorded row is not a finding: cite the row. Reopening a recorded decision takes new evidence the row does not already contain, named in the finding that reopens it.

### Comment Discipline (Mandatory)

A comment that has to be long to justify code is a **symptom, not documentation**. Before writing one, find which gap creates the pressure and raise it with the operator instead:

1. **The architecture is fighting the solution:** the mechanism needs defending because the design does not fit.
2. **The knowledge is in the wrong home:** behavioral rules belong in `project-documentation/business-rules.md`; design rationale and revisit conditions belong in `project-documentation/architecture.md`; anti-pattern rules live only in `project-documentation/corrections-log.md` and are never restated or cited by line or pull request number in code, because those citations rot and duplicate the log.
3. **A canonical pattern is not being followed:** the comment excuses a deviation that should not exist.

Comments that stay: a few lines stating a constraint the code cannot express, or a bare marker for a deliberate deviation. Comments that go: narration of what the code does, defenses written at reviewers, rules restated from other documents. **Relocate before shrinking:** the detail lands in its canonical document before the inline version is cut; it is never lost for brevity. Test files may carry richer comments, as long as they describe the behavior the assertion pins.

### Architecture

- **Do not over-engineer.** Prefer simple, proven patterns over clever abstractions.
- **Do not introduce libraries outside the declared stack.** The stack and the reasons for it are recorded in `project-documentation/architecture.md`. Adding a library is an architecture decision for the operator, recorded there in the same pull request.
- The pattern references under `reference-documentation/` show **how** to build. **What** to build comes from the live codebase, the issue and the plan. Adapt a reference pattern to this codebase; do not copy layers that do not fit it.
- Code shared between workspaces stays portable: it uses no environment-specific globals or APIs that only one consumer has, and its dependency on a framework is declared, never assumed.

## Naming Convention

Work falls into four categories, named by **type plus area** so that issues, pull requests and branches are searchable together.

| Category | When | Issue title | Pull request title | Branch |
|---|---|---|---|---|
| Bug fix | Fixing broken behavior | `Bug: <area>: what is broken` | `fix(<area>): what was fixed` | `fix/<area>-<descriptor>` |
| Refinement | Improving an existing feature | `Refine: <area>: what is improving` | `refine(<area>): what changed` | `refine/<area>-<descriptor>` |
| Big feature | A new multi-PR initiative | `<Initiative> <N>: <area>: story title` | `feat(<area>): description (<Initiative> <N>)` | `feat/<initiative>-<N>-<descriptor>` |
| Docs or chores | Work that is not product code | `Docs: description` or `Chore: description` | `docs: description` or `chore: description` | `docs/<descriptor>` or `chore/<descriptor>` |

Examples for a notes app: issue "Bug: sync: edits made offline are lost on reconnect", pull request "fix(sync): replay offline edits after reconnect", branch "fix/sync-offline-replay".

- **Areas** come from the manifest's `areas` list. Use them consistently. Check the list before adding an area, and add a new one to the manifest in the same change.
- **Big feature initiatives** start with a tracking issue (`<Initiative>: tracking, overview and story list`); each story is numbered `<Initiative> <N>`.
- **Labels:** use only labels that already exist in the tracker. Never create one without the operator's request.
- **Pull request body:** a Summary (what changed and why), Changes (bullets), Files Changed (a `File | Change` table), a Test Plan (checkboxes for the verification actually run), and a closing line `closes #<N>`. Verify the issue number with `gh issue list --search "<keyword>"` before writing it.
- **One ticket, one pull request.** Phases of a ticket are commits on that pull request.

## Working Doc Convention (plans and audits)

Implementation plans and audit reports are **working docs, not documentation**. They live in `project-documentation/temp/`, carry a type prefix, and leave the live tree when the work they describe ships:

```
project-documentation/temp/plan - <descriptor>.md
project-documentation/temp/audit - <descriptor>.md
```

The literal `plan - ` or `audit - ` prefix (space, hyphen, space) marks the file as disposable at a glance; the descriptor names the ticket, area or initiative. Quote these paths in shell commands, since they contain spaces. `node checkrein-check.mjs` fails on any other markdown file in that folder except its README.md.

Lifecycle:
1. **Created** when planning or auditing starts: one file per ticket or initiative.
2. **Read** during implementation (the implementing protocol below points here).
3. **Retired** by the `post-merge` skill when the ticket merges: moved into the first protected tree listed in the manifest when there is one; otherwise deleted after the operator confirms (git keeps the history). An initiative-wide working doc is retired when its last open story closes, not on the first merge.

A working doc is never a source of truth. The durable records are the living documents, the GitHub issues, git history and the live codebase. A plan that contradicts them is wrong, and a plan that outlives its ticket is a divergence bug: keeping delivered plans out of the live tree is what stops later agents from following superseded intent.

## Living Documents

| File | Purpose | When it is updated, and by which skill |
|---|---|---|
| `project-documentation/project-brief.md` | Product context: what it is, who it serves, priorities, constraints, what is out of scope | By the operator, when the product direction changes |
| `project-documentation/architecture.md` | Why the system is built this way: the declared stack, mechanisms, decisions, revisit conditions | At decision time, in the same pull request, by whoever makes the decision; `post-merge` cross-checks it |
| `project-documentation/business-rules.md` | Behavioral rules: lifecycles, cascades, gating, calculations | When a pull request changes behavior; `post-merge` cross-checks it, and new rules are added with the operator's sign-off |
| `project-documentation/corrections-log.md` | Anti-patterns, newest first, append-only, indexed by tagged headings | By `post-merge`, for every merged pull request that taught a lesson |
| `project-documentation/current-project-state.md` | What exists right now across every workspace: Part 1 inventory, Part 2 delta log, Part 3 open gaps, Part 4 accepted debt and settled decisions | By `post-merge` on every run: the currency marker always, a delta and in-place inventory corrections when the structural-significance gate fires, a full inventory refresh at a milestone or on request |
| `project-documentation/CHANGELOG.md` | What was built, per merged pull request (Added, Changed, Fixed) | By `post-merge`, for every merged pull request |
| `project-documentation/temp/` | Working docs for in-flight work | Created before implementation; retired by `post-merge` on merge |
| `project-documentation/runbooks/` | Operational procedures: setup, deploy, rollback, integrations | In the pull request that changes the procedure |
| `reference-documentation/` | Vendored library and pattern docs, each folder fronted by an _INDEX.md | When a library is added or upgraded (`package-upgrade`); only the _INDEX.md files are edited by hand |

## Mandatory Skill Protocol

The skills are installed as a plugin or copied into the harness's skills folder: `docs`, `dev-code`, `dev-review`, `github-story-writer`, `package-upgrade`, `post-merge`, `preflight-check`, `structured-debugging` and `init`. Every skill that needs a project value begins with **Step 0: resolve the manifest**: read `checkrein.json`, substitute its values, and stop with a message telling the operator to run `init` if the manifest is missing.

Every skill that reads project files (all but `dev-code` and `init`) then prints a file resolution table of the files they tried to read. **If you do not see the file resolution table in your output, you skipped the check. Run the skill again.**

### Standard File Resolution

| File | When required |
|---|---|
| `project-documentation/corrections-log.md` | Always |
| `project-documentation/current-project-state.md` | Always |

- If a required file is **missing**: stop and ask the operator. Never recreate one by hand; a hand-written replacement is a second copy that drifts from the real one.
- If the corrections log exists but holds no entries: proceed and state "Corrections log checked, no patterns recorded yet."
- A skill may check more files than this table; follow the skill.

### Standard Corrections Log Check

`project-documentation/corrections-log.md` is the single source of corrections: newest first, append-only. Every rule heading has the shape `### Pattern [<domains>]: <failure-mode sentence>` or `### Convention [<domains>]: <convention sentence>`, with domains from the manifest's `domains` list. The headings are the index; it is derived by search at read time, so it never drifts from the entries.

Every skill that reads or writes application code must:

1. Build the index: `grep -nE '^### (Pattern|Convention) \[' project-documentation/corrections-log.md`. On a mature project the index alone runs to thousands of tokens, so read the headings only. Scan every heading, even for domains the task does not touch: headings are full failure-mode sentences, and scanning all of them is what catches rules you would not have known to look for.
2. Pull the entries whose tags or wording match the task's domains or specifics, plus `process`, which applies to every pull request. Read about 40 lines from each matching heading's line number to get the full entry (What went wrong, Correct approach, Rule, Files affected). When unsure whether a rule applies, pull it. Never read the whole file.
3. Applicable rules are **hard constraints**. They override general library documentation where the two conflict.
4. State in your output which rules were relevant, or "no relevant corrections found".
5. Rules are bound to a context; each prevents a specific failure. If the task must deviate from one, name the rule and the reason in the pull request body. Never ignore one quietly.

### When planning work (breaking an initiative into stories)

1. Run the `docs` skill to find the _INDEX.md files for every domain the work touches.
2. Run the Standard Corrections Log Check and carry the known anti-patterns into each story's implementation notes as warnings.
3. Read `project-documentation/current-project-state.md` so every file path, endpoint and model name in a story matches what exists today.
4. Run the `github-story-writer` skill to create the GitHub issues, each with verification steps, a preflight checklist, corrections warnings and the governing rules. Story drafts are never written into the repository: a trivial, fully specified single story is created directly; anything larger is presented to the operator for confirmation first.

### When implementing a story (writing code)

1. Run the `docs` skill **before writing any code, even when the task seems simple.** Its tier gate scales the reading to the change: a prose-only edit or a surgical code edit reads little; a new file, endpoint, model or library surface reads the full index fan-out; a document that embeds or derives from code (a plan, a spec, a runbook) tiers as the code it describes. The tier gate is what keeps small tasks cheap; skipping the skill is what is forbidden.
2. Run the Standard Corrections Log Check.
3. Run the Governing-Docs Check (defined once, in the `docs` skill): pull the sections of `project-documentation/business-rules.md` and `project-documentation/architecture.md` that govern the task, the shared sections plus your own workspace's section. Decided rules are hard constraints; changing one means updating the document in the same pull request with the operator's sign-off, never a silent divergence.
4. Read the ticket's working plan in `project-documentation/temp/` and follow it task by task.
5. After each task, run the verification steps from the story or the plan.
6. **Do not create a pull request yet.** Go to the next section.

### Before creating any pull request

1. Run the `preflight-check` skill. It runs the manifest's lint, typecheck, test, build and format commands, the corrections scan and pattern spot-checks over the files changed since the merge base with the trunk.
2. If the verdict is **BLOCKED**, fix what it names and run it again. Do not create the pull request until it passes.
3. Only after a **PASS** verdict, create the pull request against the trunk with the naming and body rules above.

### When the pull request is created

1. Run the `dev-review` skill. It posts **one consolidated review comment** per round, never inline threads.
2. Each finding is classified as Code Bug, Spec Deviation, Approach Limitation or Pattern Violation, and carries a confidence and a source citation. Findings below the manifest's confidence floor are not posted.
3. A later review round verifies the fixes of the previous round only and widens nothing.
4. Address review findings before merge. Treat each one with the debugging protocol below; do not guess at fixes.
5. **The operator merges every pull request.** The agent never merges, and asks what is meant before acting on an ambiguous instruction such as "ship it".

### When debugging any issue (an error, a test failure, unexpected behavior, a review finding)

1. **Stop. Do not attempt a fix.**
2. Run the `structured-debugging` skill.
3. Its order is fixed: observe, search the docs, search the corrections log, classify (Code Bug, Spec Deviation or Approach Limitation), and only then propose a fix.
4. **If the first fix does not work, run the whole structured-debugging protocol again from observation.** Do not stack fixes or try a second guess.
5. For an Approach Limitation, stop and present the options to the operator. Do not make architecture decisions alone.

### After any pull request is merged

`post-merge` is the **single** documentation-maintenance skill, and it runs **only when the operator asks for it**. Never start it on your own because a merge happened, including a merge you watched. The cadence is the operator's call: after each pull request, or once over a batch.

1. Run the `post-merge` skill.
2. In one pass it writes the issue's completion notes and closes it, appends corrections entries, appends changelog entries, updates the state document, and retires the ticket's working doc (moved into the first protected tree in the manifest when there is one; otherwise deleted after the operator confirms).
3. It orders merged pull requests by merge time, not by number, and uses the merge commit as the state document's currency marker.
4. The state document is touched on **every** run. A pull request that changes no structure still moves the currency marker; only one that passes the skill's structural-significance gate also earns a delta entry and in-place inventory corrections. The gate is defined once, in the skill.
5. It stages its documentation changes and hands them to the operator to commit; it commits to the trunk itself only if this line says so.
6. A backlog of unprocessed merges is handled by running the skill over the backlog; it detects the gap before moving the currency marker.

### Skill quick reference

| Skill | What it does | Reads the codebase? | Reads the corrections log? |
|---|---|---|---|
| `init` | Copies the templates and the check script into the repository and writes the manifest values it asks for | Only to infer manifest values | No |
| `docs` | Routes to the right _INDEX.md, runs the tier gate and the Governing-Docs Check, before any code | Targeted: the module under change | Yes, mandatory |
| `dev-code` | A manual posture lens: think first, keep it simple, keep changes surgical, define success | No | No |
| `github-story-writer` | Turns a spec or plan into GitHub issues with verification steps and warnings | Yes, to verify names and paths | Yes, embeds warnings |
| `preflight-check` | Gates every pull request with a PASS or BLOCKED verdict | Yes, the changed files | Yes, scans for known patterns |
| `dev-review` | Posts one consolidated review comment per round | No, it reads the diff | Yes, checks for repeats |
| `structured-debugging` | Governs every fix: observe, search, classify, then fix | Yes, the source of the error | Yes, checks for known issues |
| `post-merge` | Updates the changelog, the corrections log and the state document, closes the issue, retires the working doc | Only for the state document | Yes, appends entries |
| `package-upgrade` | Governs every dependency change under the exact-pin rule | Yes, the dependency manifests | Yes, for the package and its companions |

`post-merge` owns `project-documentation/CHANGELOG.md`, `project-documentation/corrections-log.md`, `project-documentation/current-project-state.md` and closing the linked issue. It also retires the merged ticket's working doc.

## Claude Code note

This section applies only to Claude Code. The `CLAUDE.md` beside this file imports it through a line holding only the at sign and the file name, so Claude Code loads this hub even where a `CLAUDE.md` exists. A nested `CLAUDE.md` inside `reference-documentation/` or inside a protected tree loads whenever the agent reads a file beneath it, which makes it the right place for a folder-level reminder such as "read the _INDEX.md first" or "archival only". Installed as a plugin, the skills run as `/checkrein:<skill>`.
