<!--
Contract: the architecture record. It answers "why is the system built this
way?"

What belongs here: platform and stack choices, the mechanisms that carry the
system (how a request is authorized, how data reaches the client, how a job
retries), infrastructure and deployment decisions, and for each one the
alternatives rejected and the condition that would reopen it.

What never belongs here: how a feature behaves for a user (that lives in the
business rules record), what exists in the code right now (the state
document), anti-patterns (the corrections log), or per-PR narrative (the
changelog). One fact, one home: when a decision has a behavioral side, state
the behavior in business rules and the mechanism here, and let each point to
the other instead of repeating it.

Who writes it: whoever makes the decision, at decision time, in the same PR
or commit that carries it out. The post-merge skill cross-references this
file when a merge changes a mechanism and flags entries the merge made wrong.

How agents read it: the docs skill's governing-docs check pulls the sections
that govern a task: the Shared section plus the section for the task's own
workspace, never another workspace's section. Decided entries are hard
constraints. Changing one means editing it in the same PR, with operator
sign-off, never a silent divergence in code.

Layout: "## Shared" first, then one "## Workspace: <name>" section per entry
in the manifest's `workspaces` list, named exactly as the manifest names it.
Untagged content under Shared must hold for every workspace.

Entry shape, one per decision:
### <Decision name>
- **Decision:** what was chosen, in one or two sentences.
- **Why:** the forces that made it the right choice.
- **Rejected alternatives:** what else was considered and why it lost.
- **Revisit when:** the observable condition that would reopen it.
-->

# Architecture

## Shared

### Platform and stack

Name each platform choice that every workspace depends on (language, runtime, data store, hosting) and why it was chosen over the obvious alternative.
Pin versions in the manifests and configs, not here; this section records the reasoning only.

### Mechanisms

One entry per cross-cutting mechanism: authorization, data access, error handling, background work.
Write the mechanism so an agent can recognize code that bypasses it.

### Infrastructure and deployment

Where the system runs, how a change reaches production, and how it is rolled back.
The step-by-step procedure belongs in a runbook; this section says why the procedure is shaped that way.

### Attachments live in object storage (example, replace)

- **Decision:** note attachments are stored in object storage; the database holds only the object key.
- **Why:** backups stay small and the storage host serves files without the app in the path.
- **Rejected alternatives:** database blobs, because every upload would grow every backup.
- **Revisit when:** attachments must be deleted in the same transaction as their note.

## Workspace: app

Decisions that hold only for this workspace, in the same entry shape.
Add one "## Workspace: <name>" section per workspace the manifest lists, and delete the ones a single-package project does not need.

### Stack

The workspace's own framework, build tool and test runner choices, each with its reason.

### Mechanisms

Patterns this workspace follows that the others do not, such as how screens fetch data or how state is held.
