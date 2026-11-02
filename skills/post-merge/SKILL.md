---
name: post-merge
description: The single documentation-maintenance skill for merged pull requests, run only when the operator asks. It reads each merged PR once from the tracker (diff, comments, reviews, linked issues) and in one pass posts completion notes on the linked issue and closes it, extracts anti-patterns into the corrections log, adds a changelog entry, updates the state document (the currency marker on every run; a structural-significance gate decides whether the PR also earns a Part 2 delta and in-place Part 1 corrections; a full Part 1 refresh only at a milestone or on request), and retires the ticket's working doc. It handles one PR or a batch of every PR merged since the last marker, in merge order. Triggers include "run post-merge", "post-merge on PR 42", "that's merged", "close out this PR", "clean up merged PRs", "extract learnings", "update corrections log", "refresh state", "catch up the state doc", "is the state doc current" and "snapshot the app". A merge event alone is never a trigger.
---

# post-merge

## Purpose

After one or more PRs merge, this skill performs the whole documentation-maintenance workflow in a single pass. One read of the tracker data per PR produces up to five outputs:

1. **Issue completion notes**: a structured deviation report posted on the linked issue, then the issue is closed.
2. **Corrections log entries**: anti-patterns extracted from the PR into {{ref:paths.corrections_log}}.
3. **Changelog entry**: one section per PR in {{ref:paths.changelog}}.
4. **State document update**: {{ref:paths.state_doc}} gets a gap check and a currency-marker rewrite on every run, plus a Part 2 delta and in-place Part 1 corrections when the PR passes the gate in Step 2b.
5. **Working-doc retirement**: when {{ref:paths.working_docs_dir}} holds the ticket's `plan - <descriptor>.md` or `audit - <descriptor>.md` and the work is fully delivered, Step 3b moves it out of the live tree.

Those outputs, plus {{ref:paths.business_rules}} and {{ref:paths.architecture}} as same-commit cross-references (Step 7), are the complete write surface. No other skill maintains them.

One state document records every workspace in {{ref:workspaces}}. A project may split the record per workspace by adding files and routing by changed paths, but the default, and what this skill assumes, is one document.

---

## Two rules that govern the whole skill

Everything below inherits from these. Later steps point back rather than restating them.

### Rule 1: Read the codebase only where the output is an inventory claim

The per-PR lanes (issue notes, corrections entries, changelog, the Part 2 delta) are produced **entirely from tracker data**. The diff is the evidence. Do not search across the working tree to write them, and do not run the `docs` skill. That discipline keeps a run bounded and cheap, whether it follows a single merge or batches several. Both cadences are normal, and the fixed setup cost amortizes across a batch.

The exception is **Part 1** of the state document, the snapshot of every interface, data model, module, export and piece of infrastructure in every workspace. Part 1 is not a report of what PRs said; it is a claim about what the live tree *is*. Commits that land on {{ref:vcs.trunk}} without a PR never get a changelog section, so a Part 1 derived from documents is guaranteed to rot. A full Part 1 refresh is therefore derived from a live scan of the working tree and nothing else, by the procedure in [references/state-doc-full-refresh.md](references/state-doc-full-refresh.md). **On any conflict between the live tree and any document, including an older version of the state document, the tree wins.**

Targeted verification is allowed in every lane and is encouraged: before a Part 2 bullet asserts a file path, a route or a module name, confirm it with one listing or one search. What is forbidden on the per-PR path is the full inventory fan-out, not a one-command spot-check.

### Rule 2: State-document cadence has three tiers, keyed to what the PR changed

Every run touches the state document; how much depends on the PR.

| Tier | Fires when | What happens | Cost |
|---|---|---|---|
| **A: Currency marker** | Every run | Gap detection, then rewrite the marker (Step 6a). Plus a Part 4 row if the PR introduced debt, deferred work, or knowingly broke a corrections-log rule; that row is never gated on the structural test | One bounded read of the framing lines, one or two targeted edits |
| **B: Delta and in-place correction** | The PR passes the Step 2b gate | Everything in Tier A, plus a Part 2 entry, in-place correction of the Part 1 rows the PR touched, and removing any Part 3 row the PR closed | Bounded anchor reads, targeted edits, diff-derived |
| **C: Full Part 1 re-verification** | A milestone, or the operator explicitly asks ("refresh state", "snapshot the app", "state doc is stale") | A live-tree scan of the whole inventory, Part 1 overwritten, Parts 3 and 4 re-verified, and the marker's *Part 1 verified at* half moved | Load the reference file and follow it |

