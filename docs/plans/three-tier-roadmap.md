# checkrein development plan: three tiers

This is the plan the maintainer builds checkrein from. Tier 1 is the product today. Tiers 2 and 3 are designed here so the design is not lost, and each one starts only when the demand rule in section 5 is met. Nothing in tiers 2 or 3 exists until a release ships it, and no other document in this repository describes those tiers as if they do.

Two roles appear throughout. The maintainer is the person who develops and releases checkrein itself. The operator is the human who owns an adopting repository and makes its decisions.

## 1. Purpose and thesis

Coding agents fail in predictable ways: they invent APIs, repeat mistakes that were already fixed, reopen decisions that were already made, widen the scope of a change, and write long comments to defend code instead of fixing it. Each failure has a cheap counter, provided the counter runs at the right moment. checkrein supplies those counters.

The thesis in one paragraph: checks beat prose, so wherever a rule can be verified by a script, a script verifies it, and wherever it cannot, the hub states it once and every skill points back to that one statement. Each kind of knowledge has exactly one record (why the system is built this way, what the rules are, what exists right now, what went wrong, what changed), every procedure reads the record before acting and writes to it after, and those records are the memory the agent does not carry between sessions. The operator stays in charge: merges, decisions, production access and anything irreversible belong to the operator, and the skills ask rather than act on them.

The three tiers follow from that thesis. Tier 1 states the method as text and checks the records mechanically. Tier 2 adds enforcement at the moment an agent acts, for the one harness that exposes the hooks to do it. Tier 3 adds stack knowledge and adapters for other harnesses.

## 2. Tier 1: the method as text plus checks

### Contents

- The hub template (`templates/AGENTS.md`) and a thin `templates/CLAUDE.md` that imports it. The hub is a navigation map: it says where each kind of knowledge lives and which skill runs when. It holds no content that a living document owns.
- Document templates with filler under `templates/project-documentation/`: the project brief, the architecture record, the business rules record, the corrections log, the state document with its four parts, the changelog, the working docs folder, and the runbooks folder. Each template carries filler guidance that tells the operator what belongs in each section, what does not, and what a good entry looks like, using neutral invented examples.
- The reference tree template under `templates/reference-documentation/`: the folder convention for vendored library and pattern docs, each folder fronted by a `<folder>/_INDEX.md` file, with placeholder names only. The kit never ships another project's documentation.
- Nine skills under `skills/`: `docs`, `dev-code`, `dev-review`, `github-story-writer`, `package-upgrade`, `post-merge`, `preflight-check`, `structured-debugging`, and `init`, which installs the templates into an adopter's repository without overwriting anything and asks the operator for the manifest values it cannot infer.
- The manifest template (`templates/checkrein.json`). Every skill that needs a project value resolves it from the manifest in Step 0 and stops, telling the operator to run `init`, when it is missing.
- The adopter check (`scripts/checkrein-check.mjs`), a single zero-dependency file copied into the adopter's repository. It verifies that the manifest parses and its paths exist, that corrections-log headings follow the grammar, that working docs follow the naming rule, that the state document has its four parts and its currency marker, that the changelog's subsections sit inside a section and are only Added, Changed or Fixed, that the docs folder holds no em dash, and that backticked repository paths cited in the docs exist.
- The repository checks (`scripts/repo-checks.mjs`) and their tests, which hold this repository to the same hygiene it asks of adopters.
- Plugin packaging (`.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`), with skills discovered from the folder, and no hooks.

Maintaining the templates is part of tier 1, not a one-off: when a living document's shape changes in the maintainer's own projects, the matching template and its filler guidance change with it, and the reference tree template keeps describing how to vendor and index rather than what to vendor.

### Goal

Tier 1 is done when a fresh adopter repository, initialized by the `init` skill and filled with the operator's answers, passes the adopter check with no edits by hand, and this repository passes its own checks, its tests, strict plugin validation, the em dash scan and the private leak scan.

### Verification

Run each command from the repository root unless the step says otherwise.

- [ ] Repository hygiene checks exit 0:

  ```
  node scripts/repo-checks.mjs; echo "exit $?"
  ```

  Expected: `exit 0`, with every check reported as passing.

- [ ] The test suite passes:

  ```
  node --test scripts/*.test.mjs
  ```

  Expected: a summary with zero failing tests.

- [ ] Strict plugin validation exits 0:

  ```
  claude plugin validate . --strict; echo "exit $?"
  ```

  Expected: `exit 0` and no warnings.

