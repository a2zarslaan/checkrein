---
name: github-story-writer
description: "Turn a source document (a feature spec, project brief, design decision, bug list or any planning text) into detailed, implementable GitHub issues written like user stories. Run it whenever the operator wants work broken down into trackable items, says 'create stories', 'write issues', 'break this into stories', 'generate issues from this spec', 'make GitHub issues for', 'turn this into stories', or pastes a planning doc and wants tasks, even without saying 'GitHub'. Run it before creating any issue or story breakdown. It reads the manifest, the project brief, the state document (to ground paths, endpoints and models in what exists), the corrections log (known anti-pattern warnings) and the business rules and architecture records (governing rules). It produces real GitHub issues, never draft files in the repository: a single trivial, fully specified story is created directly, and any batch, initiative or ambiguous request is presented in the session first and created only after the operator confirms."
---

# github-story-writer

Turn a source planning document into GitHub-ready stories and deliver them as real GitHub issues. Each story is a standalone, implementable unit of work. The issue itself is the durable record; no draft file is ever written into the repository.

Claude Code note: write each issue body with the Write tool into a temp file and pass it to `gh issue create --body-file`; never build a body with a heredoc.

---

## Step 0: Resolve the manifest

1. Read `checkrein.json` at the repository root.
2. If it is missing or does not parse, stop and tell the operator: "This repository has no checkrein manifest. Run the `init` skill first, then run this skill again." Do not guess paths or commands.
3. Substitute every `{{ref:<dotted.key>}}` token in this skill with the manifest value at that key before acting on any step. Array keys (`{{ref:areas}}`, `{{ref:domains}}`, `{{ref:workspaces}}`, `{{ref:protected_trees}}`) are lists; each step says how the list is used.
4. If `{{ref:project.tracker}}` is not `github`, run Steps 1 to 3 as written, present the stories in the session (Step 4, present-and-confirm format), and tell the operator that issue creation happens in their tracker. Never run the `gh` commands in that case.

### File resolution table

Print this table before going further. Every row is FOUND, MISSING, PROVIDED, or "not required".

| File | Status | Used for |
|------|--------|----------|
| `checkrein.json` | FOUND / MISSING | Every path, command and vocabulary in this skill |
| Source document (from the operator) | PROVIDED / MISSING | The work being broken down |
| `{{ref:paths.brief}}` | FOUND / MISSING | Product context the stories are grounded in |
| `{{ref:paths.state_doc}}` | FOUND / MISSING | Part 1 structural inventory, Part 3 open gaps, Part 4 accepted debt and settled decisions |
| `{{ref:paths.corrections_log}}` | FOUND / MISSING | Known anti-patterns embedded as warnings |
| `{{ref:paths.business_rules}}` | FOUND / MISSING | Governing-rules block (behavior) |
| `{{ref:paths.architecture}}` | FOUND / MISSING | Governing-rules block (mechanism and decisions) |
| `AGENTS.md` (the hub) | FOUND / MISSING | Naming convention and initiative rules |

How to act on each status:

- **Source document MISSING:** ask for it (Step 1). Never write stories from memory or assumption.
- **State document, corrections log, or brief MISSING:** stop and ask the operator. Never hand-recreate one of these records, and never downgrade the stop to a warning and keep writing. A story written without the state document cites files, endpoints and models that may not exist; one written without the corrections log repeats fixed mistakes.
- **Corrections log FOUND but empty:** proceed and state "Corrections log checked: no patterns recorded yet."
- **Business rules or architecture record MISSING:** tell the operator, proceed, and write "Governing rules: record missing, none could be checked" in each story instead of inventing a rule.
- **Hub MISSING or without a naming convention section:** stop and ask the operator. The hub is the single home of the naming convention; never invent one.

A present but suspect state document is a different case and does not stop the run. The document is a snapshot and can drift. When one row looks stale, verify that row against the live code and carry on (Step 2). Verifying a doubtful row is normal practice; it never substitutes for a missing required file.

Never ground a story in anything under `{{ref:protected_trees}}`. Those folders hold retired or frozen material, not current state. Ground every story in the state document, the live code, and the source document.

---

## Step 1: Get the source document

