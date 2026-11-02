---
name: preflight-check
description: "Blocking pre-PR gate the author runs before any pull request is created. Run it before every PR, and whenever the operator says 'preflight', 'preflight check', 'ready for PR', 'validate before PR', 'run checks', 'pre-PR check' or 'create PR' (run preflight first; the PR is created only after a PASS). About to open a PR without having run it on the current code? Stop and run it. It resolves the manifest (checkrein.json), lists the branch's changes against the merge base with trunk, classifies them by workspace, runs the configured lint, typecheck, test, build and format-check commands verbatim, scans the changed files against the applicable corrections-log rules, runs pattern spot-checks drawn from the hub and the governing docs, checks working-doc naming and presence, and enforces exact version pins. It produces one report that ends in a verdict: PASS, or BLOCKED with a numbered list of critical failures. It never fixes code and never creates the PR. Distinct from dev-review, which runs after the PR exists."
---

# preflight-check

## Purpose

Catch known anti-patterns, validate code quality and verify compliance with the project's conventions before a pull request exists. This is the institutional memory check: it reads the corrections log (lessons learned from past mistakes) and verifies that the branch does not repeat them.

The PR is created only when every critical check passes. If anything is BLOCKED, it is fixed first and the whole preflight runs again.

Claude Code note: run commands with the Bash tool, read files with Read, and search with Grep or `rg` through Bash.

---

## When to Run

- Before any command or action that opens a pull request.
- When the operator says "preflight", "ready for PR", "create PR", "validate", "run checks".
- After the agent's own verification of the work is done: preflight is the final gate before the PR.

---

## Protocol

Execute the steps in order. Report each step's result as it completes; do not batch everything to the end.

**Session context reuse.** The configured commands in Step 2 run again on every preflight, because their output reflects the current tree, which may have changed since the last skill ran. The corrections heading index, entries already pulled, and reference index files already read in this session by the `docs` or `dev-review` skills may be reused from the transcript: reading them again adds nothing. A handful of previously pulled entries never replaces Step 3's scan of every heading.

### Step 0: Resolve the manifest

1. Find the repository root (`git rev-parse --show-toplevel`) and read checkrein.json there.
2. If the file is missing or does not parse as JSON, stop. Print the verdict `BLOCKED: checkrein.json is missing or invalid at the repository root. Run the init skill to install it, then run preflight again.` Run no other step.
3. Substitute every `{{ref:<dotted.key>}}` token in this skill with the manifest value at that key before running anything. Array keys (`{{ref:workspaces}}`, `{{ref:protected_trees}}`, `{{ref:secret_globs}}`, `{{ref:domains}}`, `{{ref:areas}}`) are lists; each step says how its list is used.
4. This skill needs `vcs.trunk` (non-empty), `paths.corrections_log`, `paths.state_doc`, `paths.working_docs_dir`, `paths.business_rules`, `paths.architecture`, the five `commands.*` keys (empty is allowed), `workspaces` (at least one entry), `protected_trees`, `secret_globs` and `domains` (must contain `process`). If a needed key is absent, stop with `BLOCKED: checkrein.json has no <key>. Add it (the init skill documents every key) and run preflight again.`
5. Print one line with the resolved trunk and the workspace names, then the file resolution table below, before any other step. A preflight report without this table means the check was skipped: run the skill again.

| File | Required? | Status |
|---|---|---|
| the hub (AGENTS.md at the repository root) | Always | FOUND / MISSING |
| `{{ref:paths.corrections_log}}` | Always | FOUND / MISSING |
| `{{ref:paths.state_doc}}` | Always | FOUND / MISSING |
| `{{ref:paths.working_docs_dir}}` | For Step 5 | FOUND / MISSING (warning only) |

If a required file is missing, stop and ask the operator. Record it as a critical failure and do not create the PR:

> BLOCKED: `<path>` is missing. It is required on every run. Ask the operator before creating any PR.

Never hand-recreate a missing record: these are large, append-heavy documents, and a hand-written replacement is a second copy that drifts silently from the real one. Never downgrade the stop to a warning and continue.