**Why Tier B corrects Part 1 in place.** Part 1 is what agents read to answer "what exists right now". If it only updates at milestones, it is wrong for weeks and every agent that trusts it inherits the error. Patching it is affordable because it is not re-derivation: the diff already names the affected rows.

**Why Tier C still exists.** In-place patches accumulate quiet errors: a route removed by a PR classified as non-structural, a commit with no PR at all, a stale row nobody touched. Only a full scan finds those. Tier B keeps the document approximately right continuously; Tier C makes it exactly right periodically.

**Milestones.** A milestone is a launch-grade moment the operator names: a first production release, a major version. It is not a sprint or iteration boundary. A milestone snapshot *is* a full Part 1 refresh.

---

## When to run

- On explicit operator request, after one or more PRs have merged. That is the only trigger. A merge event alone never starts this skill, including a merge the agent just watched happen.
- Docs-only and polish PRs qualify like any other; the Step 2b gate keeps them cheap.
- Any state-document request: "refresh state", "catch up the state doc", "is the state doc current", "log PR 42 to the state doc".
- Batch requests: "clean up merged PRs", "close out this PR", "extract learnings", "update corrections log".
- When a structural PR's records are about to be needed by other in-flight work, suggest a prompt run to the operator; do not start one.

## When not to run

- Unprompted. The merge is the precondition; the operator's request is the trigger.
- Before merge. Nothing here applies to unmerged work.
- As a substitute for `dev-review`, which reviews the diff before merge. This skill records what happened after.

---

## Protocol

### Step 0: Resolve the manifest

1. Read checkrein.json at the repository root. If it is missing or does not parse, **stop** and tell the operator: "checkrein.json not found (or invalid). Run the init skill to install it, then re-run post-merge." Do nothing else.
2. Substitute every `{{ref:<dotted.key>}}` token in this skill and in its reference file with the manifest value. Array values ({{ref:domains}}, {{ref:workspaces}}, {{ref:protected_trees}}) are used as lists, as each step describes. If a token's key is absent from the manifest, stop and name the key.
3. Read the hub. Note whether it states that documentation commits go straight to {{ref:vcs.trunk}}; Step 8 depends on that answer, and the default when the hub is silent is **stage and hand over**.

**Then print the file resolution table.** A missing table means the check was skipped.

| File | Required | Status |
|---|---|---|
| {{ref:paths.corrections_log}} | Always | FOUND or MISSING |
| {{ref:paths.state_doc}} | Always (every run gap-checks it and rewrites its marker) | FOUND or MISSING |
| {{ref:paths.changelog}} | Always | FOUND or MISSING |
| {{ref:paths.business_rules}} | When the Step 7a trigger fires | FOUND, MISSING, or not needed |
| {{ref:paths.architecture}} | When the Step 7b gate fires | FOUND, MISSING, or not needed |
| {{ref:paths.working_docs_dir}} | Listed in Step 3b | FOUND or MISSING (missing means nothing to retire) |

If an Always file is missing, **stop and tell the operator**. Never recreate one by hand: a hand-written header is a second copy that drifts. If git history has it, offer to restore it verbatim (`git show {{ref:vcs.trunk}}:<path>`); if it never existed, the operator runs `init`.

### Step 1: Set up the tree, the index and the scope

**Start on {{ref:vcs.trunk}}, before reading anything else.** If the working tree is dirty, stop and ask; when the dirty files are this skill's own staged output from an earlier run, ask the operator to commit it first. Otherwise run `git switch {{ref:vcs.trunk}} && git pull --ff-only`. Every later read must see the merged tree. Never switch branches after a read has seen a different tree; that is how a Part 1 built from a feature branch reaches trunk.

**Build the corrections index**, before processing any PR:

```bash
rg -n '^### (Pattern|Convention) \[' {{ref:paths.corrections_log}}
```

This one index serves three consumers: the duplicate check in Step 4, the repeat-violation scan of the diff, and the Part 4 debt check in Step 6. Scan every heading, including domains the PR does not touch; headings are full failure-mode sentences, and reading all of them surfaces rules nobody would have thought to search for. On a mature project the index runs to thousands of tokens, and that is still the cheap path: read headings only, and when an entry's exact wording matters, read about 40 lines from its heading's line number. **Never read the corrections log in full.**

**Session context reuse.** If `dev-review` or another skill earlier in this session already fetched a PR's diff, its view or list output, its issue view, or the corrections index, reuse those results. Two carve-outs: write targets (the changelog, the corrections log, the state document) are re-anchored at write time by the bounded reads in their steps, never from a cached read; and a Tier C scan always runs fresh.