If the operator has not provided a source document (a spec, a brief, a design decision, a bug list, any planning text), ask for one and wait:

> "To write stories I need a source document. Paste or attach the feature spec, brief, or planning notes and I will break it down into GitHub issues."

Once you have it, proceed.

---

## Step 2: Analyze and plan

Read the source document in full. Identify:

- the features or capabilities it describes;
- natural groupings (data model, shared code, service or API, auth and permissions, user interface, devops, tests, docs), and which workspace in `{{ref:workspaces}}` each grouping lands in;
- dependencies between groupings;
- what is explicitly in scope and what is out of scope.

Outline the full set before writing any story. Outlining first prevents both missing stories and overlapping ones.

### Determine the work category

Choose a naming category per story (the table is in Step 3):

- **A big new feature** that needs several PRs: initiative naming, with stories numbered in sequence inside the initiative, and a tracking issue.
- **A list of bug fixes:** bug naming, flat, no numbering.
- **A list of improvements to existing features:** refinement naming, flat, no numbering.
- **Non-code work** (runbooks, records, configuration): docs or chore naming.
- **A mixed batch:** the right category per story. One batch may hold several categories.

If the source document uses an older naming scheme (a phase framing, a retired prefix), the issues still use the current convention.

### Cross-reference the state document

`{{ref:paths.state_doc}}` is the living inventory of what exists. Validate every planned story against it:

1. **File paths.** Every existing file named in "Files to Create/Modify" must match Part 1. If Part 1 records a module at one path and the draft names a near miss (a singular for a plural, an outdated folder name), fix the story. In a project with several workspaces, check the path against that workspace's section of Part 1.
2. **Endpoints and routes.** If a story depends on an endpoint, a route or a screen, confirm it appears in Part 1.
3. **Data models.** If a story names a model or a field, confirm the model in Part 1 and the field in the schema file the state document names as the source of truth. The schema file wins over any prose description of it.
4. **Open gaps and accepted debt.** Check Part 3 and Part 4. If a gap or debt row belongs to this batch, write a story for it or reference it from the story it touches. A Part 4 settled decision is not reopened by a story unless the source document brings new evidence, and the story then names that evidence.

The live code always wins over the snapshot. Before a story hinges on something Part 1 asserts, confirm it in the code: list the path, search the router or controller for the route.

If a dependency does not exist, either add a prerequisite story that creates it, or flag it in the story: "Depends on <thing>, which does not exist yet and must be built first."

---

## Step 3: Write the stories

### Naming convention

The hub's naming convention section is authoritative. Read it and use it for issue titles, PR titles and branch names. Areas come only from `{{ref:areas}}`; reuse an existing area before proposing a new one, and when a new one is genuinely needed, name it in the output so the operator can add it to the manifest. Never add it to the manifest yourself.

If the hub has no naming convention section, stop and ask the operator (see the file resolution table). This skill carries no copy of the table.

When to use each category:

- **Bug fix:** broken behavior. Standalone, no sequence number.
- **Refinement:** an existing feature gets better. Standalone, no sequence number.
- **Initiative story:** one step of a multi-PR feature. Numbered in sequence inside the initiative (1, 2, 3).
- **Docs or chore:** non-code work.

Every pull request targets `{{ref:vcs.trunk}}`, so no story names another base branch.

### Story format

Every story follows this structure. Do not add, remove, or reorder sections.