- [ ] A scratch adopter repository passes the adopter check. Create an empty folder outside this repository, run `git init` in it, start Claude Code there with this repository loaded as a local plugin, run the `init` skill, answer its questions, then run the check inside the scratch folder:

  ```
  claude --plugin-dir <path to this repository>
  node checkrein-check.mjs; echo "exit $?"
  ```

  Expected: `init` copies every template without overwriting anything, writes the manifest, and the check prints `exit 0`.

- [ ] The em dash scan over the repository finds nothing:

  ```
  rg -n --hidden --glob '!.git' '(?-u:\xE2\x80\x94)' .
  ```

  Expected: no output. The pattern matches the em dash by its UTF-8 bytes, so the scan itself never contains the character.

- [ ] The private leak scan finds nothing:

  ```
  rg -n -i --hidden --glob '!.git' --glob '!.leakcheck' -f .leakcheck/terms.txt .
  ```

  Expected: no output. The term file is private and gitignored; its contents never appear anywhere else.

### Non-goals for tier 1

- No hooks of any kind, in the plugin or in the adopter's repository.
- No stack checklists, no stack-specific preflight rules, no stack-specific upgrade notes.
- No renders for specific harnesses beyond the plain folder and the Claude Code plugin.
- No third-party documentation content, vendored or summarized.
- Nothing hosted: no service, no telemetry, no account, no network call from any script.

### Known limits

Tier 1 is text and checks. Text does not stop an agent that ignores it. The adopter check verifies the records after the fact; it cannot see whether an agent read the corrections log before editing code, whether it opened a connection to production, or whether it read a protected folder. Those gaps are what tier 2 exists to close, and the README says so plainly rather than implying that the hub enforces anything.

## 3. Tier 2: enforcement for Claude Code

Tier 2 ships only after three adopters ask for enforcement (section 5). It is specific to Claude Code because that is the harness whose hook events can stop a tool call before it runs.

### Lessons carried in

The production project the method came from ran three shell guards (production access, a protected archive folder, and secret files) for a long stretch of real work, and an earlier, more mechanized iteration of this kit added an approval guard, a consulted-evidence Stop hook, diff gates shared by preflight and CI, and corrections compiled to lint rules. An audit of that iteration found many confirmed defects. The design below keeps what worked and answers what went wrong:

- **What worked.** A denial returned to the agent as feedback on one tool call, with the reason and the allowed alternative, never a session kill. Splitting a command on separators and substitutions, then stripping variable prefixes and wrapper commands (`sudo`, `env`, `exec`, `timeout`, `xargs`), before reading the word in command position. Allowing metadata commands (list, test, stat, count) and prose mentions (a commit message, a search pattern) while denying content readers. Tracking a reader that sits downstream of a protected path through a pipe or a substitution. Denying a file search with an executing action and a move whose source is inside a protected tree. Matching protected names case-insensitively, because some file systems are. An operator-named deliberate read through a command prefix, which lifts only that one rule.
- **Overclaimed enforcement.** The largest class of findings was documentation that described checks in the present tense when they were not built, or described a check as stronger than it was. Rule for tier 2: no document describes a guard until the release that ships it, and every description states what the guard does not catch.
- **Checks that ran in the wrong place.** A lint gate ran only on promotion pull requests, never on the pull requests where work actually landed, so "a broken reference fails the PR" was false. Rule: every gate runs where work lands.
- **Advice dressed as enforcement.** A session-start validator swallowed its own exit code. Rule: a guard either decides or does not exist; nothing ends in a silent pass.
- **Guards that blocked their own documented exception.** A secrets guard blocked the example env file the docs told the agent to read, which trained workarounds. Rule: every exception is a row in the case file with a test.
- **Prompts removed by convenience.** A broad permission allowlist silently removed an approval prompt that had existed. Rule: approvals live in a hook, which no allowlist can switch off.
- **Duplicated parsing.** Three guards repeated one command-splitting recipe in shell and depended on an external JSON tool, so a missing tool had to be special-cased to fail closed. Rule: one evaluator, in Node, with no dependencies.
- **Known blind spots.** The Stop hook saw edits made through the file tools but not edits made through shell commands. The approval guard declared a quoted shell wrapper (`sh -c '...'`) out of scope. Tier 2 handles the wrapper and states the edit blind spot.

### Contents

