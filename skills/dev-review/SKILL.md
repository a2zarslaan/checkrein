---
name: dev-review
description: "Review a pull request against the project's recorded patterns and decisions, then post one consolidated review comment. Run it right after a pull request is created, or when the operator says 'review PR', 'review PR #<n>', 'check my PR', 'code review', 'review this against patterns', 'does this follow the docs', or asks for a re-review after fixes. It reads the manifest, the PR diff and its linked issue through the tracker's CLI, the corrections log heading index and matching entries, the governing sections of the architecture and business rules records, Part 4 of the state document, and the reference indexes for the touched domains. It produces a single review comment, never inline threads, in which every finding is classified as Code Bug, Spec Deviation, Approach Limitation or Pattern Violation, carries a confidence at or above the manifest's floor and a cited source, and each observation about untouched code ends as Fold, Record or Drop. Later rounds verify the previous round's fixes and widen nothing."
---

# dev-review

## Purpose

Review the changes in one pull request against the project's own records and post the result as **one consolidated comment** on the pull request. The review checks that the diff follows the patterns in `{{ref:paths.refdocs_root}}`, the decided rules in `{{ref:paths.business_rules}}` and `{{ref:paths.architecture}}`, the conventions in the hub, and the anti-patterns in `{{ref:paths.corrections_log}}`. It is not a linter or a style checker. Findings are advisory: the author and the operator decide what to act on.

The skill runs in rounds. Round 1 is the full review. Every later round verifies the fixes for the previous round's findings and nothing else.

Claude Code note: this skill is unrelated to the built-in /code-review command; the agent reads with Read, searches with Grep, and runs commands with Bash.

---

## Step 0: Resolve the manifest

1. Read the manifest, checkrein.json at the repository root.
2. If it is missing or does not parse, STOP and tell the operator: "checkrein.json was not found (or is not valid JSON) at the repository root. Run the init skill first, then run dev-review again." Do not guess values.
3. Substitute every `{{ref:<dotted.key>}}` token in this skill and in its reference files with the manifest value at that key. An array key (such as `{{ref:domains}}`) resolves to the whole list; the text says how the list is used.
4. A key that resolves to an empty string or an empty list is "not configured". Note it in the file resolution table and skip the step that needs it, saying so in the review.

## Step 1: File resolution

Print this table before doing anything else, with FOUND, FOUND (empty) or MISSING for each row:

| File | When required | Status |
|---|---|---|
| `{{ref:paths.corrections_log}}` | Always | |
| `{{ref:paths.state_doc}}` | Always | |
| `{{ref:paths.business_rules}}` | Always (the Governing-Docs Check) | |
| `{{ref:paths.architecture}}` | Always (the Governing-Docs Check) | |
| `{{ref:paths.refdocs_root}}<path>/_INDEX.md` | One row per index covering a library or pattern set the diff touches (added in Step 3) | |

- If the corrections log or the state document is MISSING, STOP and ask the operator. Never recreate either by hand: they are long, append-heavy records, and a hand-written copy drifts from the real one.
- If the corrections log is FOUND but has no rule headings, continue and state "Corrections log checked: no patterns recorded yet."
- If a governing doc is MISSING, continue, and state in the review that the Governing-Docs Check ran without it.
- If an `_INDEX.md` that the root index or a parent index points to for a touched library or pattern set is MISSING, STOP and ask the operator whether to continue without it.

**Session context reuse.** Before fetching or reading anything, check what this session already holds. If `preflight-check`, `docs` or an earlier round already loaded the diff, the corrections heading index, pulled entries, or index files, reuse those results. Live pull request state (reviews, the head commit, new commits) always needs a fresh fetch; static reference files do not.

## Step 2: Get the pull request context

The project tracker is `{{ref:project.tracker}}`. The commands below are for `github`, using the `gh` CLI. For another tracker, run the equivalent of each command in that tracker's CLI and keep the same outputs.

Determine the pull request number, in this order:

1. The number the operator gave ("review PR #<n>").
2. The pull request that was just created in this session.
3. The current branch's open pull request: `gh pr view --json number -q .number`. If none exists, STOP and ask the operator for the number.

Fetch the metadata, the diff and the linked issue:

```bash
gh pr view <n> --json number,title,body,baseRefName,headRefName,headRefOid,commits,additions,deletions,files,closingIssuesReferences
gh pr diff <n>
gh pr diff <n> --name-only
gh issue view <issue> --json number,title,body
```