```
## Story <issue title from the naming convention>
**Category:** <primary area: Data | Shared | Service | Auth | Interface | Testing | Documentation | DevOps> | **Workspace:** <a name from the manifest workspaces> | **Priority:** Must Have / Should Have / Nice to Have | **Track:** <Letter> (<Track name>)

### Description
<Two to four paragraphs: what this story is, why it matters, how it fits the wider system. Tie it to the source document's goals. Write for a developer who has not read the source document.>

### What We Are Building
<An exact breakdown of what gets built. Numbered sections for distinct components. Include interfaces, signatures, request and response shapes, or code sketches where they clarify intent. A reader must know what to implement without reopening the source document.>

### Acceptance Criteria
- [ ] <A specific, testable criterion a developer can literally tick when done>
- [ ] <Another>
<Every criterion is independently verifiable. Never "works correctly".>

### Implementation Notes
- <Concrete technical guidance: which existing modules, patterns and files to follow>
- <The pattern folder under the reference documentation root that applies, named by its index file (see "Point to the patterns" below)>
- <Gotchas specific to this codebase>
- <The corrections-log warning blocks (see "Embed corrections-log warnings")>
- <The governing-rules block (see "Embed governing rules")>
- <The skill prescription (see "Prescribe the skills")>

### Verification Steps
<Concrete commands the implementing agent runs after each sub-task to confirm it works. These are smoke tests during implementation, not acceptance criteria.>

### Preflight Checklist
Before opening a PR for this story, the implementing agent runs the `preflight-check` skill. At minimum:
- [ ] Lint passes: `{{ref:commands.lint}}`
- [ ] Typecheck passes: `{{ref:commands.typecheck}}`
- [ ] Tests pass: `{{ref:commands.test}}`
- [ ] Every verification step above confirmed working
- [ ] The corrections-log heading index checked against this PR's code (grep the tagged headings, pull full entries by line number where context is needed)
- [ ] <Any project-specific check a corrections entry or the hub names for this story's domains>

### Files to Create/Modify
- <Exact repository paths that will be created or changed>

### Dependencies
- <Story title: why this dependency exists>
- <Or: "None. Can start immediately.">

### Notes
<Optional. Open questions, scope callouts, risks. Omit when empty.>
```

Leave out a preflight item whose manifest command is empty, and write "<command> not configured" in its place so the gap is visible.

### Verification steps by kind of story

Every story has verification steps. Never skip the section. Take commands from the manifest, the runbooks in `{{ref:paths.runbooks_dir}}`, and the package scripts the state document records. Never invent a command, a port or a URL; if the project has not recorded how to start something, the step says "start <workspace> the way its runbook describes" and the story's Notes flag the missing runbook.

Minimums by kind:

- **Service or API story:** the service starts without errors; a request to the new or changed endpoint returns the expected response shape (name the method, the path and the fields to check); if the project generates API documentation, the endpoint appears there with its request and response described.
- **User interface story:** the dev server starts without errors; the route or screen renders with no console or runtime errors; one named interaction behaves as specified (for example "submit the form with valid input and the success message appears").
- **Data or schema story:** the migration applies cleanly to a fresh local database; the seed runs without errors; a named query returns the expected count or row, written against the real table names the schema maps to.
- **Shared code story:** typecheck passes across every workspace that consumes it; the new export is imported from one consuming workspace and resolves; the package's own tests pass and every consumer's suite stays green.
- **Docs or chore story:** every path the change cites exists, and any command it hands to the operator runs as written.

A story spanning two kinds carries both sets.

### Labels: existing labels only

List the repository's labels before assigning any:

```
gh label list --limit 200 --json name,description
```

Apply one or more labels from that list to every story, chosen by what the story actually touches, not by its track. A story touching the service and the schema gets both labels if both exist. A story that incidentally documents its endpoint does not get a documentation label; documentation is its label only when docs are the primary deliverable.

Never create a label, and never pass a label that is not in the list. If the repository has no labels, or none fits a story, say so in the presentation and ask the operator which existing label to use; do not create one.

### Tracks

Group the stories of a batch into tracks for the in-session presentation, so the operator sees how they cluster and what can run in sequence. Tracks are a presentation device and never map to labels. Use the tracks the source document needs:

- **Track A: Data** (schema, migrations, seed data)
- **Track B: Shared code** (types, validators, pure utilities used by several workspaces)
- **Track C: Service** (API modules, handlers, background jobs)
- **Track D: Auth and permissions** (sign-in, sessions, roles, guards)
- **Track E: Interface** (pages, screens, components, client state)
- **Track F: DevOps** (CI, containers, deploy, infrastructure)
- **Track G: Testing** (test suites as the primary output)
- **Track H: Documentation** (records, runbooks, specs)

Keep the letters fixed once a project starts using them, because existing issues cite them. When a project has several workspaces, a track per workspace may follow H.

### Point to the patterns

