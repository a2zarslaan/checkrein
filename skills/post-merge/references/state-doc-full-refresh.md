# Full Part 1 refresh of the state document

Load this file only for a **Tier C** run: a milestone, or an explicit request ("refresh state", "snapshot the app", "state doc is stale", "catch up the state doc" after a long gap). Everything a normal run needs, per PR or batched, is in the skill file beside this folder; nothing here is duplicated there. The `{{ref:<dotted.key>}}` tokens in this file resolve from the same manifest the skill read in its Step 0.

Target: {{ref:paths.state_doc}}, which records every workspace in {{ref:workspaces}}.

What makes this procedure different from every other lane: **Part 1 is an inventory claim about the live tree, so it is built from a live scan of the working tree and nothing else.** The changelog describes intent; the tree is reality, and the two drift, because commits that land on {{ref:vcs.trunk}} without a PR never get a changelog section. On any conflict between the tree and any document, including an older version of the state document, the tree wins. Never build Part 1 from memory or from the changelog.

Two exclusions apply to every scan below. Never read or list inside a protected tree in {{ref:protected_trees}}, and never read a file matching {{ref:secret_globs}}. Exclude {{ref:paths.refdocs_root}} too: vendored docs are not the project. Configuration keys are read from the code or the example config that declares them, never from a secrets file.

---

## R1: Identify the gap

Read only the bounded anchors, the same anchored reads the skill's Step 6 uses, never a fixed line range from the top (the document opens with an HTML comment):

```bash
rg -n -m 1 '^# ' {{ref:paths.state_doc}}
rg -n -m 1 '^Current as of: ' {{ref:paths.state_doc}}
rg -n '^## Part |^### ' {{ref:paths.state_doc}}
```

The first two give the title and the marker line; the third gives every Part heading and Part 2 entry with its line number. Then capture four things:

1. Both halves of the marker: the merge commit sha Part 2 is current as of, and the commit Part 1 was last verified at. **The marker's format, and the tie-break when it disagrees with the newest Part 2 entry, are stated once in the skill's Step 6a.**
2. The newest Part 2 entry (entries are newest at the top).
3. The issue numbers in Part 3, for re-verification in R4.
4. The rows in Part 4, for carry-forward in R5.

Step 6a's gap detection has already run in this pass, since it runs on every run. Use its result. What R1 adds is depth: a Tier C refresh processes the whole backlog, so enumerate it fully from the merge-ordered listing:

```bash
gh pr list --base {{ref:vcs.trunk}} --state merged --limit 100 --json number,title,mergedAt,mergeCommit --jq 'sort_by(.mergedAt) | .[] | [.mergedAt, .number, .mergeCommit.oid, .title] | @tsv'
```

