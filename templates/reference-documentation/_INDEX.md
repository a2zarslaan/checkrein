<!--
Contract: the root index of the reference documentation tree.

What belongs here: one row per subfolder, saying what it holds and the
version it is pinned to, so the docs skill can route a task to the right
folder without opening any of them.

What never belongs here: summaries of the libraries themselves (each
folder's own _INDEX.md holds those) or project instructions of any kind.

Who writes it: whoever adds, removes or re-pins a reference folder, in the
same commit. This file and the per-folder _INDEX.md files are the only files
in the tree that may be edited.

How agents read it: in full, first. Pick the folders whose rows match the
task, then read each chosen folder's _INDEX.md in full before any other file.

Replace the placeholder rows below with one row per real folder, and delete
the example row once a real library is indexed.
-->

# Reference Documentation Index

Read this file in full first, then the _INDEX.md of each folder your task needs.

## Library documentation

| Folder | What it holds | Pinned version | Kind |
|---|---|---|---|
| external-library-documentation/example-library/ | Placeholder showing the index contract; replace it | none | example |
| external-library-documentation/<library>/ | One line: what the library does for this project | the exact pinned version | vendored or index-only |

## Pattern references

| Folder | What it holds | Source |
|---|---|---|
| <area>-patterns/ | One line: which part of the project this example code models | where it came from and at what version |

## Not covered

List the libraries the project uses that have no folder here yet, so an agent knows to ask rather than guess.