For every story that writes code, name the pattern folder that governs it: the folder under `{{ref:paths.refdocs_root}}` whose index file covers the workspace or library (cite it as `{{ref:paths.refdocs_root}}<folder>/_INDEX.md`). The instruction reads: "Follow the patterns in that folder. Read the closest analog first and adapt it; never invent a pattern the folder does not show." If no folder covers the story, say so in Notes.

### Prescribe the skills

Every story that writes code carries this line in its Implementation Notes:

> Run the `docs` skill before writing any code. Its tier gate scales the reading to the change (the full index fan-out for new surface, the corrections index plus targeted reads for a surgical edit).

User interface stories add: the design source is the pattern folder named above plus the project's central theme; the `docs` skill routes there.

---

## Embed corrections-log warnings

Before writing a story's Implementation Notes, build the corrections index:

```
grep -nE '^### (Pattern|Convention) \[' {{ref:paths.corrections_log}}
```

This prints one line per rule. On a mature project the index alone runs to thousands of tokens, so grep the headings only, never read the log in full. Scan every heading, including domains the story does not obviously touch, because the headings are full failure-mode sentences and a scan catches rules you would not have searched for. Heading tags come from `{{ref:domains}}`; `process` applies to every story.

For each heading whose tags or wording match the story, pull about 40 lines from its line number to read the full entry (What went wrong, Correct approach, Rule, Files affected). When unsure whether a rule applies, pull it. Then:

1. Add a warning block to the Implementation Notes:
   ```
   > **Corrections log:** <the rule, stated as the constraint this story must obey>. Source: the entry "<heading text>" in the corrections log<, recorded from PR #N if the entry names one>.
   ```
   Cite a PR or issue number only when the entry or its section header records one, and confirm it exists first (`gh pr view <N>` or `gh issue view <N>`). Never infer a number.
2. When several rules apply, list each as its own block. Do not merge or summarize them.
3. When the log resolves but is empty, add:
   ```
   > Note: the corrections log has no entries yet. This story is among the first to be implemented.
   ```
   A missing log never reaches this step; it is a stop at the file resolution table.
4. When the log has entries but none apply, add `> Corrections log: no entries apply to this story.`

Never skip this step silently. Every story's Implementation Notes carry warnings, the empty-log note, or the "none apply" line.

## Embed governing rules

Run the Governing-Docs Check defined in the `docs` skill for each story's domains: pull the sections of `{{ref:paths.business_rules}}` and `{{ref:paths.architecture}}` that govern the story's behavior and mechanism. Then:

1. Add a governing-rules block naming each controlling section and quoting the constraint the story must not violate:
   ```
   > **Governing rules:** business rules, section "<section name>": <the decided rule, quoted or tightly paraphrased>. Mechanism: architecture record, section "<section name>".
   ```
2. If the story deliberately changes a decided rule, say so in the Description and require the same PR to update the governing section. That is a decision change and needs the operator's sign-off; it is never a silent divergence.
3. If no section governs the story, write `> Governing rules: none apply to this story.`

This is what stops an implementing agent from re-deriving a settled choice: the decided rule arrives inside the ticket, with its home named for the full context.

---

## Step 4: Deliver (confirm, then create)

Stories are delivered as GitHub issues, never as files. The issue is the durable record; a story draft written into the repository is a second copy that diverges from the issue the moment either is edited. Do not create a stories folder, a draft document, or any story markdown anywhere in the repository, including the working docs folder `{{ref:paths.working_docs_dir}}`, which holds plans and audits only.

### Choose the delivery mode

**Direct-create.** Skip the confirmation round and create the issue at once only when all of these hold:

- the batch is a single story;
- the category is bug fix, refinement, docs or chore, and the area is already in `{{ref:areas}}`;
- no initiative, tracking issue or dependency chain is involved;
- the request fully specified the work, and nothing in the story needed interpretation beyond what Step 2 established.

**Present-and-confirm.** Everything else. Present the full story set in the session (chat output, not a file) in the format below, then wait for the operator to confirm or amend. Create only after explicit confirmation, and create exactly what was confirmed. Improving a story between confirmation and creation defeats the confirmation. If the session is non-interactive and the operator cannot answer, stop after presenting; never create unconfirmed issues.

Why the split: creating an issue is outward-facing and hard to undo. Its number is cited in branches, PRs and completion notes the moment it exists, so anything with room for interpretation gets the operator's eyes first. A confirmation round on "file a bug for the typo on the sign-in page" is friction with no benefit.

