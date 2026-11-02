---
name: structured-debugging
description: Run when a bug or unexpected behavior has a cause that is not obvious from the error message, and always after a first fix attempt fails. It forces the order observe and reproduce, search the reference docs through the docs skill, search the corrections log, classify as Code Bug, Spec Deviation or Approach Limitation, and only then propose a fix. It reads the manifest (checkrein.json), the corrections log heading index, the state document and the relevant reference docs, and it prints a triage block, an observation block, a documentation block and a diagnosis block. An Approach Limitation stops and hands the operator options. Trigger phrases include "debug this", "why is this failing", "figure out what's wrong", and the moment you are about to write "let me try". Skip it for errors where a tool names the exact file, line and fix.
---

# structured-debugging

**Core principle: diagnose before treating. Read before writing. Understand before changing.**

Claude Code note: read files with Read, search with Grep or Glob, run commands with Bash.

---

## When to use

- A runtime bug or unexpected behavior whose cause is not obvious from the error.
- A test fails and you do not immediately see why.
- Behavior does not match what the code should produce.
- A review comment identifies a bug to fix.
- The operator says "debug this", "why is this failing" or "figure out what's wrong".
- You are about to say "let me try..." or "this might fix it" without having consulted any record or doc.
- **You already attempted one fix and it did not work.** This is the most important trigger. A failed fix means your mental model is wrong. Rerunning the full protocol is the fastest way to correct it.

## When not to use

- A compiler, linter or type checker error that names the exact file, line and fix: a missing import, a type mismatch, a syntax error, a misspelled identifier. Fix these directly.
- **However**, if the direct fix does not resolve it (the error persists, changes form, or a new unexpected error appears), come back and run the full protocol from Step 2. No second guesses.

---

## The protocol

### Step 0: Resolve the manifest

1. Read the manifest, checkrein.json at the repository root.
2. Substitute every `{{ref:<dotted.key>}}` token in this skill with the manifest value at that key. Array keys (`{{ref:domains}}`, `{{ref:workspaces}}`) are lists; the step that cites one says how it is used.
3. If the manifest is missing or does not parse, STOP and print: `Manifest not found (or invalid): run the init skill to install checkrein.json, then rerun structured-debugging.` Do not guess paths.
4. If a key this skill cites is absent, or a `paths.*` key is empty, STOP and name the key. Never fall back to a default path from memory. An empty command is "not configured" and its step is skipped and reported; an empty list (such as `{{ref:protected_trees}}`) is valid and means none.

If another skill already loaded the manifest or the corrections heading index earlier in this session and nothing has changed since, reuse that result instead of reading again.

Then print the file resolution table:

| File | When required | Status |
|------|---------------|--------|
| checkrein.json | Always | FOUND / MISSING |
| `{{ref:paths.corrections_log}}` | Always | FOUND / FOUND (empty) / MISSING |
| `{{ref:paths.state_doc}}` | Always | FOUND / MISSING |
| `{{ref:paths.refdocs_root}}` | When the error involves a library or pattern | FOUND / MISSING |

- A required file that is **MISSING**: STOP and ask the operator. Never recreate one by hand; a hand-written replacement is a second copy that silently drifts from the real one.
- The corrections log **FOUND (empty)**: proceed and say `Corrections log checked: no patterns recorded yet.`
- `{{ref:paths.refdocs_root}}` **MISSING**: say so in the output, then use the official documentation pinned to the exact version the project's dependency manifest declares. Never use the latest version by default.

### Step 1: Triage (print this before any investigation)

Before reading docs or investigating code, print:

```
TRIAGE:
Error: "<exact error message>"
Has explicit file, line, and fix? YES / NO
Decision: FAST-PATH (fix directly) / FULL PROTOCOL (continue to Step 2)
```

**Fast-path cases** are errors where the tool states the cause and the remedy:

- A module or symbol cannot be found and the message names the path: add or correct the import.
- An argument or assignment type does not match and the message names both types: correct the type.
- A syntax error at a named line: correct the syntax.
- A misspelled or missing identifier that the tool points at.

If you print `Decision: FAST-PATH`, fix the error and stop. Do not continue to Step 2.

If you print `Decision: FULL PROTOCOL`, continue to Step 2.

**If a fast-path fix fails** (the error persists, changes form, or a new unexpected error appears), print a new triage block with `Decision: FULL PROTOCOL`. There are no second guesses on fast-path fixes.

