<!--
Contract: the working docs folder. It holds implementation plans and audit
reports for work that is still in flight, and nothing else.

What never belongs here: rules, decisions, inventories or anything another
document should own. A plan is a working document, not documentation.

Who writes it: the agent or operator who starts planning or auditing a
ticket. The post-merge skill retires each doc when its ticket merges.

How agents read it: an implementing agent reads the plan for its own ticket
and follows it task by task. No other agent treats these files as guidance.
-->

# Working Docs

## Naming

Every markdown file here is named `plan - <descriptor>.md` or `audit - <descriptor>.md`: the literal prefix, then space, hyphen, space, then a descriptor that names the ticket, area or initiative.
The check fails on any other name; this README is the one exception.

Examples: "plan - notes-offline-drafts.md", "audit - search-latency.md".
The names contain spaces, so quote them in every shell command.

## Lifecycle

1. **Created** when planning or auditing starts: one file per ticket or initiative.
2. **Read** during implementation: the implementing agent follows the plan task by task and runs its verification steps after each one.
3. **Retired** by the post-merge skill when the ticket merges: the working doc leaves the live tree. It is moved into the first protected tree listed in the manifest when there is one; otherwise it is deleted after the operator confirms (git keeps the history). An initiative-wide doc is retired when its last story closes, not on the first merge.

## Never a source of truth

The durable records are the living documents in this folder's parent, the issues, git history and the live code.
A plan that contradicts them is wrong; fix the plan or ask the operator, and never change a durable record to match a plan.
A plan that outlives its ticket is a defect: stale intent is what sends a later agent down a superseded path.

## What a plan carries

- The ticket it serves and the acceptance criteria copied from it.
- Tasks in order, each with the files it touches and the command that verifies it.
- The corrections log rules and governing sections that apply, so the implementer reads them once.
- Open questions for the operator, kept at the top until answered.