- A hooks file in the plugin (hooks/hooks.json), registering one PreToolUse entry for Bash and the file tools, and one Stop entry. Each runs a Node entry point under the plugin root; `${CLAUDE_PROJECT_DIR}` gives the adopter's repository root, where the guards read the manifest.
- **Production-access guard** (PreToolUse on Bash). Denies SSH-family clients in command position (ssh, scp, sftp, rsync, autossh, sshpass, mosh, and absolute paths to them), remote shell schemes, and any literal named in the manifest's production list: hosts, login strings, tunnel ports, and production database URLs. A denial is final; the reason tells the agent to diagnose on a local copy and to hand the operator a single-line command when a production-side action is needed.
- **Protected-tree guard** (PreToolUse on Bash, Read, Edit, Write, Grep, Glob). Denies reads of any path under `protected_trees` through the file tools and through content readers in shell commands. Allows metadata commands and the retirement commands the `post-merge` skill uses to move working docs into an archive (version-control add, move into the tree, commit, status). Denies a recursive search from the repository root that would walk a protected tree without naming it. A deliberate read named by the operator passes when the command starts with `CHECKREIN_ALLOW_PROTECTED=1`; the hub states that the agent never sets it on its own initiative.
- **Secrets guard** (PreToolUse on Bash and the file tools). Denies reading or writing any file matching `secret_globs`, including redirections into or out of one, while allowing metadata commands and any file the manifest marks as an example template.
- **Approval guard** (PreToolUse on Bash). Asks, never denies, before a push, a pull request creation, a pull request merge, a mutating API call that creates or merges pull requests or moves refs, and any dependency or lockfile mutation. The dependency commands come from the manifest because package managers differ. A lockfile-faithful install stays unprompted.
- **Consulted-evidence Stop hook.** When the turn edited files matching the manifest's code globs, it searches the session transcript for evidence that the corrections log was read: a read tool call on it, a search whose path names it, or a shell command that reads it. Missing evidence blocks the end of the turn once with the file name; the harness flag for a repeated stop guarantees the second stop passes, so it cannot loop. The transcript is the evidence; no file is written to record a read.

### Design constraints

- **Zero dependencies.** Node standard library only, the same floor as the tier 1 scripts.
- **Fail closed.** A parse error, an unreadable manifest, or an internal exception produces an ask with the error text, never a silent allow.
- **One evaluator over normalized commands.** Every Bash guard calls the same evaluator, which removes backslash-newline continuations, tokenizes with awareness of single quotes, double quotes and escapes (a separator inside quotes is argument data), splits on `;`, `&&`, `||`, `|`, `&` and newlines, opens `$( )`, backticks and parenthesized subshells into their own segments, unwraps `sh -c '...'` and its relatives by evaluating the quoted string recursively, strips variable assignments and wrapper commands, and separates redirection targets from arguments. Guards then match on segments, never on raw text.
- **Cases as data.** An allow and deny case file (one JSON array of command, tool, expected decision, and a one-line reason) holds at least 100 cases and is run by `node --test`. Every exception, every past bypass, and every false positive an adopter reports becomes a case before the fix lands.
- **Honest scope.** The hooks are a guardrail for cooperative agents, not a security boundary. A determined evasion (a path assembled from variables, a symlink made in an earlier command, a script written now and run later) defeats any lexical matcher. The hub rule is what stops it; for an operating-system boundary, the operator layers the harness sandbox on top. Every guard's reason text and the README say this.

### Manifest additions

Tier 2 raises `manifest_version` to 2; the adopter check accepts both, and every new key is optional so a tier 1 manifest keeps working.

- `production_markers`: lists of hosts, login strings, ports and database URL patterns that identify production.
- `protected_trees`: already present in tier 1; tier 2 enforces it.
- `secret_globs`: already present; tier 2 adds an `example_globs` list for templates an agent may read.
- `approval`: which actions ask (push, pull request create, pull request merge, dependency change) and the dependency commands for the project's package manager.
- `consulted`: the code globs that count as a code edit and the files that must have been read, with the corrections log always included.

### Fallback outside Claude Code

Other harnesses expose no comparable hook events, so tier 2 ships two fallbacks that run the same evaluator:

- A pre-commit and pre-push pair under .githooks, enabled with one git config line, that runs the evaluator over the staged diff and the outgoing commits: secret files added, protected trees modified other than by retirement, production markers written into tracked files.
- A CI job that runs the adopter check and the same diff evaluation on every pull request to the trunk.

These catch what reaches a commit. They cannot catch a read, a live connection, or anything an agent does in a shell that never produces a commit. The README states that boundary for each harness.

### Effort

Estimate: 6 to 10 focused working days for one maintainer, about half of it spent on the evaluator and the case file, the rest on the four guards, the Stop hook, the git hooks and the documentation.

## 4. Tier 3: packs and adapters

Tier 3 ships per ask: each pack or adapter is its own release, started when its own demand trigger is met.