### Step 2: Observe and reproduce (facts only)

Print this template before investigating. Writing it down prevents premature interpretation: the template asks only for facts, so you cannot write "the problem is X".

```
OBSERVATION:

Error message: "<exact error text>"
File: <path>:<line>
Triggered by: <what action caused this: build, test, runtime, request, command>
Reproduction command: <the exact command or steps that produce the error>
Reproduced: <yes, just now / no, could not reproduce>
Reproducible: <always / sometimes / first time seeing it>
What changed recently: <last file modified, last command run>
```

Reproduce the failure before going further, and record the exact command. A fix cannot be verified later without it. If you cannot reproduce it, say so in the block and treat every later step as lower confidence.

Do not write "the problem is X" at this stage. State facts, print the block, then move to Step 3.

### Step 3: Search the reference docs

Run the docs skill first. Its tier gate and its index fan-out pick the right starting point for the domain the error involves, and it prevents a hallucinated API from entering the diagnosis. Then do targeted lookups: read two to four specific files, not entire directories. The goal is the documented pattern for this specific scenario, not a broad exploration.

Choose the starting point by what the error involves:

| Error involves | Read, in order |
|----------------|----------------|
| A library or framework call | The library folder's _INDEX.md under `{{ref:paths.refdocs_root}}`, then the doc it names for that API or its error handling |
| A pattern the project follows (a component, a service, a hook, a module) | The matching pattern-reference folder's _INDEX.md, then the closest example file |
| A build, bundler or toolchain configuration | The folder for that tool, then the troubleshooting or configuration page its _INDEX.md names |
| A workspace-specific behavior | The workspace's own entry in `{{ref:workspaces}}`, then the state document's inventory for that workspace |
| An operational or deploy symptom | `{{ref:paths.runbooks_dir}}`, then the runbook the symptom names. If no runbook covers it, say "no runbook covers this" rather than guess |

Also check, as quick lookups and not deep dives:

1. **The state document**, `{{ref:paths.state_doc}}`: read Part 3 (open gaps) and Part 4 (accepted debt and settled decisions). The behavior you are chasing may be a known gap or a settled decision, in which case it is not a bug.
2. **The ticket's working plan** in `{{ref:paths.working_docs_dir}}` (`plan - <descriptor>.md`): did the plan account for this scenario? Delivered plans are retired when their ticket merges, so for shipped work there is usually no live plan file and the tracker issue is the durable record.

Print this block after your lookups:

```
DOCUMENTATION CONSULTED:

<doc-path>: <what the doc says about this scenario>
<doc-path>: <relevant code example from the reference>
<state-doc part>: <known gap or settled decision / nothing relevant>
```

Every doc path must be a real file you actually read. "I checked the docs" without a specific path is not acceptable.

### Step 4: Search the corrections log

Has this exact issue been seen before? The corrections log, `{{ref:paths.corrections_log}}`, is newest first and append-only. Its rule headings carry domain tags from the closed vocabulary `{{ref:domains}}` and have the form `### Pattern [<domains>]: <failure-mode sentence>` or `### Convention [<domains>]: <convention sentence>`. The headings are the index.

1. Build the index with one search over headings only: `grep -nE '^### (Pattern|Convention) \[' {{ref:paths.corrections_log}}`. On a mature project this index alone can run to thousands of tokens. That is expected and still a small fraction of the log. Never read the whole file.
2. Scan every heading, including those tagged with domains the bug does not touch. Headings are full failure-mode sentences, and scanning all of them is what catches a rule you would not have known to search for.
3. Pull each entry whose tags or wording match the symptom, plus every entry tagged `process`. Read about 40 lines from the heading's line number, enough to cover **What went wrong**, **Correct approach**, **Rule** and **Files affected**. When unsure whether an entry applies, pull it.
4. A matching rule is a hard constraint. It overrides general library documentation where the two conflict. If the fix must deviate from it, name the rule and the reason.

Print:

```
CORRECTIONS CHECKED:

index scanned: <number of headings>
relevant rules: <heading, line number> / nothing relevant
```

If nothing in the index matches, write `Corrections log checked: no relevant corrections found.`

### Step 5: Diagnose and classify

From the observation and the documentation, propose a diagnosis and classify it into exactly one of three categories. Each category has a different fix path, which is why choosing one forces clear thinking.

**Category A, Code Bug.** The code does not match what the docs or the corrections log say. Fix: change the code to match the documented pattern. Evidence: show the doc and show where the code deviates.