### Presentation: summary table first

Open with a table listing every story. The Story ID column carries the naming-convention prefix.

Initiative stories (numbered inside the initiative):

```
## Story Summary

| Story ID | Title | Labels | Priority | Track | Dependencies |
|----------|-------|--------|----------|-------|--------------|
| Shared notebooks 1 | Shared notebooks 1: data: notebook and membership models | `database` | Must Have | A (Data) | None |
| Shared notebooks 2 | Shared notebooks 2: service: notebook sharing endpoints | `backend` | Must Have | C (Service) | Shared notebooks 1 |
```

Bug and refinement batches (flat, no numbering):

```
## Story Summary

| Story ID | Title | Labels | Priority | Track | Dependencies |
|----------|-------|--------|----------|-------|--------------|
| Bug | Bug: editor: autosave fires twice on slow connections | `frontend`, `bug` | Must Have | E (Interface) | None |
| Refine | Refine: search: highlight matched terms in results | `frontend` | Should Have | E (Interface) | None |
```

The labels in these examples stand in for whatever `gh label list` returned.

### Presentation: stories by track

After the table, present the stories grouped by track, each group under its own header (for example `## Track A: Data`). Inside a track, order stories by dependency, with stories that depend on nothing first. A direct-create run skips the presentation but still reports the created issue in full.

### Create the issues

For an initiative, create the tracking issue first (the naming convention's tracking title, with an overview and the story list), then the numbered stories. Cite the tracking issue's number in each story body, and after the stories exist, edit the tracking issue's story list to cite each story's number.

Per story:

1. The issue **title** is the naming-convention line. The **body** is the story structure from Step 3, starting at the `**Category:**` line. Leave the `## Story` header out of the body; it would duplicate the title.
2. Write the body to a temp file and create the issue from that file. Never inline a multi-line body into `--body`, where quoting corrupts it, and never build the file with a heredoc:
   ```
   BODY=$(mktemp)
   # write the story body into "$BODY" with the file-writing capability
   gh issue create --title "<issue title>" --label "<label>,<label>" --body-file "$BODY"
   ```
3. Labels come only from the `gh label list` output. Never invent or create one.
4. Confirm each created issue with `gh issue view <number>`, then report every created number and title to the operator as the final output.

---

## Rules that hold for every story

**No estimates.** No time estimates, size estimates or story points anywhere. They go stale on contact and nothing in this workflow reads them.

**Independently implementable.** Each story is one clear, scoped unit of work. Do not combine unrelated concerns. If a story needs another finished first, record a dependency; do not merge the two.

**One primary area per story.** A feature spanning data, service, auth and interface becomes separate stories. A story that crosses every layer is a sign its scope is too large.

**Use the project's own stack names.** Name libraries and tools exactly as the hub and the architecture record name them. Never name an alternative the architecture record rejected. If the architecture record says a rule lives in two places (for example a validation schema mirrored at a boundary), a story that adds or changes that rule names both places in "Files to Create/Modify".

**Stay inside the source.** A story covers what the source document asks for. An observation about unrelated code goes in the presentation's Notes for the operator to decide, never into a story's scope.

---

## Quality check before delivering

Before presenting or creating anything, confirm:

- The file resolution table was printed, and every required record was FOUND.
- Every story has at least one label, and every label came from `gh label list`.
- Every area is from `{{ref:areas}}`, or a proposed new area is named for the operator.
- Every story is implementable without reading the source document.
- Dependencies are listed explicitly, never implied.
- The summary table matches the stories.
- The delivery mode is right: nothing non-trivial is about to be created without the operator's confirmation.
- No estimates appear anywhere.
- Stack names match the hub and the architecture record.
- Every code story names its pattern folder under `{{ref:paths.refdocs_root}}` and prescribes the `docs` skill.
- Every story has Verification Steps with concrete commands taken from the project's records.
- Every story has a Preflight Checklist.
- Every story's Implementation Notes carry corrections-log warnings, the empty-log note, or the "none apply" line.
- Every story's Implementation Notes carry a governing-rules block or the "none apply" line.
- No story file was written into the repository.