### Stack packs

A stack pack adds what tier 1 deliberately leaves out for one stack. It contains:

- Routing for the `docs` skill: which `<folder>/_INDEX.md` files a change in each layer of the stack reads, so the tier gate fans out to the right reference docs.
- Review checklists per layer for `dev-review`, alongside the cross-cutting checklist tier 1 ships.
- Preflight rules as a registry: each rule is data (a name, a file glob, a pattern, a severity, a reason) with a must-hit fixture that the rule flags and a must-miss fixture that it leaves alone, both run by the pack's tests.
- Upgrade notes for `package-upgrade`: the known migration hazards of the stack's major libraries, stated as checks to run, not as copied vendor text.
- Corrections compiled to lint rules. A corrections-log entry whose failure mode a lint rule can express is compiled into configuration data, never a custom rule implementation. A new rule starts at warn in a quarantine section, paired with a fixture that must fail and a clean run over the existing codebase. Only the operator promotes it to error, after confirming the fixture fails; the log entry then shrinks to a pointer to the rule. One lesson from the earlier iteration applies directly: in a flat lint config a later block replaces an earlier block's settings for the same rule wholesale, so a compiled rule whose file glob overlaps an existing one must repeat the existing selectors, and promotion re-probes that the existing rule still fires.

### Harness adapters

- **Procedures render** for harnesses without a skills mechanism: a folder of procedure files generated from the skills, with the hub pointing to each one from a table of when to run it.
- **Glob-scoped rule files** for editors that load rules by path pattern, generated from the hub's rules so each one loads only for the files it governs.
- **A conformance suite** every adapter must pass: the rendered output contains every protocol step of every skill, every manifest token resolves, no em dash appears, no rule is stated twice, and the adopter check passes on a repository initialized through the adapter.

### Team mode (optional)

A team mode covers more than one operator on a repository: who may promote a lint rule, who owns which records, and how two concurrent `post-merge` runs avoid processing the same pull request. It stays optional and starts only on demand, because the method is built around one operator who makes every decision.

### Free and paid

The method stays free: the hub, the templates, the skills, the checks, the tier 2 guards, the adapters and the conformance suite. Stack packs are the candidates for a paid one-time pack, since each carries curated per-stack review checklists, a rule registry with fixtures, and upgrade notes that take sustained work to keep correct. A paid pack never gates a protocol step; tier 1 alone always runs the full loop.

## 5. Demand triggers and the decision rule

A tier, or a single pack or adapter in tier 3, starts only after three distinct asks for what it contains. An ask is an issue or a message from a different person or team naming the need, in their words. Stars, forks, downloads and reactions do not count. The maintainer's own projects do not count as an ask; a defect they find in tier 1 is a tier 1 fix. When three asks exist, the maintainer links them from the issue that starts the work, so the trigger is visible in the record.

## 6. Distribution notes

- The plugin validates with `claude plugin validate . --strict` before every release; a release that fails validation does not ship.
- The official plugin directory accepts submissions through the developer portal at claude.ai/directory/manage, which requires a paid plan, after strict validation passes; the portal runs its own additional checks. Submission is a maintainer decision (section 8), not a release step.
- The repository is also a plain folder. Other harnesses copy the `skills/` folder into their own skills location, or copy the templates by hand, and the README says exactly that without promising any third-party installer.

## 7. Maintenance model

- The maintainer's own projects run the kit. That is where defects surface and where improvements are proven before they reach the kit.
- Improvements flow by hand from a project into the kit. The private leak scan is the gate: no change lands until the leak scan and the em dash scan find nothing, and the change reads as generic to someone who has never seen the project it came from.
- Template changes travel with skill changes. When a skill starts reading or writing a section, the matching template and its filler guidance change in the same release.
- Every release bumps the version string in `.claude-plugin/plugin.json`, because an unchanged version makes plugin update report the install as current.
- From the first tagged release, the repository keeps its own changelog, one section per release, with Added, Changed and Fixed subsections present only when non-empty.

## 8. Open decisions for the maintainer

- Ship tier 2 inside this plugin, switched on by manifest keys, or as a separate plugin an adopter installs on purpose.
- Whether the consulted-evidence Stop hook blocks from its first release or warns for one release first.
- The exact name of the deliberate-read environment variable, and whether it should also require the path to appear in the operator's last message.
- Which stack gets the first pack, and whether stack packs are paid at all.
- Whether team mode belongs in checkrein or in a separate project.
- When to submit to the official directory: at tier 1, or after the first adopters confirm the install path.
