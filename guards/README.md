# guards

The enforcement module of checkrein. It is switched on only in a repository whose `checkrein.json` declares manifest version 2 or higher; with no manifest, or a version 1 manifest, every entry point stays silent and decides nothing.

## Files

| File | What it is |
|---|---|
| `evaluator.mjs` | The one shell-command evaluator. Turns a command string into segments: quotes resolved, separators split, substitutions and subshells opened, heredoc bodies kept as data, redirections separated, wrappers and directory prefixes stripped from command position. Every Bash rule reads its output. |
| `manifest.mjs` | Loads `checkrein.json` (the on/off switch), fills the version 2 defaults, validates key types, and provides the path helpers: `globToRegExp`, `matchesGlob`, `isUnderTree`, `relativeToRoot`. |
| `pretooluse.mjs` | The entry point run before each tool call. Reads one JSON object on stdin, decides allow, ask or deny, prints the decision on stdout. Exports `decide` for tests. |
| `rules/` | One module per pretool rule (production, protected trees, secrets, approval), called by `pretooluse.mjs` in precedence order, plus `rules/common.mjs` for the path and argument helpers they share. |
| `stop-consulted.mjs` | The entry point run when a turn ends. Blocks (or warns) when code was edited without the required files having been read. Exports `evaluateTranscript` for tests. |
| `diff-check.mjs` | The git hook and CI fallback: checks a staged diff or a commit range for secret files, protected-tree changes and production markers. Exports `checkDiff` for tests. |
| `cases.json` | The allow, ask and deny case file: one row per rule side, carve-out and past bypass. |
| `*.test.mjs` | The tests: `evaluator`, `manifest`, `stop-consulted` and `diff-check` each have their own file; `cases.test.mjs` runs every row of `cases.json` through `decide` and a sample through the real entry point. |

## The boundary rule

Nothing in this folder imports from `scripts/` or `skills/`, and nothing outside it is needed at run time. The hooks file references only files under `guards/`. The folder moves as one unit: if enforcement is ever split out of checkrein, it travels as this folder plus one marketplace entry. The manifest loader is the one seam where the switch is decided.

## Reading segments

A segment is `{ argv, rawArgv, raw, redirects, kind, depth, index }`; the full contract sits at the top of `evaluator.mjs`. Points a rule author needs:

- `argv` is empty for a redirection-only command and for the placeholder segment that stands for a parenthesized subshell. The placeholder's `raw` holds the whole group, so a pipe out of a subshell has a segment to read from.
- `kind` says how a segment joins the one before it in its group (`pipe`, `and`, `or`, `seq`). The first segment of a group takes the group's kind: `top`, `subshell`, `substitution` or `wrapper`.
- `depth` grows by one inside each subshell, substitution and wrapper string. To find the segment a pipe reads from, walk back to the nearest earlier segment of equal depth.
- `index` is evaluation order: a substitution comes before the command that holds it; wrapper segments (`sh -c`, `bash -lc`, `eval`, `su -c`, a heredoc or here-string fed to a shell) come after their command.
- A heredoc body is data. It becomes segments only when the delimiter is unquoted and the body holds a `$( )` or backtick substitution, or when the heredoc feeds a shell.
- A command word is stripped of variable assignments, reserved words (`if`, `then`, `!`, `{`), the wrappers `sudo`, `env`, `exec`, `nice`, `nohup`, `time`, `command`, `builtin`, `timeout` and `xargs` with their options, any directory prefix, and a trailing `.exe`. A wrapper with nothing after it stays the command word; `command -v` stays `command`.
- Input the parser cannot finish errs toward deny: every word becomes a command word of its own segment.

## Running the tests

From the repository root:

```
node --test guards/*.test.mjs
```

Zero dependencies, Node 20 or newer. The tests use invented names only (`example.internal`, `deploy-user@`, port `55000`, `retired/`), and no fixture holds an em dash; a test that needs the character builds it with `String.fromCharCode`.

## Honest scope

These guards are a guardrail for cooperative agents, not a security boundary. They read commands lexically, so a determined evasion defeats them: a path assembled from variables at run time, a symlink made in an earlier command, a script written now and run later, brace or glob expansion that spells a protected name. The rule in the hub is what stops such an agent; for an operating-system boundary, layer the harness sandbox on top.

Every entry point fails closed on an internal error, in the form its event allows:

- `pretooluse.mjs` asks, with the error text as the reason, when the manifest cannot be parsed, the hook input is not valid JSON, or a rule throws. It never allows on an error.
- `stop-consulted.mjs` has no ask decision, so it blocks once with the error text; the next stop passes because the harness marks it with `stop_hook_active`.
- `diff-check.mjs` prints the error on stdout and exits 1 when the manifest cannot be parsed, an argument is wrong, `git diff` does not run, or the check throws.

Test coverage is uneven by design. The modules under `rules/` have no test files of their own, and neither does `pretooluse.mjs`: both are tested through `cases.test.mjs`, which feeds every row of `cases.json` to `decide` and runs a sample through the real entry point as a child process. A rule change therefore needs a case row, not a unit test.

The Stop hook has four behaviours to know:

- It stays silent when the transcript is lagging, empty or unreadable: the harness writes the transcript asynchronously, and a lagging file must never produce a false block.
- It blocks when the manifest cannot be loaded (fail closed, as above).
- Edits made through Bash are not seen as edits; only the file-editing tools count.
- Reads made through Bash are seen: a reader command (`cat`, `sed`, `head`, `tail`, `grep`, `rg`, `awk`, `less`) naming a required file counts as evidence.

Path comparisons work on path text, ignoring case. The PreToolUse guards also resolve a symbolic link when the path text lies outside the root, so a root opened through a link, or a target that reaches the repository through one, is still matched; a link inside the repository that points into a protected tree is compared by its own text and is not caught. The Stop hook compares text only, so a read made through another spelling of the same folder (a link, or one directory mounted under two names) does not count as evidence.