**Scope.** The operator names one PR ("post-merge on PR 42") or a batch ("clean up merged PRs"). On every run, list the merged PRs once, **ordered by merge time, never by PR number** (numbers are assigned at creation, and PRs routinely merge out of order). This listing feeds both the batch and the gap check in Step 6a:

```bash
gh pr list --base {{ref:vcs.trunk}} --state merged --limit 50 --json number,title,mergedAt,mergeCommit --jq 'sort_by(.mergedAt) | .[] | [.mergedAt, .number, .mergeCommit.oid, .title] | @tsv'
```

For a batch, read the state document's marker and newest Part 2 heading now (the bounded anchor reads in Step 6), find the floor as Step 6a describes, and take every PR that merged after it. Run Steps 2 to 7 per PR, oldest merge first, then one combined Step 8.

**Idempotency probe.** Before processing a PR, check every write target with anchored patterns. A bare substring such as `#7` also matches `#70` and `#71`; the anchors below end in a colon, which no longer number can continue past.

```bash
rg -n '^## PR #<number>:' {{ref:paths.changelog}} {{ref:paths.corrections_log}}
rg -n '^### PR #<number>:' {{ref:paths.state_doc}}
rg -n '^Current as of: <merge commit sha>' {{ref:paths.state_doc}}
gh issue view <issue> --json comments --jq '.comments[].body' | rg -n '^## Completion notes: PR #<number>:'
```

The changelog hit is decisive, because every run writes a changelog section. If the PR already appears in the targets its lanes would have written, warn and skip it unless the operator confirms reprocessing. **Re-run the probe immediately before the first write for that PR**, whichever write comes first (the issue comment in Step 3, or, when the PR has no linked issue, the Step 3b move or the Step 4 entry): a second session can process the same PR while this one is still reading.

### Step 2: Gather PR data (single read)

Fetch everything up front; do not re-read the PR later.

```bash
REPO_URL=$(gh repo view --json url -q .url)
gh pr view <number> --json number,title,body,mergedAt,mergeCommit,headRefName,baseRefName,files,url,closingIssuesReferences
gh pr diff <number>
gh pr view <number> --comments
gh api "repos/{owner}/{repo}/pulls/<number>/reviews"
```

Record the merge commit sha (the `oid` field of `mergeCommit`); it is the currency marker this PR earns.

**Mapping the PR to its issues.** In this order:

1. `closingIssuesReferences`, the link the tracker itself recognizes.
2. The PR body footer: `closes #N`, `fixes #N`, `resolves #N`.
3. A keyword search (`gh issue list --search "<distinctive phrase>" --state all`), confirmed with `gh issue view <N>` before use.
4. If still unclear, list the candidates and ask the operator.

If the PR body or the issue references a working doc in {{ref:paths.working_docs_dir}}, read it: Step 3 compares plan against actual, and Step 3b retires it. If the reference points into a protected tree in {{ref:protected_trees}}, the doc was already retired; do not read it. Compare against the issue body and the PR body instead, and if the comparison genuinely needs the plan, ask the operator to supply it.

**Name the workspaces the PR touched** by matching its changed paths against each `root` in {{ref:workspaces}}. Paths outside every root are shared or infrastructure. Steps 4 and 6 use this.

### Step 2b: Classify structural significance (the gate)

This decides whether Tier B fires. **This is the single definition of structural significance in checkrein**; the hub and the state document say in one line what the gate is for and point here. If the criteria change, they change here and nowhere else.

Classify each PR into exactly one bucket, from the file list and diff already in hand:

- **Structural: interface and data shape.** The PR added, removed or renamed at least one public interface (an API endpoint, a client route or screen, a CLI command), a data model, a migration or a schema field, a module or package boundary, an access-control guard or middleware, a scheduled job, an exported symbol of a shared package, or a whole workspace. **Tier B fires.**
- **Structural: deploy and infrastructure shape.** The PR added, removed or rewrote a CI workflow, a container or image definition, a service in a composition file, a pinned runtime or image version, a deploy, rollback or operator script, a runbook in {{ref:paths.runbooks_dir}}, or a required configuration key or environment variable. **Tier B fires**, and the Part 1 infrastructure rows are the ones corrected. A PR can be heavily structural with no interface change at all: replacing the deploy model touches no endpoint, and skipping its entry would leave "how does production deploy?" answerable only by git archaeology.
- **Structural: release shape.** For a workspace that ships a built artifact (a mobile app, a desktop app, a published package), the PR changed a native capability or platform permission, a build or release profile, the version source, or recorded a release. **Tier B fires.**
- **Non-structural.** Polish, bug fix, copy change, internal refactor, test-only change, a version bump inside an existing pin, docs. **Tier A only.** The changelog carries the narrative. Non-structural does not mean untouched: the marker moves on every run, and a Part 4 row is added whenever the PR earned one.

