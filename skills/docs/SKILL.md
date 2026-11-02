---
name: docs
description: Run before writing or changing any code, proposing an implementation approach, reading library docs online, or attempting a fix for any error, even when the task feels small. It reads the manifest (checkrein.json), the corrections log heading index, the decided rules in the business rules and architecture records (the Governing-Docs Check), the state document, and the vendored library and pattern docs through each folder's _INDEX.md. A tier gate scales the reading to the change; prose-only doc edits read almost nothing, surgical edits read little, new surface reads the full fan-out, and documents that describe code tier as the code they describe. It prints a file resolution table, the read level and why, the indexes and files read, the corrections rules that applied, and the governing sections read. Trigger phrases include "use the docs skill", "check the docs", "look up <library>", "how do I do X", "what is the pattern for Y", "which file shows Z". When unsure whether to invoke it, invoke it.
---

# docs

## Overview

Before implementing anything, check the project's own records and its local reference documentation. The project keeps curated, version-specific docs for its libraries and patterns under `{{ref:paths.refdocs_root}}`. Every folder there is fronted by an _INDEX.md that maps topics to exact file paths: read the index, then read only the files it points to.

This skill prevents four failures: a hallucinated API, a repeated mistake the corrections log already records, a relitigated decision the governing docs already settled, and a misapplied pattern. Invoking it is always cheap because the tier gate scales the reading. Skipping the invocation is what is not allowed.

Claude Code note: read files with Read, search with Grep or Glob, and issue independent reads as parallel tool calls in one message.

---

## Engineering standard

The project expects production-grade code: consistent, maintainable, and built on the patterns the project already uses. Hacks and short-term workarounds are not acceptable substitutes for the proper pattern.

