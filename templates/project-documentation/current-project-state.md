<!--
Contract: the state document. It answers "what exists right now?" for every
workspace the manifest lists.

What belongs here: nouns, not narrative. Modules, routes or screens, data
models, guards and permissions, scripts, test counts, open production gaps,
and the accepted debt and settled decisions reviewers must not re-raise.

What never belongs here: what a change meant (the changelog), why a design
was chosen (the architecture record), how a feature behaves (business
rules), or anti-patterns (the corrections log).

Who writes it: the post-merge skill, on every run. It always rewrites the
currency marker line to the merge commit sha it has processed through. Only
a merge that passes its structural-significance gate also earns a Part 2
entry and in-place corrections to Part 1. A project may split this record
into one file per workspace by adding files; the default is one document.

How agents read it: planning and story-writing agents ground every file
path, route and model name in Part 1. Reviewers and implementers read Part 4
first: an observation that matches a Part 4 row is not a finding.

Structure (the check enforces it): the currency marker is the first line
after the title, and the four Part headings appear exactly as written below,
in this order. Always trust the live code when it disagrees with Part 1, and
correct Part 1.
-->

# Current Project State

Current as of: template install, no merges recorded yet

## Part 1: Structural inventory

A snapshot overwritten in place, never appended. One subsection per workspace the manifest lists, each with the same headings.

### Workspace: app

- **Modules:** each module or package and its one-line purpose.
- **Routes or screens:** every route, endpoint or screen, with the guard that protects it.
- **Models:** each data model and its one-line purpose; the schema file stays the source of truth.
- **Guards:** authentication, permission and rate-limit layers, and where each applies.
- **Tests:** the suite count per runner, with the command that produces it.

## Part 2: Delta log

Append-only, newest first. One entry per structurally significant merge: a "### PR #<number>: <intent>" heading and 5 to 15 lines naming what was added, removed or reshaped.
No entries yet.

## Part 3: Open gaps

Known production gaps that are still open, one table row each, with the issue number that tracks it.

| Gap | Issue | Impact |
|---|---|---|
| (none yet) | | |

When a gap closes, the post-merge skill removes its row and records the closing merge in Part 2.

## Part 4: Accepted debt and settled decisions

The settled-items list every reviewer reads first. One row per item: the shape, why it stands, and the PR that settled it.
Reopening a row takes new evidence the row does not already contain, named in the finding that reopens it.

| Item | Shape | Why it stands | Source PR |
|---|---|---|---|
| (none yet) | | | |
