# Review comment template

The exact skeleton of the one comment dev-review posts per round. Replace every `<placeholder>`. Keep the headings and their order; omit a section only where its note says it may be omitted. The first line is the marker the skill uses to find earlier rounds, so it always starts with `## Review round`.

Write the filled body to a file and post it with the command in the skill (Step 10). Never split it into several comments and never attach line comments.

## Round 1 skeleton

````markdown
## Review round 1: PR #<number>

**<pull request title>**
**Head reviewed:** `<head sha>`
**Files reviewed:** <count> (+<additions> / -<deletions>) across <n> commits
**Workspaces:** <names from the manifest's workspaces list>
**Domains:** <domains from the manifest's domains list>
**Spec:** issue #<issue number><, plus the working plan `plan - <descriptor>.md` when one exists>

<One short paragraph: what this pull request does, and the overall shape of the
findings, for example "four of the five concern the scope of a mechanism, not its
correctness". If commits landed during the review, say which head was reviewed.>

### Findings at a glance

| # | Location | Classification | Confidence | Summary |
|---|---|---|---|---|
| 1 | `<path>:<line>` | <Code Bug, Spec Deviation, Approach Limitation or Pattern Violation> | <NN> | <one line> |
| 2 | `<path>:<line>` | <class> | <NN> | <one line> |

<When there are no findings at or above the confidence floor, replace the table
with: "No findings at or above the confidence floor of <floor>.">

---

### Finding 1: <title>

**Location:** `<path>:<line>` <, `<path>:<line>` for every further location of the same deviation>
**Classification:** <Code Bug | Spec Deviation | Approach Limitation | Pattern Violation>
**Confidence:** <NN> (floor <floor>)

**What I found:**
<One or two sentences: what the code does and how it deviates.>

**Expected pattern:**
<One or two sentences, or a short snippet, showing what the cited source prescribes.>

**Evidence:**
- <Documentation: `<path>` section "<heading>">
- <Corrections entry: "<heading quoted verbatim>" (source PR #<number>)>
- <Test: `<test file>` "<test name>" fails / is missing for <behavior>>
- <Reproduced: `<exact command>` printed: <relevant output lines>>

**Reasoning:**
<Why this matters in this project: what breaks, or why the pattern exists.
Specific, not generic advice. For an Approach Limitation, list the options
without choosing one.>

---

### Finding 2: <title>

<same fields as Finding 1>

---

### Repeat patterns (from the corrections log)

| Corrections heading | Source PR | Status |
|---|---|---|
| <heading quoted verbatim> | #<number> | <found (finding N) or clear> |

<When no pulled entry matched the diff, keep the table and add the line:
"All matching corrections entries checked: no repeat violations found."
When the log has no rule headings yet: "Corrections log checked: no patterns
recorded yet.">

### Outside this diff

<May be omitted when there is nothing to say. One bullet per observation about
code the pull request did not touch, each ending in its disposition. No open
questions.>

- **Fold:** `<path>:<line>` <the observation and the exact small fix, inside code this PR already changes>
- **Record:** `<path>:<line>` <the observation; the exact row or sentence to add, and where: Part 4 of the state document, business rules, or architecture>
- **Drop:** `<path>:<line>` <the observation, and in one line why it is not worth recording>
- **Settled:** `<path>:<line>` <matches Part 4 row "<row name>"; not raised>

### Not necessarily bugs

<May be omitted. Code that looks unusual but may be correct, with the reason,
so a later reviewer does not "fix" a deliberate choice.>

### What looked good

- <Things done correctly that are worth naming.>

### Reference documentation consulted

- `<reference folder>/_INDEX.md`
- `<pattern file read>`
- `<business rules or architecture file>` section "<heading>"
- Part 4 of `<state document>`
- <Any manifest key reported "not configured" and the step it skipped>

---
*Advisory review. Each finding cites its source; the author and the operator decide what to act on.*
````

## Round N skeleton (round 2 and later)

````markdown
## Review round <N>: PR #<number>

**Head reviewed:** `<head sha>` (previous round reviewed `<previous head sha>`)
**Earlier rounds:** <one line, for example "Round 1 is the review above; 5 of 6 fixed.">
**Scope:** verifies the fixes for round <N-1>'s findings only.

### Verification

| # (round <N-1>) | Title | Outcome | Evidence |
|---|---|---|---|
| 1 | <title> | <Fixed, Not fixed, Partly fixed or Decided> | <fixing sha, `<path>:<line>` at the new head, or the rerun command and its result> |
| 2 | <title> | <outcome> | <evidence> |

### Notes on unresolved findings

<May be omitted when every finding is Fixed or Decided. For each Not fixed or
Partly fixed finding: what remains, with `<path>:<line>`. A defect the fix itself
introduced is described here, under the finding it was fixing.>

---
*Advisory review. Each outcome cites its evidence; the author and the operator decide what to act on.*
````

## Resolution notes on a posted round

When the author or the operator answers a finding, edit the same review (the edit command in Step 10) and add a Resolution column to its "Findings at a glance" table, or a line under the finding:

```markdown
**Resolution:** fixed in `<sha>` | decided by the operator: <decision and where it is recorded>
```

Never rewrite the substance of a finding someone has already acted on. A new verification is a new round.