State the classification and its reason, and the workspaces it applies to, before proceeding. A batch classifies each PR separately.

### Before the first write: re-probe

Re-run the idempotency probe (Step 1) now, before any write for this PR. This runs on every PR, including one with no linked issue whose Step 3 is skipped.

### Step 3: Post issue completion notes

Compare what the PR changed against what the linked issue or working doc specified. The deviations are the valuable part: they are what a future reader cannot reconstruct from the diff.

Post this comment on each linked issue:

```markdown
## Completion notes: PR #<number>: <PR title>

**Merged as:** `<merge commit sha>` | **Branch:** `<head branch>` | [PR #<number>](REPO_URL/pull/<number>)

### Deviations from the original requirements

1. **<Short deviation title>.** <What was planned and what was implemented. Be specific: field names, counts, values.>
   - **Impact:** <What this means for future work>

[If none: "No deviations from the original requirements."]

### What matched
- <Item that matched the spec>
```

Then post and close:

```bash
gh issue comment <issue> --body-file <notes file>
gh issue close <issue> --reason completed
```

If the issue is already closed, skip it without error. If the PR has no linked issue, warn and skip this step only; the re-probe above and every other lane still run.

### Step 3b: Retire the delivered working doc

Working docs have a lifecycle: they sit in {{ref:paths.working_docs_dir}} while work is in flight, and this step is where they leave the live tree. A delivered plan left in place is a divergence hazard: the next agent finds it, trusts it, and implements superseded intent.

1. List candidates in {{ref:paths.working_docs_dir}}. Match `plan - <descriptor>.md` and `audit - <descriptor>.md` names against this PR's ticket (issue number, initiative name, or area). **No match is the normal case**: say "no working doc to retire" and continue. If several plausibly match, ask the operator.
2. **Completeness guard.** A doc scoped to one ticket retires now. A doc scoped to a multi-story initiative retires only when its last story closes: check open issues for that initiative, and if any remain, leave the doc and note "working doc retained: N stories still open".
3. **Destination.** If {{ref:protected_trees}} is non-empty, move the doc into the first protected tree, under `<protected tree>/plans/` or `<protected tree>/audits/` by type, stripping the type prefix (the destination folder encodes it). Quote the source; it contains spaces:

   ```bash
   git mv "{{ref:paths.working_docs_dir}}plan - <descriptor>.md" "<first protected tree>/plans/<descriptor>.md"
   ```

   Create the destination folder first if it does not exist (`mkdir -p "<protected tree>/plans"`); that writes into the tree without reading it. `git mv` without `-f` refuses to overwrite, and that refusal is the collision check: never list or read the protected tree to look first, since nothing in this step needs its contents. If the destination exists, retry with the issue number suffixed (`<descriptor>-<issue>.md`) rather than overwriting history.

   If {{ref:protected_trees}} is empty, there is no archive. Ask the operator to confirm deletion, naming the file, and only on a yes run `git rm "<path>"`. Git history keeps the content.
4. The move is the whole operation. Never edit the doc on the way out; once moved it is archive material.
5. A stale working doc whose ticket closed in an earlier session retires the same way. Do it when noticed and say so in the summary.
6. Anything in {{ref:paths.working_docs_dir}} that is not a `plan - ` or `audit - ` file (a README, a staging folder) is not a working doc. Never move it; mention any leftover in the summary.

On a batch run this step runs per PR, after that PR's Step 3.

### Step 4: Extract corrections log entries

Scan four sources for patterns worth capturing:

- Review comments that flagged a pattern violation or anti-pattern.
- Suggestions that led to code changes.
- Self-corrections: follow-up commits in which the author fixed their own mistake.
- **Known patterns from the existing index appearing in the diff**, even where no reviewer commented. A silently repeated known mistake is the most valuable thing this skill catches.

**Extraction gate. Extract only if all three hold:** the mistake would realistically recur (a pattern, not a typo); it can be stated as a concrete, mechanically checkable rule; and it is backed by reference documentation or a recorded decision rather than preference. Skip typos, formatting-only changes, unbacked style preferences and one-off bugs.

**Duplicate check.** Compare the candidate rule against the Step 1 index. Headings are compressions, so before declaring a pattern new, also search the log for two or three distinctive keywords from the candidate (an API name, a file kind, an error code). On a possible match, read about 40 lines from that heading's line number and compare wording. If an equivalent rule exists, add a `**Recurrence:**` line naming this PR to the existing entry instead of a new entry; if the new instance adds real nuance, fold it into the existing entry and name the PR.

