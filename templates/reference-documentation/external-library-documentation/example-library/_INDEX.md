<!--
Contract: the index of one library folder. Every folder in this tree has
one, and an agent reads it in full before opening any other file here.

What belongs here: where the material came from, the exact version it
matches, its licence, how to use the folder, a map from common questions to
files, and what the folder does not cover.

What never belongs here: project rules or decisions, or advice that is not
in the vendored material. If the project uses the library in a particular
way, that belongs in the architecture record.

Who writes it: whoever vendors the library or moves its pin, in the same
commit. This is one of the only files in the tree that may be edited.

Copy this file into a new library folder, replace every placeholder, and
delete this example folder once a real library is indexed.
-->

# Example Library: Index

## Source

- **Upstream:** <source URL of the documentation>
- **Version:** <the exact version the project pins>
- **Licence:** <licence name>, which permits redistribution (otherwise this folder is index-only and holds no copies)
- **Kind:** vendored copy, or index-only (pages fetched on demand at the pinned version)

## How to use this folder

Read this index in full, find your question in the table below, and open only the files it names.
If the question is not in the table, search this folder's file names before reading any page in full.

## Question to file

| Question | File |
|---|---|
| How do I install and configure it? | `guides/<getting-started>.md` |
| What is the signature of the main call? | `api/<core-function>.md` |
| How do I handle its errors? | `guides/<error-handling>.md` |
| What changed in this version? | `<changelog-or-migration>.md` |
| How do I test code that uses it? | `guides/<testing>.md` |

## Not covered

What this folder does not answer, so an agent stops looking here and asks the operator.
Example: plugins and extensions, and any version other than the pinned one.
