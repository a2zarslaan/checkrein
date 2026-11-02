# Cross-cutting review checklist (every pull request)

dev-review reads this checklist on every round 1 review. Tokens of the form `{{ref:<dotted.key>}}` resolve from the manifest, as in the skill. Flag an item only when the diff actually breaks it, and cite the evidence the skill requires (Step 8). Projects add stack-specific checks in their own `{{ref:paths.docs_dir}}review-checklists/checklist-<domain>.md` files in their repository; keep this file generic.

## Security

- [ ] No injection paths: user input never reaches a shell command, a query string, a file path, or rendered markup without validation, parameterization or escaping.
- [ ] Every new or changed entry point (endpoint, handler, job, command) checks who may call it, at the same strength as its neighbors.
- [ ] Untrusted data is not deserialized, evaluated or used to build code.
- [ ] Errors and logs do not expose secrets, tokens or personal data.

## Secrets

- [ ] No file matching `{{ref:secret_globs}}` is added or changed.
- [ ] No keys, tokens, passwords or connection strings in code, fixtures, test data, examples or docs. Placeholders only.

## Boundaries between workspaces

- [ ] Code in one workspace of `{{ref:workspaces}}` imports another workspace through that workspace's public package name or entry point, never through a relative path into its source.
- [ ] A shared package stays portable to every workspace that consumes it: no runtime-specific globals or APIs that only one consumer has.
- [ ] No file under `{{ref:protected_trees}}` is edited, imported or cited as the authority for new code.

## Correctness and types

- [ ] Error paths are handled: failures are caught where they can be acted on, never swallowed silently.
- [ ] Null and empty cases are handled where the data can be missing.
- [ ] No type-system escape hatches (an unchecked cast, a blanket ignore, a suppression comment) without a stated reason at that line.

## Dependencies

- [ ] Every added or changed dependency is pinned to an exact version, unless the hub names an exception that covers it.
- [ ] The lockfile changes in the same pull request as the manifest that caused it, and only for that change.
- [ ] No library outside the declared stack in `{{ref:paths.architecture}}` is introduced, and no rejected alternative recorded there, without a recorded decision in that same file.

## Tests

- [ ] Changed behavior has a test that would fail without the change.
- [ ] No existing test's logic is altered to make it pass. A deliberate change to a test names the test it retires in the pull request body.

## Comments and records

- [ ] No long comment written to defend the code. A comment states a constraint the code cannot express, in a few lines; rationale belongs in `{{ref:paths.architecture}}`, behavior rules in `{{ref:paths.business_rules}}`, anti-patterns in `{{ref:paths.corrections_log}}`.
- [ ] Code does not cite corrections entries or pull request numbers. Those citations go stale and duplicate the log.
- [ ] Behavior the diff changes is updated in the governing section of `{{ref:paths.business_rules}}` or `{{ref:paths.architecture}}` in this same pull request.

## Scope and process

- [ ] The pull request targets `{{ref:vcs.trunk}}`, or a base branch the operator named (a stacked pull request).
- [ ] The diff changes what the linked issue names. Any change outside that scope is a blocker the pull request body names, not an improvement made in passing.
- [ ] The pull request body links the issue it closes, and that issue number is the right one.
- [ ] No working doc in `{{ref:paths.working_docs_dir}}` breaks the naming rule (`plan - <descriptor>.md` or `audit - <descriptor>.md`).
- [ ] User-facing strings follow the copy rules in `{{ref:paths.business_rules}}`, if the project records any.
