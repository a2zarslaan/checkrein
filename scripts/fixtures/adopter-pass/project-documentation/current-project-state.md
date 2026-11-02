# Current project state

Current as of: a1b2c3d (PR #12). Part 1 verified at: never.

## Part 1: Structural inventory

### Workspace: app

One notes table, one search index, two routes.

| Interface | Purpose |
|---|---|
| `project-documentation/architecture.md` | Why the search index is built this way |
| ~~`src/search/legacy-index.ts`~~ | Retired by PR #12 |

## Part 2: Delta log

### PR #12: Rebuild the search index on rename

- The search index is rebuilt on rename.
- **-1 interface(s):** `src/search/legacy-index.ts` removed (folded into `project-documentation/architecture.md`)

## Part 3: Open gaps

- Search does not yet rank by recency.

## Part 4: Accepted debt and settled decisions

| Shape | Why it stands | Source |
|---|---|---|
| The index is rebuilt in full on every save | Simple and fast enough for small teams | PR #12 |