The pattern-reference folders under `{{ref:paths.refdocs_root}}` (any folder whose _INDEX.md describes it as a pattern reference rather than a library's documentation) are the quality benchmark. When a quick approach and the pattern shown in a reference differ, follow the reference. Consistency with the rest of the codebase matters as much as correctness.

---

## Protocol

### Step 0: Resolve the manifest

1. Read the manifest, checkrein.json at the repository root.
2. Substitute every `{{ref:<dotted.key>}}` token in this skill with the manifest value at that key. Array keys (`{{ref:domains}}`, `{{ref:workspaces}}`) are lists; the step that cites one says how it is used.
3. If the manifest is missing or does not parse, STOP and print: `Manifest not found (or invalid): run the init skill to install checkrein.json, then rerun docs.` Do not guess paths.
4. If a key this skill cites is absent or empty, STOP and name the key. Never fall back to a default path from memory.

**Session context reuse.** Before reading the manifest, any _INDEX.md, the corrections heading index, or a governing-docs heading index, scan the conversation. If another skill earlier in this session already loaded it and nothing has changed since, reuse that result instead of reading again.

### Step 1: File resolution table

Check that each file exists and print the table before anything else.

| File | When required | Status |
|------|---------------|--------|
| checkrein.json | Always | FOUND / MISSING |
| `{{ref:paths.corrections_log}}` | Always | FOUND / FOUND (empty) / MISSING |
| `{{ref:paths.state_doc}}` | Always | FOUND / MISSING |
| `{{ref:paths.business_rules}}` | Read level 1 and read level 2 | FOUND / MISSING |
| `{{ref:paths.architecture}}` | Read level 1 and read level 2 | FOUND / MISSING |
| `{{ref:paths.refdocs_root}}` | Read level 2 | FOUND / MISSING |

- A required file that is **MISSING**: STOP and ask the operator. Never recreate one by hand. These are long, append-heavy records, and a hand-written replacement is a second copy that silently drifts from the real one.
- The corrections log **FOUND (empty)**: proceed and say `Corrections log checked: no patterns recorded yet.`
- `{{ref:paths.refdocs_root}}` **MISSING** at read level 2: say so in the output, then use the official online docs pinned to the exact version the project's dependency manifest declares. Never use the latest version by default.

### Step 2: Standard Corrections Log Check

Run this at every read level. The tier gate scales only the reference reads, never this check.

The corrections log is newest first and append-only. Its rule headings carry domain tags from the closed vocabulary `{{ref:domains}}` and have the form `### Pattern [<domains>]: <failure-mode sentence>` or `### Convention [<domains>]: <convention sentence>`. The headings are the index.

1. Build the index with one search over headings only: `grep -nE '^### (Pattern|Convention) \[' {{ref:paths.corrections_log}}`. On a mature project this index alone can run to thousands of tokens. That is expected, and it is still a small fraction of the log: never read the whole file to save a step.
2. Scan every heading line, including those tagged with domains the task does not touch. The headings are full failure-mode sentences, and scanning all of them is what catches a rule you would not have known to search for.
3. Pull each entry whose tags or wording match the task's domains or specifics, plus every entry tagged `process` (it applies to every change). Pull an entry by reading about 40 lines from its heading's line number, enough to cover its **What went wrong**, **Correct approach**, **Rule** and **Files affected** fields. When unsure whether an entry applies, pull it.
4. Pulled rules are **hard constraints**. They override general library documentation where the two conflict.
5. A task that must deviate from a pulled rule names the rule and the reason in the pull request body. Never ignore a rule quietly.
6. Record which rules applied for the output (Step 9).

### Step 3: Tier gate (scale the reading to the change)

The tier gate assigns one of three read levels (0, 1, 2). Read levels measure how much to read for one change; they are unrelated to checkrein's release tiers.

Decide the read level from objective properties of the change you are about to make. "The task feels simple" is not a criterion: the gate exists so you never have to trust that instinct.

**Route before you rank.** If the task authors or updates a document that describes code (an implementation plan, a feature spec, a story, a runbook, an architecture record), it is read level 2 for every domain the document will make claims about, and you do not evaluate the read level 0 row at all. The document may still be empty when you decide; what it will assert is already known from the task, so decide the level on that.

| Read level | Applies when | Reference reads |
|------|--------------|-----------------|
| **0: prose-only docs** | ONLY these edit kinds: status or progress updates, changelog narrative, index lines, typo, grammar, link and structure fixes. Their correctness does not depend on what the code is. This is a closed list: an edit kind not named here is not read level 0. Plans, specs, stories, runbooks and architecture records never qualify (rule above). | None. Skip Steps 4 to 8 and go to Step 9. |
| **1: surgical edit** | Editing existing code files only, AND adding no new import, AND calling no library API not already present in the touched files. | Skip the index fan-out (Steps 5 to 7). If a specific pattern question comes up, use one _INDEX.md lookup to read the single most relevant file, nothing more. Run Step 4 and Step 8, then Step 9. |
| **2: new surface** | Anything else: new files, new endpoints, routes, models or components, new dependencies, schema changes, auth or security configuration, or any library API not already verified this session. | The full protocol, Steps 4 to 9. |

**Code inside documentation is code.** Plans, runbooks, specs and architecture records carry copy-paste-ready snippets, commands and API signatures that later agents and the operator run on trust. A snippet written into a doc tiers exactly as it would in a source file: an example that calls an unverified library API is read level 2 for that domain.

**Docs derived from code tier as the code they describe.** A document whose content is based on the codebase or the reference docs (an implementation plan for a new feature, a story's implementation notes, an architecture snapshot) is read level 2 for every domain it makes claims about, even when the change is entirely prose with no code blocks. Every file path, endpoint, model field, pattern and API it asserts must come from the Step 5 to 7 reads, not from memory. A hallucination written into a plan gets executed later, with full confidence, by whoever implements it. Story writing runs this same pass before breaking work into issues.

The read level is decided by **what the change asserts, not by the file type it lands in.**

**Escalation trigger (hard rule).** A read level 0 or read level 1 decision is provisional. The moment the work needs an import you are adding, or a library call not already present in the file (including inside a snippet you are embedding in a document), STOP before writing that line and run the full read level 2 protocol for that domain. The same holds for prose: about to assert a file path, endpoint, field or API behavior you have not verified by reading? You are not in read level 0; run read level 2 for that domain. Hallucinated-API risk sits exactly at new library surface, and the trigger fires exactly there, which is what makes the cheap read levels safe.

State the read level and its reason in one line before going on, for example `Read level 1: editing existing validation logic in one form component, no new imports`.

### Step 4: Governing-Docs Check (Read level 1 and read level 2)

`{{ref:paths.business_rules}}` records decided behavior (what the system must do). `{{ref:paths.architecture}}` records decided mechanisms and why they were chosen. Recall the sections that govern this task before writing anything. Skip only at read level 0: an edit whose correctness does not depend on the code has no governing rule to break.

1. Build the section index: `grep -nE '^(## (Shared|Workspace: )|### )' {{ref:paths.business_rules}} {{ref:paths.architecture}}`. Each `### ` subsection belongs to the `## Shared` or `## Workspace: <name>` heading above it; ignore `### ` hits above a file's `## Shared` line (they sit in the header comment). It is cheap; reuse it if it is already in the conversation.
2. Scan every heading. Pull each section whose title matches the task's feature area or the mechanisms it touches, with a bounded read from the heading's line number. Never read either file in full. When unsure whether a section applies, pull it.
3. **Shared sections and workspace sections.** The workspaces are the entries of `{{ref:workspaces}}`, each with a `name` and a `root`. Rules that hold for every workspace sit under `## Shared`. Rules that hold for one workspace only sit under `## Workspace: <name>`. The task's workspaces are those whose `root` contains the files it touches (the most specific root wins). Pull `## Shared` plus the `## Workspace: <name>` section of each workspace the task touches, never another workspace's. A task confined to code no single workspace owns (a shared library, the repository root) pulls `## Shared` only; the workspace sections then show how each workspace consumes a rule, and are evidence, not constraints. A project with one workspace pulls its single `## Workspace: <name>` section together with `## Shared`.
4. Pulled rules are **hard constraints**, exactly like corrections entries. Implement what the section says, and treat its decided matrices, assignments and rejected alternatives as settled. Do not re-argue them in the issue, the pull request body or the code.
5. A task that genuinely needs different behavior or a different mechanism is a **decision change**: update the governing section in the same pull request, name the change and its reason in the pull request body, and get the operator's sign-off. Never diverge silently, and never leave the doc describing the old rule.

Other skills refer to this procedure as **the Governing-Docs Check**. It is defined only here.

### Step 5: Route to the indexes (Read level 2)

Do not work from a remembered list of libraries. Discover what the project has vendored:

1. List every index under the reference root: `find {{ref:paths.refdocs_root}} -name _INDEX.md`. Reuse the list if it is already in the conversation.
2. Each index's folder name and opening lines say what it covers: one library's documentation, or a pattern reference for one kind of code.
3. Pick every index that matches a library or pattern the task touches: the libraries whose APIs the change calls or will call, the pattern reference for the kind of code being written, and the library behind any configuration being changed. Several domains involved means several indexes; read every applicable one.
4. A library the task touches that has no index: use the official online docs pinned to the exact version in the project's dependency manifest, and say so in the output.

Besides the indexes, route project questions to the project's own records:

| Question | Source |
|----------|--------|
| What exists today: endpoints, routes, models, modules, screens, scripts | `{{ref:paths.state_doc}}` (Part 1). Use it as an index to locate the code, then read the live code: the codebase wins on any conflict. |
| What has been accepted as debt or settled, so it is not re-raised | `{{ref:paths.state_doc}}` (Part 4) |
| How a feature must behave: cascades, scoring, gating, limits, decided matrices | `{{ref:paths.business_rules}}`, through Step 4 |
| Why a mechanism, platform or infrastructure choice was made, and when to revisit it | `{{ref:paths.architecture}}`, through Step 4 |
| The plan or audit for the ticket being implemented | The matching working doc in `{{ref:paths.working_docs_dir}}` (`plan - <descriptor>.md` or `audit - <descriptor>.md`). A missing file usually means the work already shipped and its doc was retired. |
| An operational, deploy or rollback procedure | The runbooks in `{{ref:paths.runbooks_dir}}` |
| The data model | When the task touches persisted data, read the schema source of truth that {{ref:paths.architecture}} names (if the architecture record names none, say so in the output and continue). Never a hand-written table in a doc. |

### Step 6: Read the chosen _INDEX.md files in full

Read each chosen index in full before reading any file inside its folder. Issue the reads in parallel when several apply. Never search an index for a single row: its "not in this folder" notes and indexing notes qualify every row, and a row pulled out alone loses them.

If an index you expected is not at its path, **stop and surface the broken path** in the output instead of producing guidance without it, for example `<folder>/_INDEX.md not found under {{ref:paths.refdocs_root}}`. Path drift is the most common cause of stale guidance; naming it beats inventing patterns from memory.

### Step 7: Find the exact file paths

Each index carries a "what to find where" table mapping tasks to files. Take the rows relevant to the task and extract their file paths. For a data-model task, also read the schema source of truth that {{ref:paths.architecture}} names to see the models involved.

### Step 8: Read only those files, then check for conflicts

Read the files identified in Step 7 (at read level 1, the single file from the one lookup, if any). Do not skim whole folders: targeted reads are faster and more reliable. Then apply the Conflict resolution protocol below.

### Step 9: Produce output

Follow the Output contract below.

---

## Adapting a reference

- A pattern reference may be built on a different library than the project uses for the same job (a different data layer, a different HTTP client). Take the structure and the discipline, adapt the code to the project's own library, and never copy library-specific layers verbatim.
- A pattern reference is not a dependency list. Where its _INDEX.md marks one of its choices as not adopted by the project, never adopt it.
- A pattern template can sit on an older version of a framework than the project. Take version-specific setup (configuration, build tooling, environment files) from that library's own vendored docs, never from the template's configuration files.

## Visual values come from the design tokens

For any user interface work, colors, typography, spacing and other visual values come from the project's central theme or token source, never from a literal at the call site (no arbitrary hex value, no inline font size, no magic number). Read the token source before prescribing any visual value. If a token is missing, the fix is a new token in that source, not a literal where it is used.

## Explain the why where it is not obvious

When the work is in an area the operator has said they know less well ({{ref:paths.brief}} records this), name each pattern used and say in a sentence why it fits, for example why a write and its index update share one transaction, or what an access check decides before a request is handled. Do not annotate the obvious.

---

## Conflict resolution protocol

**Hard stop: do not implement anything until the operator explicitly chooses.**

A conflict exists when two or more reference sources give genuinely different instructions for the same thing: different API signatures, different structural patterns, or contradictory recommendations.

Do NOT treat these as conflicts:
- The corrections log contradicts general library docs. The corrections log always wins; it is the project-specific override.
- The sources cover different layers (a guard and an input validator are complementary, not conflicting).
- A pattern reference uses a library the project does not; adapt to the project's library (see Adapting a reference). Flag a conflict only when two sources about the project's own library disagree.

When a conflict exists, print:

```
CONFLICT DETECTED: waiting for your decision

What I was trying to do: [one sentence]
Source A ([folder]): [file path] > [the conflicting guidance, quoted]
Source B ([folder]): [file path] > [the conflicting guidance, quoted]
Why they conflict: [the practical difference]
My recommendation: Source [A or B], because [reason]
```

Quote or closely paraphrase the conflicting text so the operator can decide without opening files. Do not pre-implement either option. Wait for an explicit reply.

---

## Output contract

Every run of this skill prints all of the following. A missing block means the step it reports was skipped.

```
File resolution: [the Step 1 table]

Read level: [0, 1 or 2]: [one-line reason]

_INDEX.md files read: [list, or "none (Read level 0: prose-only edit)" or "none (Read level 1: surgical edit, no new library surface)"]
Specific files consulted: [each file with its purpose, or "none"]
Online docs used: [library and pinned version, or "none"]

Corrections log: [exactly one of the lines below]
Governing docs: [exactly one of the lines below]
```

The corrections line is exactly one of:
- `Corrections log: <N> relevant entries found: [heading of each rule that applied]`
- `Corrections log: checked, no relevant patterns`
- `Corrections log checked: no patterns recorded yet.` (the file exists but holds no rules)

There is no line for a missing corrections log. A missing log stops the run in Step 1; never downgrade that stop to a warning.

The governing-docs line is exactly one of:
- `Governing docs: pulled [business rules: <section>; architecture: <section>] (constraints applied)`
- `Governing docs: no governing sections for this task`
- `Governing docs: skipped (Read level 0)`

Cite each corrections rule by its exact heading, never a paraphrase: the headings are the search keys other skills use.

Then give the guidance or the implementation the task asked for, grounded in the files listed above.
