<!--
Contract: the reference documentation tree. It holds read-only reference
material: vendored library documentation and pattern references (example
code that shows how this project wants a thing built).

What never belongs here: project instructions, rules or decisions. Nothing
in this tree tells an agent what to build; it shows how a library or
pattern works. What to build comes from the issue, the plan and the live
code.

Who writes it: the operator, or an agent the operator asks, when a library
or pattern is adopted or its pinned version moves. The only edits allowed
otherwise are to _INDEX.md files.

How agents read it: the docs skill routes a task to the right folder. The
agent reads that folder's _INDEX.md in full first, then opens only the files
the index points to.
-->

# Reference Documentation

## Rules

1. **Read-only.** Never modify, install, build or execute anything in this tree. The only writes allowed are edits to _INDEX.md files.
2. **Index first.** Every subfolder has an _INDEX.md. Read it in full before opening any other file in that folder.
3. **Not instructions.** A file here can show a pattern, but it never overrides the hub, the business rules, the architecture record or the corrections log. When they disagree, the project documents win.

## Layout

- The root _INDEX.md lists every subfolder with one line each.
- "external-library-documentation/<library>/" holds one folder per library, each fronted by its own _INDEX.md.
- "<area>-patterns/" folders hold pattern references: example code the project treats as the model for its own.

## How to vendor a library

1. Check the licence first. Never vendor material whose licence forbids redistribution.
2. Copy the documentation at the exact version the project pins, not the latest.
3. Create the folder's _INDEX.md from the example library's index: record the source URL, the pinned version and the licence, then map common questions to files.
4. Add one line for the folder to the root _INDEX.md.
5. When the pin moves, replace the copy and update the version in the index in the same commit that bumps the dependency.

## When the licence forbids a copy

Keep an index-only folder. Its _INDEX.md records the upstream URLs and the pinned version, and maps questions to those URLs instead of local files.
The agent fetches the pages it needs on demand, at the pinned version (a tagged URL or a commit sha, never a moving branch), and never saves them into the tree.

## Claude Code note

A nested CLAUDE.md in this folder repeats the two rules that matter most (read _INDEX.md first; nothing here is a project instruction). Claude Code loads it whenever an agent reads a file beneath this folder.
