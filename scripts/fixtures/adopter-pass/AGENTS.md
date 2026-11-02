# AGENTS.md

This fixture hub cites only paths that exist, so the cross-refs check passes.

| Question | Canonical source |
|---|---|
| Project settings | `checkrein.json` |
| Product context | `project-documentation/project-brief.md` |
| Anti-patterns | `project-documentation/corrections-log.md` |
| What exists now | `project-documentation/current-project-state.md` |
| Working docs | `project-documentation/temp/` |
| Library docs | `reference-documentation/_INDEX.md` |

Tokens that are not paths are ignored: `origin/main`, `owner/repo`, `node --test`, `/reload-plugins`,
`plan - <descriptor>.md`, `{{ref:paths.state_doc}}`, `https://example.com/docs/page.md`.

A section anchor is allowed: `project-documentation/architecture.md#data-model`.

```sh
grep -nE '^### (Pattern|Convention) \[' project-documentation/corrections-log.md
```
