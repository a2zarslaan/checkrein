<!--
Contract: the business rules record. It answers "what does the system do?"

What belongs here: decided behavioral rules a test could check: cascades
(what happens to children when a parent changes), scoring and calculations,
lifecycle (the states a record moves through and what moves it), gating
(who may see or do what, and when), defaults, and limits.

What never belongs here: the mechanism that implements a rule (that lives in
the architecture record), what exists in the code (the state document),
anti-patterns (the corrections log), or open questions. A rule that is not
decided yet is not a rule; keep it in the issue until the operator decides.
One fact, one home: state the behavior here and point to the mechanism.

Who writes it: the operator decides every rule; whoever implements the
decision writes it here in the same PR that ships the behavior. Changing an
existing rule means updating this file in the same PR, with operator
sign-off. The post-merge skill cross-references this file when a merge
changes behavior and flags any rule the merge contradicts.

How agents read it: the docs skill's governing-docs check pulls the sections
that govern a task: the Shared section plus the task's own workspace
section, never another workspace's. Decided rules are hard constraints. Code
that disagrees with a rule is a bug in the code or an unrecorded decision;
the agent asks which, and never changes either one silently.

Layout: "## Shared" first, then one "## Workspace: <name>" section per entry
in the manifest's `workspaces` list. Shared rules must hold for every
workspace.

Rule shape, one per rule:
### <Rule name>
<The rule, stated as observable behavior, in one to three sentences.>
- **Why:** the reason the operator gave.
- **Source:** the issue or PR that decided it.
-->

# Business Rules

## Shared

### Lifecycle

The states each core record moves through, what moves it from one to the next, and which transitions are forbidden.

### Cascades

What happens to dependent records when a parent is edited, archived or deleted.

### Deleting a notebook (example, replace)

Deleting a notebook moves its notes to the trash. They can be restored for 30 days, then are purged for good.
- **Why:** a mistaken delete must never lose work (priority 1 in the project brief).
- **Source:** the issue or PR that decided it.

### Gating

Who may see or change what: roles, ownership, plan limits, feature flags. State the rule from the end user's side.

### Scoring and calculations

Every number the product computes for a user (totals, counts, ranks, scores), with its formula and its rounding.

### Defaults and limits

Default values, maximum sizes and quotas, each with the behavior when a limit is reached.

## Workspace: app

Rules that apply only to this workspace, in the same rule shape.
Add one "## Workspace: <name>" section per workspace the manifest lists; a single-package project keeps only this one.
