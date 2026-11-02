# Spot-check catalog

Check shapes for the project's own rules spot-checks in the preflight-check skill. Each row is the generic form of a rule that real projects have needed. None of them is policy: a row applies only when the hub, the business rules, the architecture record or a corrections Convention entry decides the underlying rule for the project, and the report cites that source. Replace each `<placeholder>` with the project's own value from that source.

Severity defaults: a breach that ships a defect, a security gap or a broken contract is Critical; a breach of style or maintainability is a Warning. A severity the source states wins over the default.

## How to write a check

- Prefer a search with a single, plain answer: "this search returns nothing" or "every file of this kind contains that".
- Judge line-level rules on the lines the branch adds or changes (`git diff -U0`). A match on an untouched line is pre-existing, not a violation.
- Drop comment lines when a rule is about code or shipped strings; keep them when the rule is about comments.
- Use whole-word matching (`-w`) for vocabulary rules, so a banned word does not match inside a longer word.
- A table cell cannot carry a shell pipe. Put multi-stage commands in a code block below the table.
- Run every new search once against a fixture that must match and one that must not before trusting it.
- When a check proves wrong against real code, correct it in the PR that proves it.

## Configuration and environment

| Check | How to verify | Default severity |
|---|---|---|
| Configuration read through one layer | Added lines read environment variables only inside `<config module>`; search the language's environment accessor elsewhere | Critical |
| No development values in source | Added lines outside the example env file carry no `<local origin>` or development host; the value comes from configuration with no silent fallback | Critical |

## Server and API

| Check | How to verify | Default severity |
|---|---|---|
| Every endpoint described | Each new or changed handler carries the API description the project generates its reference from | Critical |
| Every input field described | Each new or changed input type documents each field for the API reference | Critical |
| Access rule explicit | Each new handler declares who may call it (signed in, public, or a named permission); none relies on a default | Warning |
| Response and shared types cannot drift | Each response type with a shared type counterpart has a compile-time equality check; an assertion that compiles to nothing does not count | Critical |
| No rejected layer | No file adds an abstraction the architecture record rejects; search file names and imports | Critical |

## Client and UI

| Check | How to verify | Default severity |
|---|---|---|
| One HTTP client | Imports of HTTP libraries other than `<chosen client>` return nothing; direct low-level request calls in app code return nothing | Critical for a second library, Warning for direct calls |
| No rejected libraries | Imports of each library that {{ref:paths.architecture}} records as rejected, or as outside the stack, return nothing | Critical |
| No credentials in browser storage | Auth-related files do not write tokens or sessions to browser storage | Critical |
| Colours come from the theme | Hex colour literals in changed source files outside `<theme dir>`, asset files and config return nothing | Warning |
| Shared wrapper over the raw component | Direct use of the underlying component the project wraps returns nothing outside `<wrapper file>` | Critical |
| Forms validate through the shared schema | New forms resolve validation from the shared schema package, not inline rules | Warning |
| Partial updates send only what changed | A partial-update request sends only the changed fields, never a spread of the whole record, and the response merges into the previous state | Warning |

## Data schema

| Check | How to verify | Default severity |
|---|---|---|
| Foreign keys indexed | Every foreign key field in the changed schema has an index | Critical |
| Schema changes carry a migration | A schema change comes with a generated migration in the diff; no hand-written DDL against a shared database | Critical |
| Naming conventions | Model and field names follow the conventions the architecture record states | Warning |

## Shared and portable packages

| Check | How to verify | Default severity |
|---|---|---|
| No platform APIs in portable code | Browser globals and server runtime APIs in changed files of a package meant to be portable return nothing, comment lines dropped (docs may name the seams on purpose) | Critical |
| No UI framework in a headless package | Imports of UI, routing or notification libraries in a package that must stay headless return nothing; a UI reaction is an injected callback or a returned value | Critical |
| Peer dependencies stay peers | Libraries the consuming apps provide are declared as peer dependencies of the shared package, never as direct dependencies | Critical |
| Declared entry points, no catch-all barrel | New folders are reachable through the package's declared entry points; no root file re-exports everything | Warning |
| One copy of a shared runtime | When a dependency manifest changed, a runtime library that must exist once (a UI runtime, a query cache) resolves to the same path from every workspace that uses it | Warning |

## Copy

| Check | How to verify | Default severity |
|---|---|---|
| No banned glyphs in shipped strings | Changed source files carry no `<banned glyph>` in user-facing strings, comment lines dropped | Warning, or Critical when a build check also enforces it |
| Vocabulary rule | The banned term returns nothing as a whole word in shipped strings | Warning |

## Process

| Check | How to verify | Default severity |
|---|---|---|
| Comments do not cite records | Added comments carry no corrections-log line citations or pull request numbers; the rule lives in the log, not in the code | Warning |
| Comments do not defend code | Added comments longer than a few lines that justify a mechanism are flagged; the detail belongs in the architecture or business rules record | Warning |
| Test runner matches the workspace | A workspace's test files import from the runner that workspace uses, never another workspace's runner | Critical |