**Entry format:**

```markdown
## PR #<number>: <PR title>

**Merged as:** `<merge commit sha>` | **Issues:** [#<n>](REPO_URL/issues/<n>)

### Pattern [<primary domain>, <secondary domain>]: <one sentence naming the failure mode>

- **What went wrong:** <one or two sentences describing the mistake>
- **Correct approach:** <one or two sentences, with a snippet if it helps>
- **Rule:** <an imperative: "Always X" or "Never Y">
- **Files affected:** <the files from this PR>
- **Reference:** <a path under {{ref:paths.refdocs_root}} or a decision section, if one applies>
```

Use `### Convention [...]:` instead of `### Pattern [...]:` when the entry records a convention rather than a failure mode. The four labels from What went wrong to Files affected are required and appear in that order; the checkrein check enforces the heading grammar and the field order.

**Heading discipline.** The heading is the index line, and for most future agents the only part of the entry they will read. Write the failure mode as a full sentence, not a topic label. Tag it from the closed vocabulary {{ref:domains}} only: the primary domain follows the **Files affected** paths, and secondary tags are added only for domains the rule genuinely constrains. If no listed domain fits, use the closest one and suggest a manifest addition in the summary; never invent a tag. Headings are grep keys for cross-references: never paraphrase an existing heading when citing it, and never rename one.

**Writing the Rule.** Future agents follow it literally. Make it imperative, specific (exact paths and names, not "use the correct import"), self-contained, and mechanically checkable.

**Insert at the top.** The corrections log is newest first. Read its first 60 lines to find the end of the header block (the closing `-->` of the grammar comment, and any divider below it), then insert the new block directly above the first existing `## ` heading after that point, or at the end of the file if there is none. Do not read beyond the anchor region.

Never delete entries. Only insert, add `Recurrence` lines, fold nuance into an entry, or correct a misassigned domain tag. If the log has formatting defects, repair them as part of the update; the check depends on the grammar.

**If this PR knowingly violated an existing rule**, also record a Part 4 row in Step 6 naming the rule. This is not gated on Step 2b: a docs-only PR that ships against a known rule earns a row exactly as a structural one does, and so does any PR that defers work or accepts a trade-off.

### Step 5: Add the changelog entry

The changelog is newest first by merge time, one `## ` section per merged PR. The file opens with an HTML comment whose grammar and example lines also begin with `## `, so anchor past it first: find the comment's closing line with `rg -n -m 1 '^-->' {{ref:paths.changelog}}`, then find the first real section after it with `rg -n '^## ' {{ref:paths.changelog}}`, taking the first match whose line number is greater. Read about 40 lines around that point and insert the new section directly above the current newest section (below the file's title and intro). If no `## ` heading follows the comment, the changelog has no sections yet: replace the `No merged PRs recorded yet.` placeholder line with the new section. Never read the file in full. Processing a batch oldest merge first, each inserting at the top, leaves the newest merge on top.

```markdown
## PR #<number>: <PR title>

**Merged as:** `<merge commit sha>` | [PR #<number>](REPO_URL/pull/<number>) closes [#<n>](REPO_URL/issues/<n>)

### Added
- <One line per item>

### Changed
- <What changed, with a brief deviation note where relevant>

### Fixed
- <What was fixed>
```

Include a subsection only when it has items. One line per item, no paragraphs. Preserve all existing content.

### Step 6: Update the state document

Read {{ref:paths.state_doc}} only through bounded anchors, never in full:

```bash
rg -n -m 1 '^# ' {{ref:paths.state_doc}}
rg -n -m 1 '^Current as of: ' {{ref:paths.state_doc}}
rg -n '^## Part |^### ' {{ref:paths.state_doc}}
```

The document opens with an HTML comment that explains its contract; these anchored reads skip it, so never read a fixed line range from the top. The first two reads give the title and the currency marker. The third gives every section and Part 2 entry heading with its line number, including the newest Part 2 entry, which 6a needs. Read only the region you need.

**6a: Tier A, always. Gap detection, then the marker.**

The marker is the first non-blank line after the title, in exactly this shape:

```markdown
Current as of: <merge commit sha> (PR #<number>). Part 1 verified at: <commit sha, or never>.
```

The two halves carry two guarantees one value cannot express:

- **`Current as of`** is how far Part 2 reaches: the merge commit sha of the last PR logged. It moves on every run.
- **`Part 1 verified at`** is the trunk commit the inventory was last re-derived against. It moves **only on a Tier C refresh**. A fresh document reads `never` until its first Tier C, and a Tier A or B run leaves it unchanged.