If the corrections log resolves but holds no rule headings, proceed and state "Corrections log checked: no patterns recorded yet."

### Step 1: Identify what changed

Diff against the **merge base** with trunk, never against the trunk tip: a two-dot diff against a trunk that moved after the branch was cut lists every file trunk changed since, and the scans then report other people's work as this branch's. File lists are NUL-delimited end to end, so names with spaces or newlines survive.

```bash
TRUNK='{{ref:vcs.trunk}}'
git fetch --quiet origin "$TRUNK" 2>/dev/null   # refreshes the remote-tracking ref only; harmless without a remote
BASE_REF="origin/$TRUNK"; git rev-parse --verify --quiet "$BASE_REF" >/dev/null || BASE_REF="$TRUNK"
BASE=$(git merge-base "$BASE_REF" HEAD); echo "merge base: $BASE"
OUT="${TMPDIR:-/tmp}/preflight"; mkdir -p "$OUT"
git diff --name-only -z "$BASE" HEAD > "$OUT/all.z"                        # every changed path at HEAD
git diff --name-only -z --diff-filter=ACMR "$BASE" HEAD > "$OUT/present.z"  # paths that exist at HEAD
git diff --name-only -z --diff-filter=D "$BASE" HEAD > "$OUT/deleted.z"     # deleted paths
tr -cd '\0' < "$OUT/all.z" | wc -c                                          # files changed
```

**Uncommitted work.** Run `git status --porcelain=v1 -z`. The PR carries only commits, while Step 2's commands run against the working tree, so a PASS on a dirty tree certifies code the PR does not ship.
- A modified, staged or deleted tracked file is a **Critical** failure: commit or stash it, then run preflight again.
- An untracked file (`??`) is a **Warning**: list it; it may be a new file the agent forgot to add.

**Exclusions.** Build the scan list from `present.z`, dropping every path under `{{ref:protected_trees}}`, generated code, installed dependency folders and lockfiles. None of these is authored code, and scanning them reports noise as violations. Lockfiles still matter to Step 6, which reads `all.z` directly.

```bash
# EXCLUDE is one extended regex: each protected tree as ^<tree>, plus the generated, dependency-install and lockfile paths read from the repository's ignore files and each workspace's package configuration
EXCLUDE='^(<protected tree>|<protected tree>)|(^|/)<generated dir>/|(^|/)<dependency install dir>/|(^|/)<lockfile name>$'
grep -z -v -E "$EXCLUDE" "$OUT/present.z" > "$OUT/scan.z"
```

If nothing is to be excluded, copy the file instead (`cp "$OUT/present.z" "$OUT/scan.z"`): an empty pattern matches every line, and `-v` would then drop every file. Use this same scan list everywhere a step searches changed files.

**Classify by workspace.** Assign every path in `all.z` to the entry of `{{ref:workspaces}}` whose `root` is the longest matching path prefix. A root of `.` matches everything and catches what no other root claims. Then name the corrections domains from `{{ref:domains}}` the change touches, judged from the paths and their content, and always add `process`. The workspaces drive Step 4; the domains drive Step 3.

Print:

| Workspace | Root | Files changed | Domains |
|---|---|---|---|

### Step 2: Run the configured commands

Run each command exactly as the manifest states it, from the repository root, one at a time (parallel runs of heavy suites contend for memory and produce failures that are not real). Do not add flags, narrow a command to the changed files, or swap in a different command. Run every configured command even after one fails: a complete diagnostic is worth more than stopping at the first failure.

| Check | Command | Severity |
|---|---|---|
| Lint | `{{ref:commands.lint}}` | Critical |
| Typecheck | `{{ref:commands.typecheck}}` | Critical |
| Tests | `{{ref:commands.test}}` | Critical |
| Build | `{{ref:commands.build}}` | Critical |
| Format check | `{{ref:commands.format_check}}` | Critical |