**Category B, Spec Deviation.** The plan, spec or ticket assumed something untrue (a wrong API, undocumented behavior, a misread requirement). Fix: update the code and the spec. Evidence: show the spec assumption and the actual behavior with a doc reference.

**Category C, Approach Limitation.** An architectural trade-off with no simple code fix. Response: present two or three alternatives and ask the operator to decide. Evidence: explain the constraint and why the approach causes this.

Print:

```
DIAGNOSIS:

Category: <A: Code Bug / B: Spec Deviation / C: Approach Limitation>
Root cause: <1 to 2 sentences>
Evidence: <specific doc reference, corrections entry, or code comparison>
Confidence: <high / medium / low>
```

**If confidence is low,** say so and explain what additional information would raise it. Do not attempt a fix at low confidence. Use the escalation protocol below instead. Print the block, then move to Step 6.

### Step 6: Propose the fix (only after Steps 2 to 5)

Only now, after observing, reading docs, checking the corrections log and diagnosing, propose a fix. The approach depends on the category.

**Category A (Code Bug):**

- Show the exact change with before and after.
- Reference the documentation that defines the correct pattern.
- Explain why the current code is wrong, not just what to change.

**Category B (Spec Deviation):**

- Propose both the code fix and the update to the spec or plan.
- Flag the case as a candidate corrections log entry; the post-merge skill records it when the work merges.
- Note whether other open tickets in the same area might share the wrong assumption.

**Category C (Approach Limitation):**

- **Stop. Do not attempt a fix.**
- Present two or three alternatives with their trade-offs and a recommended pick.
- Ask the operator to decide.
- Proceed only after explicit direction. Architectural decisions belong to the operator, not the agent.

A recorded decision in Part 4 of the state document or in `{{ref:paths.architecture}}` or `{{ref:paths.business_rules}}` is not a bug to fix. If the observed behavior is a recorded decision, report that and cite the record. Reopening it takes new evidence the record does not already contain, named in the report.

### Step 7: Verify the fix

After applying a fix:

1. Rerun the **exact reproduction command** recorded in Step 2.
2. Confirm the original error is gone.
3. Run the project's checks for regressions, each from the manifest and each skipped if empty: `{{ref:commands.lint}}`, `{{ref:commands.typecheck}}`, `{{ref:commands.test}}`. Report any empty command as "not configured".
4. **If the fix introduced a new error,** go back to Step 2 with the new error. Do not stack another fix on top. That stacking is the exact pattern this skill prevents.

If a fix turns out to correct a pattern worth recording, say so in the report so the post-merge skill can add a corrections entry. Do not edit the corrections log from here.

---

## Escalation protocol

If after Steps 2 to 5 you cannot determine the category with medium or high confidence, present this to the operator instead of guessing:

```
I've completed the structured debugging protocol but cannot confidently
diagnose this issue.

OBSERVATION: <step 2 output>
DOCS CONSULTED: <step 3 output>
CORRECTIONS CHECKED: <step 4 output>
BEST GUESS: <tentative diagnosis>
CONFIDENCE: Low

What I need to raise confidence:
  <specific question or information needed>

Would you like me to:
  (a) Investigate further by checking <specific additional source>
  (b) Proceed with my best guess (Category <X>), understanding it might be wrong
  (c) Skip this for now and move to the next task
```

This is far more valuable than a confident-sounding wrong answer. The operator often holds context the agent lacks and can direct the investigation efficiently.

---

## Key behaviors

1. **Never attempt a fix without completing Steps 1 to 5.** Step 1 decides whether the full protocol is needed. If it is, finish observation, docs, corrections and diagnosis before touching code.
2. **Never attempt a second fix without rerunning the entire protocol from Step 2.** A failed fix means the diagnosis was wrong. More guessing will not help, and the answer is almost always in the reference docs or the corrections log.
3. **Always cite specific documentation.** File paths, not vague references.
4. **Always classify into Category A, B or C.** It forces precise thinking and tells the operator what kind of problem this is.
5. **For Category C, always stop and ask.** Present options; do not decide.
6. **Never read or edit files matching `{{ref:secret_globs}}`** while investigating, and never read a folder in `{{ref:protected_trees}}` as guidance. If the cause seems to live in one of them, ask the operator for the specific file.
7. **Never open a connection to a production system.** If the diagnosis needs production data or logs, hand the operator the exact short command to run and stop; diagnose against a local copy instead.