A fresh document's first half may hold a short description instead of a sha (the template installs `Current as of: template install, no merges recorded yet`); the first run rewrites it to this shape and adds `Part 1 verified at: never`. If the marker appears in any other shape, rewrite it to this one.

*Gap detection runs on every run, before any rewrite.* The anchored reads above already supplied both inputs.

1. Find the floor. Take the PR whose merge sha matches the marker, and the PR of the newest Part 2 entry. Look both up in the merge-ordered listing from Step 1. **If they disagree, whichever merged later is the floor**: either something was logged without a marker update, or the marker moved past a PR that never got an entry. If the marker holds a description rather than a sha and Part 2 is empty, there is no floor and no gap. If the marker sha is older than the listing reaches, raise `--limit`; `git rev-list --first-parent <marker sha>..{{ref:vcs.trunk}}` cross-checks what landed after it.
2. Every PR that merged after the floor and before the PR being logged is a gap. If there are any, **name them to the operator, say the document is behind by N PRs, and offer a batch catch-up before rewriting anything.**

**Why this blocks the rewrite.** A stale marker is visibly stale, and a reader knows to distrust the document. Moving the marker past PRs that were never processed turns visible staleness into a false claim: the document now asserts coverage it lacks, and every agent that reads it inherits the claim with no way to detect it. Being behind is a known state; claiming currency you lack is a broken one.

*Non-structural PRs end the state-document lane here.* Say plainly: "Non-structural: marker set to `<sha>` (PR #N), no Part 2 entry, no Part 1 edits." That is the correct and complete outcome. It ends the state-document work only; continue to Step 7. One carve-out: if the PR earned a Part 4 row (Step 4), add it before stopping, using the schema in 6b.

**6b: Tier B, structural PR.** Everything in 6a, plus these targeted edits.

*Part 2 entry.* Insert at the top of Part 2, directly under its intro. On a catch-up, process oldest merge first so the newest lands on top.

```markdown
### PR #<number>: <one-line intent>

Merged as `<merge commit sha>`. Workspaces: <names from {{ref:workspaces}}, or "shared">. Structural changes only:
- **+N interface(s):** `<METHOD /path>` or `<route>` or `<command>`: short description
- **-N interface(s):** `<old path>` removed (folded into `<new path>`)
- **+N model(s) / schema field(s) / migration(s):** `<Model.field>` type; `<migration name>`
- **+N module(s) / guard(s) / scheduled job(s):** `<name>` at `<path>`
- **+N shared export(s):** `<symbol>` from `<package>`
- **+N workflow(s) / image(s) / script(s) / runbook(s):** `<name>`: one-line purpose
- **Config:** `<KEY>` added or removed
- **Release:** `<version>` to `<channel>` at `<sha>`
- **Gaps closed:** #N
- **Tests:** N total (per workspace or suite), from a fresh runner summary
```

Omit every bullet whose count is zero. Most entries run 5 to 15 lines. Part 2 is a structural inventory diff, not the changelog restated: "added rate-limit handling" belongs in the changelog; "+1 endpoint `POST /notes`" belongs here.

**Test counts.** Write a count only when an actual runner summary line produced it, from a fresh run of {{ref:commands.test}} or the suite in question. Never take a count from a PR body or a changelog section: both describe the tree at merge time and go stale silently. Never count tests by searching source text for test declarations: parameterized tests expand one line into many cases and a naive match catches unrelated calls, so the source count and the runner count disagree in both directions. With no fresh run, leave the existing row alone and say so; an honestly stale row beats a wrong number that looks checked.