**Order and filter by merge time, never by PR number.** A PR opened early and merged late has a low number and a late merge; ordering by number puts it in the wrong place and can hide it from the gap entirely. Every PR that merged after the floor is missing. For each one, read its changelog section and classify it with the structural-significance gate (the skill's Step 2b). Tell the operator how many PRs are missing and which need Part 2 entries **before** writing anything.

---

## R2: Scan the live tree

Run the scans against the working tree on {{ref:vcs.trunk}}, at the commit you will record as *Part 1 verified at* (`git rev-parse HEAD`). Scans are independent and can run in parallel.

Scan **each workspace in {{ref:workspaces}}** under its `root`, then the shared and infrastructure paths outside every root. The categories below are the generic inventory; a workspace scans only the categories it has. The state document's existing Part 1 sections are the contract for what to scan: if it carries a project-specific section, scan for it too, and never drop a section because this list does not name it.

| Category | What to find | How to count it honestly |
|---|---|---|
| Public interfaces | API endpoints, client routes or screens, CLI commands | Search for the declaration itself, line-anchored (`rg -c '^\s*<declaration pattern>' <root>`), so a comment that quotes a declaration is not counted. Where the framework discovers routes by file name, list files with the same globs the router uses, so the scan sees exactly what ships |
| Data model | Models, enums, tables, schema fields | Read the schema source in full during a refresh. A new field on an existing model is invisible to a model count and is exactly what a count-only pass misses |
| Migrations | Every migration, oldest first | List the migrations folder; state the ordering the tool applies |
| Module structure | Modules, packages, their purpose | List module or package definition files, excluding generated code |
| Cross-cutting infrastructure | Guards, middleware, filters, interceptors, scheduled jobs | Search for the registration sites, not only the files: a guard's file says it exists, its registration says it runs. Where order changes behavior, record the order explicitly |
| Configuration | Config namespaces, required keys, environment variables | Read declarations in code or the example config, never a secrets file |
| Shared exports | Every export of every shared package | Read each package's entry points (its barrel, or each subpath in its exports map if it has no single barrel) |
| Tests | Pass counts per suite | Run {{ref:commands.test}} and read the runner's summary lines; see below |
| Production infrastructure | CI workflows, container and image definitions with their pins, runtime version pins, deploy and operator scripts | List the CI workflow folder, every container definition outside excluded trees, every image reference in composition files, and the scripts folder |
| Runbooks | Every runbook | List {{ref:paths.runbooks_dir}} |

Verify absences as well as additions. If a draft Part 1 shows a row the scan does not return, that is stale memory: drop it from the live rows, and make sure a struck-through row names the PR that removed it.

Reconcile every count. A stated total must equal the rows a reader can count in the table it heads. If the scan and the table disagree, one of them is wrong; resolve it before writing. Never publish a raw search number that disagrees with its table.

**Test counts.** There is no scan command on purpose. The rule is stated once at the Part 2 `**Tests:**` bullet in the skill's Step 6b: a count comes from an actual runner summary line, never from a PR body, a changelog section or a source-text search, and a row with no fresh run behind it is left alone. A Tier C refresh is the natural moment to actually run the suites, so run them and read the summary lines.

**Issue status.**

```bash
gh issue view <N> --json state,title
gh issue list --state open --limit 50 --json number,title,labels
```

Run the first for every issue cited in Part 3, and the second as a sweep for gaps opened since the last refresh.

---

## R3: Rewrite Part 1

Overwrite the whole of `## Part 1: Structural inventory` with a fresh snapshot built from R2. **Part 1 is the full inventory, not a diff**: every interface, model and module, changed or not. Marking only what changed is the most common way this section gets destroyed.

Keep the section names and their order exactly as the document already has them; agents rely on stable names. Organize by workspace: one block per workspace in {{ref:workspaces}}, in manifest order, then one block for shared packages and production infrastructure. A workspace added to the manifest since the last refresh gets a new block; a workspace removed from it keeps its block struck through with the PR that removed it, then drops out at the next refresh.

Rules for the rewrite:

- **No recency marks in Part 1.** Part 1 describes one moment; when something arrived is Part 2's job, and Part 2 has the PR link to prove it. Citing a PR inside a purpose note for a specific sub-feature is fine; flagging a row or node as new is not.
- **Retired rows stay**, struck through, naming the PR that retired them. The mark is the signal.
- **Follow the document's own typographic conventions** if it defines them, exactly, and do not invent a mark it does not define.
- **Methodology notes are load-bearing.** Every section that states a count carries, directly under its heading, a short note giving the exact command that produced the number and the counting trap that command avoids. Because a refresh overwrites whole sections, these notes are the easiest thing to lose, and losing one turns a re-checkable number into a bare assertion. **Carry each note forward verbatim.** Regenerate one only when the command itself changed (a new exclusion, a different anchor, a renamed file), and say what changed and why.

The framing at the top of the document (the title, any status line, and any "how to use this document" section) is not regenerated on a refresh. Leave it intact unless the operator asks for a change; it is the document's contract with its readers. The one exception is the marker line, which every run moves (R6).

---

## R4: Refresh Part 3 (open gaps)

One table of open gaps, in the shape the state document's Part 3 already has: `Gap | Issue | Impact`.

Re-verify every row with `gh issue view <N>` before publishing it. A known gap that quietly closed long ago is worse than an omission, because it sends someone to fix something already fixed. A closed gap's row is removed from Part 3, and the closing merge is recorded in that PR's Part 2 entry under `**Gaps closed:** #N`; if the closing PR has no Part 2 entry yet, add the closure to the entry this pass writes for it. Part 3 never keeps a list of closed gaps; Part 2 and git history hold them.

---

## R5: Refresh Part 4 (accepted debt and settled decisions)

Row schema, matching the state document's Part 4 table and the skill's Step 6b: `Item | Shape | Why it stands | Source PR`.

Carry forward everything still unresolved. Mark resolved rows struck through with what closed them rather than deleting them. Sources for new rows:

- PR descriptions noting deferred work, follow-ups or future work.
- Changelog sections recording a trade-off accepted in review.
- Follow-up issues opened by a PR.
- Any corrections-log rule a merged PR knowingly broke, **from a PR at any tier**. Debt recording is not gated on structural significance (the skill's Step 4), so a docs-only PR in the catch-up window can owe a Part 4 row while owing no Part 2 entry. Part 4 is the only place the project records "we shipped this knowing it breaks a known rule", so it must not be dropped.
- Settled decisions a review recorded as Record dispositions: the shape, why it stands, and the source PR.

---

## R6: The marker

The marker's exact format, its two halves, and the gap detection that precedes any rewrite are stated once in the skill's Step 6a; read it there rather than reproducing a template here. What is specific to a refresh: **Tier C is the only run that moves the *Part 1 verified at* half.** Set it to the trunk commit R2 scanned, because R2 just re-derived Part 1 from that tree, which is exactly the claim the half makes. Set the *Current as of* half to the merge commit sha of the last PR logged in this pass.

---

## R7: Verification pass before staging

1. Every Part 1 row came from the R2 scan, not from memory, and **every stated total equals the row or tree count a reader can verify by counting**.
2. Every issue number cited was confirmed with `gh issue view <N>`, every PR number with `gh pr view <N>`.
3. Every file path cited exists in the tree.
4. **Every section that states a count still carries its methodology note**, either verbatim or regenerated for a command change you can name. This is the check most likely to catch a botched refresh, because an overwrite drops a note silently while the table under it still looks fine.
5. Nothing in Part 1 claims recency, and every retired row is struck through, names the PR that retired it, and still has its row.
6. Every workspace in {{ref:workspaces}} has its block.
7. The marker carries both halves in the Step 6a format: *Current as of* the last merge sha logged, *Part 1 verified at* the commit R2 scanned.
8. Part 2 entries are newest at the top by merge time.
9. The document still has its four part headings, in order, and its framing is intact.

Then follow the skill's Step 8. Because a refresh **overwrites** a section rather than appending, print a before and after count per category per workspace and get an explicit OK before staging.

---

## Ordering a multi-PR catch-up

Insert **all** Part 2 entries first, oldest merge first so the newest lands on top, then refresh Part 1 **once** against the cumulative tree. Do not insert one entry, refresh, then insert the next: that repeats the expensive work and produces a change nobody can review. One pass, one change set.

---

## Common mistakes

| Mistake | Correct approach |
|---|---|
| Building Part 1 from memory or from the changelog | Run the R2 scan; the tree wins over any document |
| Ordering the backlog by PR number | Order by merge time; a low number can merge late |
| Classifying an infrastructure-only PR as non-structural because no interface changed | Workflows, container definitions, image pins, deploy scripts and runbooks are structural |
| Trusting an unanchored declaration search for a count | Comments can quote declarations; anchor the search and reconcile it with the table's row count |
| Refreshing a test count from a PR body or changelog section | A count comes from a fresh runner summary line; with no fresh run, leave the row alone |
| Listing only what changed when asked for a refresh | Part 1 is the full inventory, changed or not |
| Marking Part 1 rows as new | Recency lives in Part 2 |
| Dropping a methodology note while overwriting its section | Carry it forward verbatim; regenerate only for a command change |
| Skipping a workspace because no recent PR touched it | Every workspace in the manifest gets its block on every refresh |
| Restating changelog narrative in Part 2 | Part 2 is a structural diff; narrative belongs in the changelog |
| Citing PR or issue numbers without verifying them | Verify first; a wrong number looks checkable |
| Refreshing Part 1 between Part 2 inserts | All Part 2 inserts first, then one refresh |
| Deleting a struck-through row to tidy a table | The mark is the signal; the row stays |
| Rewriting the document's framing on each refresh | Leave it intact unless the operator asks |
| Keeping closed gaps in Part 3 | Remove the row; the closing merge is recorded in Part 2 under `**Gaps closed:**` |
| Writing a separate milestone snapshot file | A milestone snapshot is this refresh; the state document is kept current instead of frozen |