- The exit code decides PASS or FAIL. On FAIL, capture the first 30 lines of error output for the report.
- An empty command is not run and is reported as **NOT CONFIGURED**. It is not a failure. If all five are empty, add one Warning: "No automated checks configured in checkrein.json."
- A failure that looks environmental (a sandbox denial, a missing service, a socket error) is still FAIL in the report; say what it looked like, and let the operator decide whether to rerun it outside the restriction. Never mark it PASS on a guess.

### Step 3: Corrections log scan

The corrections log holds the hard-won lessons from past debugging sessions: patterns that cost hours and must never recur. A missing log already stopped the run at Step 0.

1. Build the index by searching headings only: `grep -nE '^### (Pattern|Convention) \[' {{ref:paths.corrections_log}}`. On a mature project the index alone runs to thousands of tokens, so never read the log in full; the headings are the index.
2. Scan every heading, however unrelated the diff seems. Headings are full failure-mode sentences, and reading all of them is what catches rules the agent would not have known to search for.
3. For each heading whose tags or wording match the domains from Step 1 (plus `process`, which applies to every PR), read about 40 lines from its line number (`sed -n '<n>,<n+40>p' {{ref:paths.corrections_log}}`) to get the full entry: What went wrong, Correct approach, Rule, Files affected. When unsure whether a rule applies, pull it.
4. Translate each applicable rule into a concrete search over the scan list. The pulled entry carries the rule's context, including its exceptions.

```bash
# Every changed, authored file; the -s guard and xargs -r keep an empty list from searching anything else
[ -s "$OUT/scan.z" ] && xargs -0 -r grep -nHE '<pattern from the rule>' -- < "$OUT/scan.z"
# One workspace's files of given types
grep -z -E '^<workspace root>/.*\.(<ext>|<ext>)$' "$OUT/scan.z" | xargs -0 -r grep -nHE '<pattern>' --
# Drop comment lines when the rule concerns code or shipped strings, not comments
... | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|#|\*|/\*|--)'
```

5. Confirm each match against the diff: `git diff -U0 "$BASE" HEAD -- '<file>'`. A match on a line this branch adds or changes is a **VIOLATION**. A match only on lines the branch did not touch is **PRE-EXISTING**: report it without blocking, and route it through the hub's rule for observations about untouched code (fold it only when the fix is certain, small and inside code the branch already changes; otherwise record it or drop it). A rule about a whole file (every handler declares X) is judged on what the diff adds or changes.

Report every applicable rule as a row, CLEAR or VIOLATION, so the reader can see which rules were checked. If none applied, say "no relevant corrections found".

### Step 4: Pattern spot-checks

Run only the checks for workspaces and concerns the diff touches; skip the rest and say so.

#### 4a. Checks that always run

| Check | How to verify | Severity |
|---|---|---|
| No secret files | No path in `all.z` matches `{{ref:secret_globs}}`. Report the path only and never open the file. An example or template file is exempt only when the hub names it as safe to commit | Critical |
| No embedded credentials | Added lines carry no private key header (`-----BEGIN [A-Z ]*PRIVATE KEY-----`) | Critical |
| Likely credentials | Added lines carry no long literal assigned to a name like key, secret, token or password; list each hit for the operator to judge | Warning |
| Protected trees untouched | No path in `all.z` lies under `{{ref:protected_trees}}`. A change there is legitimate only when the ticket retires something into the tree; list each path | Warning |
| Scope matches the ticket | Every workspace in the Step 1 table is one the ticket's issue names. A workspace outside it is touched only when it blocked the work, and the PR body must name what blocked it | Warning |
| Existing tests changed | For each test file in the diff with status M or D, list the assertions removed or changed. Each must be named in the PR body with its reason and agreed with the operator; an assertion is never loosened just to make a failing test pass | Warning |

#### 4b. The project's own rules

The project's spot-checks come from three places, all of which the agent reads rather than invents:

1. **The hub's critical rules** and any per-workspace conventions it states.
2. **The governing docs**: the sections of `{{ref:paths.business_rules}}` and `{{ref:paths.architecture}}` that govern the touched workspaces (the `docs` skill's governing-docs check; reuse its pulls from this session). Read the shared sections plus the touched workspace's own sections.
3. **Convention entries** in the corrections log whose tags match the touched domains.

Turn each rule that can be checked mechanically into a check row with a verify method and a severity, using the shapes in [the spot-check catalog](references/spot-check-catalog.md). The catalog lists check shapes, not policy: apply a row only when one of the three sources decides the rule for this project, and cite that source in the row. A check that one of these sources marks as decided keeps the severity the source gives it; otherwise a rule whose breach ships a defect, a security gap or a broken contract is Critical, and a rule about style or maintainability is a Warning.

Commands that need a pipe go in a code block below the table, because a table cell cannot carry a shell pipe. Before trusting a new search, run it once against a fixture that must match and one that must not. A check that proves wrong against real code is corrected in the PR that proves it.

### Step 5: Working-doc check

Working docs live in `{{ref:paths.working_docs_dir}}` and are disposable by design.

| Check | How to verify | Severity |
|---|---|---|
| Naming | Every markdown file the diff adds or renames under `{{ref:paths.working_docs_dir}}` is named `plan - <descriptor>.md` or `audit - <descriptor>.md` (space, hyphen, space), or is `{{ref:paths.working_docs_dir}}README.md` | Critical |
| Presence | When the change is beyond a surgical edit (new files, new endpoints, new data models, new library surface, or more than one workspace), a plan or audit whose descriptor names this ticket, its area or its initiative exists in the folder, on trunk or in the diff. For a surgical edit, report "not required" | Warning |
| Not retired early | The diff does not delete a working doc or move it out of the folder. Retirement happens after the merge, in the post-merge skill | Warning |
| Not the only home of a decision | A decision the working doc records that changes a decided rule is also written to `{{ref:paths.business_rules}}` (behaviour) or `{{ref:paths.architecture}}` (mechanism) in this diff, with the operator's sign-off | Warning |

Quote these paths in every shell command; they contain spaces.

### Step 6: Exact-pin check

Every version that can change runtime behaviour is pinned to one exact release, identical in every environment, and moves only through a visible edit. This step reads `all.z`, lockfiles included.

| Check | How to verify | Severity |
|---|---|---|
| Exact dependency specifiers | In every changed dependency manifest, each added or changed dependency line names one exact version (for example `1.4.2`): no caret, tilde, comparison operator, wildcard, `x` segment, `latest` or other tag, branch reference or open range. Workspace-internal links and any exception the hub or the architecture record decides are allowed; cite the decision in the row | Critical |
| Lockfile moves with its manifest | A dependency change in a manifest comes with its lockfile change in the same diff | Critical |
| Lockfile change explained | A lockfile change with no manifest change is a re-resolution; confirm it was intended | Warning |
| Exact infrastructure tags | Container image tags in changed files carry a full `major.minor.patch`, never `latest`, a bare major or a `major.minor` tag. Runtime and tool versions in changed version files and CI files are exact | Critical |
| One version everywhere | When a pinned version changed, search for the old value (`git grep -n -F '<old version>'`, excluding the protected trees). Every location that pins the same component moved in this diff, documentation examples included | Critical |
| Reproducing installs are frozen | Changed CI, image build and deploy files install from the lockfile in its frozen mode (the install fails if the lockfile would change), never with a resolving install | Critical |

If the lint command already runs a pin checker, record its result in this step as well, and still read the diff: a checker misses shapes it was not written for.

### Step 7: Generate the report

Produce this structure, filled in with actual results:

```markdown
## Preflight Check Report

**Branch:** `<current branch>`
**Base:** `{{ref:vcs.trunk}}` (merge base `<short sha>`)
**Files changed:** <count> (<count> deleted)
**Workspaces:** <names from the Step 1 table>
**Domains:** <domains from the Step 1 table>

### File Resolution

| File | Required? | Status |
|---|---|---|
| the hub (AGENTS.md) | Always | FOUND/MISSING |
| `{{ref:paths.corrections_log}}` | Always | FOUND/MISSING |
| `{{ref:paths.state_doc}}` | Always | FOUND/MISSING |
| `{{ref:paths.working_docs_dir}}` | For Step 5 | FOUND/MISSING |

(A MISSING row marked Always is an automatic BLOCKED verdict; see Step 0.)

### Working Tree

| Check | Status | Details |
|---|---|---|
| Uncommitted tracked changes | CLEAN/FAIL | <paths> |
| Untracked files | NONE/WARN | <paths> |

### Automated Checks

| Check | Command | Status | Details |
|---|---|---|---|
| Lint | `<command>` | PASS/FAIL/NOT CONFIGURED | <error summary if failed> |
| Typecheck | `<command>` | PASS/FAIL/NOT CONFIGURED | <error summary if failed> |
| Tests | `<command>` | PASS/FAIL/NOT CONFIGURED | <error summary if failed> |
| Build | `<command>` | PASS/FAIL/NOT CONFIGURED | <error summary if failed> |
| Format check | `<command>` | PASS/FAIL/NOT CONFIGURED | <error summary if failed> |

### Corrections Log Scan

| Rule (heading) | Status | Details |
|---|---|---|
| <heading sentence> | CLEAR/VIOLATION/PRE-EXISTING | <file:line> |

### Pattern Spot-Checks

| Check | Source | Severity | Status | Details |
|---|---|---|---|---|
| <check name> | <hub rule, doc section or corrections heading> | Critical/Warning | PASS/FAIL | <file:line if failed> |

### Working Docs

| Check | Severity | Status | Details |
|---|---|---|---|

### Exact Pins

| Check | Severity | Status | Details |
|---|---|---|---|

### Summary

- Critical failures: <count>
- Warnings: <count>

### Verdict

<one of:>
PASS: all critical checks passed. <count> warnings to consider. Safe to create the PR.
BLOCKED: <count> critical failure(s). Fix before creating the PR:
  1. <file:line and what to change>
  2. ...
```

---

## After the Report

- **If PASS:** tell the operator the preflight passed and ask whether to proceed with the PR. This skill ends here; it never opens the PR itself. Remind the PR's author of the hub's PR body structure, which is authoritative: **Summary** (what changed and why), **Changes** (bullets), **Files Changed** (a `File | Change` table), **Test Plan** (a checkbox list of the verification steps actually run, this preflight's commands included), and the footer that closes the issue, with the issue number verified in the tracker first. The PR targets `{{ref:vcs.trunk}}`, and its title and branch follow the hub's naming convention with an area from `{{ref:areas}}`. The body also names any corrections rule the change deviates from and why, any out-of-scope edit and what blocked it, and any existing test it changed and why.
- **If BLOCKED:** list every critical failure with its file, line and the change needed. Do not create the PR. After the fixes, run the entire preflight again from Step 0; never assume a fix is correct without the rerun.
- **Warnings** do not block the PR but are always reported. The operator decides whether to address them.

---

## Important Behaviors

1. **Never skip the corrections scan.** It is the most valuable step, because it is institutional memory. Scan every heading on every run; pull full entries only where relevant.
2. **Be specific about failures.** "Docs missing on the endpoint" is unhelpful. "`<file>:42`: the `getItem` handler has no API description" is actionable.
3. **Idempotent.** Running preflight twice on the same tree produces the same report. It writes nothing but its own temporary file lists, and it changes no repository state.
4. **Do not fix things silently.** Preflight is a diagnostic, not an auto-fixer. Report what is wrong so the author fixes it on purpose.
5. **Severity is fixed by its source.** Critical failures block the PR; warnings inform. Never promote a warning to critical or demote a critical failure to a warning. The tables in this skill and the severities the governing docs state are authoritative.
6. **Rerun after fixes.** When asked to check again, run the full protocol from Step 0, file resolution table included. Taking shortcuts defeats the point, which is to catch regressions.
7. **The operator decides.** Preflight never merges, never opens the PR, never connects to production and never takes an irreversible action. A question it cannot settle from the records goes to the operator.
