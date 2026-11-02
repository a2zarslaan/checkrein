# Corrections log

<!--
The comment is stripped before the check scans headings, so this example with an unknown tag is ignored.

### Pattern [nowhere]: An example inside a comment is never checked.

**Files affected:** `src/does-not-exist.ts`
-->

## PR #12: Rebuild the search index on rename

### Pattern [backend, database]: Search results go stale when the index is not rebuilt after a note is renamed.

- **What went wrong:** A rename updated the note but left the search index pointing at the old title.
- **Correct approach:** Rebuild the index entry in the same transaction as the rename.
- **Rule:** Every write to a note also writes its index entry.
- **Files affected:** `project-documentation/architecture.md`
- **Reference:** `project-documentation/architecture.md#search-index`
- **Recurrence:** first occurrence

### Convention [process]: Every pull request names the issue it closes.

- **What went wrong:** Merged work could not be traced back to its issue.
- **Correct approach:** End the pull request body with a closes line.
- **Rule:** One issue per pull request, named in the body.
- **Files affected:** none

```md
### Not a heading: lines inside a fenced block are not checked.
```