*Part 1 rows, corrected in place.* Edit only the rows the PR changed, under the workspace the row belongs to: a new interface row, a new model row, a retired route struck through with the PR that retired it, an updated image pin. This is diff-derived; spot-check each claim with one command per Rule 1 rather than re-scanning. Update any count stated in the section heading so it still equals the rows a reader can count. Follow the typographic conventions the state document defines for itself; where it defines none, Part 1 carries no recency marks (recency is Part 2's job) and retired rows stay, struck through, naming the PR that retired them.

*Part 3.* If the PR closed an issue listed as an open gap, remove that row from the Part 3 table and record the closure as `**Gaps closed:** #N` in the Part 2 entry; Part 2 is the record of the closing merge. If the PR opened a follow-up issue that is a production gap, add a row to the Part 3 table.

*Part 4.* Add any debt the PR introduced: deferred work, accepted trade-offs, follow-up issues, and any corrections-log rule it knowingly broke. Row schema, matching the state document's Part 4 table: `Item | Shape | Why it stands | Source PR`. **This schema applies at every tier**: a non-structural PR that earned a row writes it from 6a.

**6c: Tier C, full Part 1 re-verification.** Fires at a milestone or on an explicit request. **Read [references/state-doc-full-refresh.md](references/state-doc-full-refresh.md) and follow it. Do not attempt a Part 1 refresh from this file**: the reference carries the live-scan method for every workspace, the Part 3 and Part 4 procedure, and the verification pass.

### Step 7: Cross-reference business rules and the architecture record

Two independent cross-references, each with its own gate. Most PRs fire neither.

**Restatement sweep, whenever 7a or 7b fires.** Updating the section where the rule lands is half the edit. Search both records for the identifiers the diff touched (class names, constants, error codes, endpoint paths, config keys) and correct or repoint every restatement in the same change: `rg -n '<identifier>' {{ref:paths.business_rules}} {{ref:paths.architecture}}`. Sweep identifiers, not concepts. A restatement left behind is a stale second copy the next agent will trust.

**7a: Business rules.** Fires when any one of these is true:

- the diff changed behavior: validation, access checks, default values, calculations, cascades, lifecycle transitions, error codes;
- the PR's changelog section mentions a business rule;
- a linked issue records a behavioral decision.

Do not narrow this to one kind of file. A rule lands as easily in middleware, a schema cascade, a validation schema or a shared constant as in a service, and a rule decided in an issue thread may touch no code at all. If a rule is new, changed or stale, update {{ref:paths.business_rules}} in the same change as everything else. Say either "business rules reviewed: no new rules detected" or list what changed.

**7b: Architecture record.** Deliberately narrow: fires **only when the PR makes, changes or retires an architectural decision**:

- the PR body or a linked issue records an explicit choice between alternatives about platform, mechanism or infrastructure; or
- the diff changes a mechanism that {{ref:paths.architecture}} documents (check the touched areas against `rg -n '^##' {{ref:paths.architecture}}`); or
- the diff adds or removes an infrastructure component.

Implementing a feature within existing decisions does **not** fire it; that restraint keeps the record a decision log rather than a second changelog. When it fires, the decision's author has usually already updated the record, so the usual job is to verify the section matches what merged, and to write or correct it only if not. Superseded decisions are rewritten or removed in place, never annotated. Say either "architecture record reviewed: no decision changes" or list what changed.

### Step 8: Verify, stage, hand over

**Approval is keyed to how much existing text a write overwrites**, not to which lane ran:

- **Appends proceed without asking**: the changelog section, the corrections entry, the Part 2 delta, the issue comment and close. They remove nothing, so any error is fixable by a later append. Stalling a routine run behind a prompt is how the records decay.
- **Single-row in-place edits also proceed without asking**, on a different justification: the marker, a corrected Part 1 row, a Part 3 row removed or added, a Part 4 row. They overwrite text, but a one-row change is reviewable in the diff afterwards. That only holds if the change is visible without reading the diff, so **the summary names every row edited in place** (section plus row identifier, such as `Part 1 > Notes service > POST /notes` or `Part 3 > #12`), never just a count.
- **A whole-section overwrite waits for explicit approval.** A Tier C refresh replaces Part 1 entirely, past the point where a diff review catches an omission. Print a before and after count per inventory category per workspace and get an explicit OK before staging it.

**Then stage.** One change set per run, never split. Stage only the files that changed; a retirement from Step 3b is already staged by `git mv` or `git rm`.

```bash
git add {{ref:paths.changelog}} {{ref:paths.corrections_log}} {{ref:paths.state_doc}}
```

Add {{ref:paths.business_rules}} and {{ref:paths.architecture}} only if Step 7 changed them. Suggested commit messages:

- Tier A only: `docs: post-merge updates for PR #<N>`
- With a Part 2 delta: `docs: post-merge updates for PR #<N> with state delta`
- Batch: `docs: post-merge catch-up through PR #<N>`
- Batch with a Tier C refresh: `docs: post-merge catch-up through PR #<N> with state refresh`

**Default: stage and hand over.** Print the suggested message and stop; the operator commits. Commit and push to {{ref:vcs.trunk}} yourself only when the hub explicitly says documentation commits go straight to trunk (Step 0). Do not open a PR for them yourself; how the staged change reaches trunk is the operator's call.

Never edit the hub from this skill. If the run suggests a hub change, put it in the summary. If the PR touched the skills folder, flag in the summary any skill catalogue the hub names, since nothing else keeps it in step.

Print the summary:

```
## Post-merge summary

### PRs processed (merge order)
| PR | Merge sha | Issue | Classification | Issue status | Corrections | Changelog | State document |
|----|-----------|-------|----------------|--------------|-------------|-----------|----------------|
| #41 | a1b2c3d4e5f6 | #12 | Structural (interface) | Closed | 1 new | 2 Added | Part 2 entry, 3 Part 1 rows |
| #39 | f6e5d4c3b2a1 | #10 | Non-structural | Closed | 0 (1 recurrence) | 1 Fixed | Marker only |

### Corrections log
- New entries: <count> | Updated: <count>

### Changelog
- Sections added: <count>

### State document
- Gap check: floor was PR #<N> (`<sha>`); <"nothing in between" | "PRs #A, #B unprocessed: catch-up offered or run">
- Part 2 entries added: <count>
- Rows edited in place: <each named, or "none">
- Part 1 fully refreshed (Tier C): yes or no
- Marker: Current as of `<sha>` (PR #<N>); Part 1 verified at <unchanged unless Tier C ran>

### Working doc
- <moved `plan - <descriptor>.md` to <destination> | deleted on operator confirmation | "retained: N stories still open" | "none found">

### Corrections rules applied
<the relevant rules, or "no relevant corrections found">

### Hand-over
<"Staged; suggested message: ..." or "Committed and pushed per the hub">
```

---

## Error handling

- **No manifest**: stop at Step 0 and tell the operator to run `init`.
- **No linked issue**: warn, skip Step 3 only, run every other lane.
- **Tracker CLI not authenticated**: stop and tell the operator. Nothing here works without it.
- **Diff too large to read**: work from the file list and PR description, flag for manual review, and say in the summary that the corrections scan was file-list only.
- **Issue already closed**: skip silently; the run is idempotent.
- **An Always file missing**: stop and ask (Step 0). Never recreate it by hand.
- **Merged PR with no changelog section** (a catch-up over PRs from earlier sessions): derive intent from the PR body and write the missing section in this run.

---

## Key behaviors

1. **Single pass over PR data.** Read each PR once in Step 2 and produce every output from that read.
2. **Codebase reading is confined to Part 1**, as Rule 1 draws the line.
3. **Always scan the diff against the corrections index**, even when reviewers left no comments.
4. **Merge order, merge sha.** Order by `mergedAt`, never by PR number, and mark currency with the merge commit sha.
5. **Exact anchors.** Every idempotency probe matches a heading that begins with the PR number followed by a colon, and runs again right before the first write.
6. **Preserve existing content.** Insert and append; never overwrite, except a Tier C Part 1 refresh, which waits for approval.
7. **Verify every PR and issue number before citing it** (`gh pr view <N>`, `gh issue view <N>`). A wrong number is worse than none because it looks checkable.
8. **Link every PR and issue reference** in output files and comments, built from `REPO_URL`.
9. **Cite stable anchors, never line numbers.** A file plus a heading or row survives; a line number rots inside the change that writes it.
10. **Never read a protected tree** in {{ref:protected_trees}} or a file matching {{ref:secret_globs}}. The one write into a protected tree is the Step 3b move.

---

## What this skill owns

| Record | Role |
|---|---|
| {{ref:paths.changelog}} | Per-PR narrative, written every run |
| {{ref:paths.corrections_log}} | Anti-pattern log, written when the extraction gate passes |
| {{ref:paths.state_doc}} | Structural record of every workspace: marker every run, Part 2 and Part 1 rows when the gate fires |
| The linked issue | Completion notes and close |
| The ticket's working doc in {{ref:paths.working_docs_dir}} | Retired by Step 3b once the work has fully shipped |
| {{ref:paths.business_rules}} | Same-change cross-reference when behavior changed (Step 7a) |
| {{ref:paths.architecture}} | Same-change cross-reference when a decision changed (Step 7b) |

## What this skill does not touch

| Item | Owner |
|---|---|
| The hub | The operator. Surface suggestions; never edit. |
| PR review comments | `dev-review`, before merge |
| Source code in any workspace | Never modified; read only as Rule 1 permits |
| Protected trees in {{ref:protected_trees}} | Never read; the only write is the Step 3b move |

If a run surfaces something outside these lanes (a stale plan, an outdated runbook), report it in the summary rather than writing across lanes.

---

## Dependencies

- The tracker CLI (`gh`) authenticated with repository access.
- Git configured, with push access to {{ref:vcs.trunk}} only if the hub has the skill commit.
- The manifest and the three Always files present.
- [references/state-doc-full-refresh.md](references/state-doc-full-refresh.md), loaded only for a Tier C refresh.

Claude Code note: read bounded regions with the Read tool's `offset` and `limit`, make in-place edits with the Edit tool, and run the shell commands above with Bash.