The linked issue is the story-level spec. A working plan for the ticket in `{{ref:paths.working_docs_dir}}` (a file named `plan - <descriptor>.md`) elaborates the issue and is never canonical. When the plan and the issue disagree, judge the code against the issue and the living docs, and report the plan's divergence as its own finding.

Record the head sha (`headRefOid`). The review names the head it reviewed.

**Determine the round.** List this skill's earlier reviews on the pull request by their heading marker:

```bash
OWNER_REPO=$(gh repo view --json owner,name -q '.owner.login + "/" + .name')
gh api "repos/${OWNER_REPO}/pulls/<n>/reviews" -q '.[] | select(.body | startswith("## Review round")) | {id, commit_id, submitted_at, heading: (.body | split("\n")[0])}'
```

No earlier review means this is round 1: continue with Step 3. One or more means this is round N+1, where N is the highest round number in the `heading` values (an "(independent)" round counts by its number): follow [Later rounds](#later-rounds) instead of Steps 3 to 10.

## Step 3: Classify the changed files

1. Assign each changed file to a workspace in `{{ref:workspaces}}`. The workspace whose `root` is the longest prefix of the file's path wins.
2. Tag each file with one or more domains from `{{ref:domains}}`, judged from its path and its content. `process` applies to every pull request.
3. A changed file under any folder in `{{ref:protected_trees}}` is a finding by itself (Pattern Violation) unless the issue names that change. A changed file matching `{{ref:secret_globs}}` is a Code Bug.
4. List every index under the reference root: `find {{ref:paths.refdocs_root}} -name _INDEX.md` (the root index routes; library and pattern indexes may sit one or more levels down). Read each index whose library or pattern set the diff touches, and add a row for each to the file resolution table.
5. From those indexes, read only the specific pattern files the changes need. Never read a whole folder; the index exists so the agent can go straight to the file.

## Step 4: Repeat-pattern check against the corrections log

1. Build the heading index. Never read the corrections log in full; on a mature project the headings alone run to thousands of tokens.

   ```bash
   rg -n '^### (Pattern|Convention) \[' "{{ref:paths.corrections_log}}"
   ```

2. Scan every heading, including domains the diff does not touch. Headings are full failure-mode sentences, and scanning all of them catches rules the agent would not have searched for.
3. For each heading whose tags or wording match the diff's domains or specifics (plus every `process` heading), read about 40 lines from its line number to get the full entry: What went wrong, Correct approach, Rule, Files affected.
4. Search the diff for each pulled entry's anti-pattern. A match is a repeat violation: classify it by what it breaks, cite the corrections heading verbatim, and name the pull request the entry records as its source.
5. Keep the list of entries checked. It fills the Repeat patterns table in the comment.

## Step 5: The Governing-Docs Check

1. Run the `docs` skill's Governing-Docs Check (defined only there) over the diff's changed files: it pulls the sections of `{{ref:paths.business_rules}}` and `{{ref:paths.architecture}}` that govern the behavior or mechanism the diff changes, shared sections plus the touched workspaces' sections. Reuse its result if this session already holds it.
2. A rule that holds for one workspace only belongs under that workspace's heading; one written in a shared section, or a rule for every workspace left under one workspace's heading, is a finding.
3. Verify the diff conforms. A contradiction with a decided rule is a **Spec Deviation**, even when the issue is silent on it. Cite the section.
4. A diff that changes documented behavior while the governing section still describes the old rule is its own finding, even when the new behavior is better. The doc update belongs in the same pull request.
5. List every section checked under "Reference documentation consulted" in the comment.

## Step 6: Settled-items check

Read Part 4 of `{{ref:paths.state_doc}}` (Accepted debt and settled decisions). Each row is a decision already taken, with the reason it stands and the pull request that recorded it. An observation that matches a row is not a finding: cite the row and move on. Reopening a row takes new evidence the row does not already contain, and the finding that reopens it names that evidence.

## Step 7: Review each changed file

1. Read [the cross-cutting checklist](references/checklist-cross-cutting.md). It applies to every pull request.
2. If `{{ref:paths.docs_dir}}review-checklists/` holds a `checklist-<domain>.md` for a domain the diff touches, read it too. Projects add these for their own stack in their own repository, never inside this skill's folder.
3. For each changed file, check the applicable checklist items and the pattern files from Step 3. Flag only real deviations. Do not write findings about code that is correct.
4. Collect observations about code the diff did not touch separately. They are never findings (Step 9).

## Step 8: Evidence and confidence

Every finding needs both of these before it can be posted:

**A cited source.** One or more of:
- a documentation section: the file path and heading in `{{ref:paths.refdocs_root}}`, `{{ref:paths.business_rules}}`, `{{ref:paths.architecture}}`, or the hub;
- a corrections entry: its heading, quoted verbatim;
- a test: the test file and test name that fails, or that is missing for the changed behavior;
- a reproduced command: the exact command run and the relevant lines of its output.

A claim about runtime behavior (a crash, a wrong result, a race) needs a reproduction or a line-by-line trace through the code that proves it. If the agent can produce neither, lower the confidence or drop the finding.

**A confidence from 0 to 100.**
- **90 to 100:** a clear deviation from a documented pattern or rule, with an exact citation, or a reproduced failure.
- **{{ref:review.confidence_floor}} to 89:** a strong match to a documented pattern or rule, where the deviation could still be intentional or depend on context.
- **Below {{ref:review.confidence_floor}}:** do not post it. Not in the table, not under "Not necessarily bugs". The floor comes from the manifest; never substitute a number of your own.

Three findings at high confidence are worth more than ten uncertain ones.

## Step 9: Observations outside the diff

An observation about code the pull request did not touch is never a finding and never an open question for the operator. Decide its disposition yourself, in this review:

1. **Fold:** fix it in this pull request. Only when the fix is certain, small, and inside code the pull request already changes. The review names the fix; the author makes it.
2. **Record:** the observation is accepted debt or a decided rule that a competent reviewer would find again. The review gives the exact text to record and where: a Part 4 row in `{{ref:paths.state_doc}}` (the shape, why it stands, the source pull request) or a sentence in the governing section of `{{ref:paths.business_rules}}` or `{{ref:paths.architecture}}`. The author adds it in this pull request.
3. **Drop:** a one-off preference not worth recording. The review states in one line why it was dropped.

The test between Record and Drop is whether a competent reviewer would find it again. A visible structural shape gets recorded, because otherwise every round finds it and decides it again. A wording preference gets dropped.

An observation that matches a Part 4 row is cited, not raised (Step 6).

## Step 10: Post the review as one comment

Fill the round 1 skeleton in [the review comment template](references/review-comment-template.md). Write the body to a file in the agent's scratch area first: review bodies run to thousands of characters, and quoting them inline in a shell command mangles them. Then post it as one review with no inline comments:

```bash
OWNER_REPO=$(gh repo view --json owner,name -q '.owner.login + "/" + .name')
gh api "repos/${OWNER_REPO}/pulls/<n>/reviews" --method POST -f event="COMMENT" -F body=@<path-to-review-body>.md
```

Never send a `comments[]` array with the review, and never post to the pull request's line-comment endpoint, even when a finding is about one line. Cite the location in the finding's text as `<path>:<line>`.

Confirm the posted review carries no inline comments. This must print `0`:

```bash
gh api "repos/${OWNER_REPO}/pulls/<n>/reviews/<review_id>/comments" -q 'length'
```

Why one comment rather than threads on lines:

- **A review is an argument, not a pile of notes.** Findings refer to each other ("finding 2 is the rule of finding 4 applied to CI"), and the summary table only means something next to the entries it indexes. Scattered over the changed-files view, a reader gets fragments and never sees the shape.
- **Line anchors go stale.** A line comment is pinned to a diff position. A force push, a rebase, or a new commit touching the same hunk marks the thread outdated and collapses it, so the finding drops out of view while the code is still wrong. A body comment survives all of that.
- **Notification and resolution cost.** Each line thread is its own notification and its own unresolved counter. Five findings become five threads to resolve one by one.
- **A text `<path>:<line>` is enough.** The reader finds it with one search, and it stays readable after a rebase.

**Editing a posted review.** Edit a review in place for exactly two things: correcting your own review before anyone has acted on it (a typo, a finding caught minutes later), and adding resolution notes to its own findings (a Resolution column, "fixed in `<sha>`", the operator's decision under the finding it answers):

```bash
gh api "repos/${OWNER_REPO}/pulls/<n>/reviews/<review_id>" --method PUT -F body=@<path-to-review-body>.md
```

Everything else is a new round, posted as a new review.

---

## Later rounds

Round 2 and every later round verify the fixes for the previous round's findings. They widen nothing.

1. Run Step 0 and Step 1 again (reusing session context where allowed).
2. Read the previous round's review body in full: `gh api "repos/${OWNER_REPO}/pulls/<n>/reviews/<review_id>" -q .body`. Take its findings list and any resolution notes or operator decisions recorded under them.
3. Get what changed since that round. Its `commit_id` is the head it reviewed:

   ```bash
   git fetch origin <headRefName>
   git diff <previous_commit_id> <current_head_sha>
   ```

   If the previous head is no longer reachable (the branch was rebased), read each finding's location at the current head instead.
4. For each previous finding, decide one outcome and cite the evidence (the fixing sha, the file and line at the new head, or the command rerun with its output):
   - **Fixed:** the fix resolves the finding.
   - **Not fixed:** the code still deviates, or the fix itself introduced a defect (described under this finding).
   - **Partly fixed:** some locations or cases remain; name them.
   - **Decided:** the operator chose to keep the code; cite where the decision is recorded.
5. Do not add findings about anything else: not about code the fixes did not touch, and not about parts of the original diff that round 1 missed. If verifying a fix surfaces a Code Bug at or above `{{ref:review.confidence_floor}}` outside the fixes, do not post it in this round; tell the operator in the session output, in one line, so they can decide whether to request an independent review.
6. Post the round with the round N skeleton in [the review comment template](references/review-comment-template.md), as a new review with the same `POST` command and the same zero-inline-comments check. Never fold a round into an earlier review's body, and never rewrite the substance of findings someone has already acted on: each round records what was asked and what was done. Open with the head sha reviewed and a one-line pointer to the earlier rounds ("Round 1 is the review above; 5 of 6 fixed").

An independent or full review that the operator asks for by name is the one exception to this section: run Steps 3 to 10 at the current head, and post it as a new review whose heading carries the next round number followed by "(independent)", for example `## Review round 3 (independent): PR #<n>`.

---

## Finding classes

Choose exactly one class per finding.

- **Code Bug:** the code will crash or produce wrong behavior. Must fix.
- **Spec Deviation:** the code works but does not match the linked issue, or contradicts a decided section of `{{ref:paths.business_rules}}` or `{{ref:paths.architecture}}`. It may be intentional and needs a decision.
- **Approach Limitation:** the code exposes a trade-off in the design. It needs a design discussion, not a code fix. Present the options; do not decide them.
- **Pattern Violation:** the code works but does not follow a convention in `{{ref:paths.refdocs_root}}`, the hub, or the corrections log. Should fix for consistency.

Tie-breakers:
- Unsure between Code Bug and Spec Deviation: choose Spec Deviation. It prompts a discussion instead of assuming the code is wrong.
- Unsure between Spec Deviation and Pattern Violation: a deviation from a project-specific record (the issue, business rules, architecture) is a Spec Deviation; a deviation from a general pattern doc is a Pattern Violation.

The format of each finding is in [the review comment template](references/review-comment-template.md).

---

## Rules

1. **One comment per round.** Every finding lives in the single review body, cited as `<path>:<line>`. No line comments, no follow-up comment for one more thing, no separate summary comment. A correction to your own review before anyone acted on it, and resolution notes, are edited into that review. A later round is a new review.
2. **Only flag real deviations.** Findings about correct code are noise, and noise costs the review its credibility.
3. **Every finding cites its source** (Step 8). With no citation, lower the confidence or drop the finding.
4. **Read before you review.** Read the indexes, then the specific pattern files and governing sections, before making any claim. Never review from memory.
5. **Respect adaptation notes.** When a reference pattern is written for a different library than the project uses, and the hub or the folder's index says to adapt it, judge the code against the adapted equivalent, not the original.
6. **The floor is the manifest's.** Nothing below `{{ref:review.confidence_floor}}` is posted.
7. **Findings are advisory.** Write "Consider..." or "The reference documentation shows...", not "You must..." or "This is wrong."
8. **Aggregate.** The same deviation in five files is one finding that lists all five locations.
9. **Untouched code is never a finding, and never a question.** It ends as Fold, Record or Drop, decided by you in the review that raises it (Step 9). Handing the operator a list of parked questions is what this rule exists to stop.
10. **Rounds widen nothing.** Round 2 and later verify fixes only (Later rounds).
11. **The operator merges.** The review never approves, requests changes as a merge gate, merges, or closes the pull request. It posts with the `COMMENT` event only.
