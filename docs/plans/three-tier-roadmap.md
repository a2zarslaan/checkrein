# checkrein development plan: three tiers

This is the plan the maintainer builds checkrein from. Tier 1 is released as 0.1.0. Tier 2 is release 0.2.0 (section 3 says where it stands). Tier 3 is designed here so the design is not lost, and each piece of it starts only when the demand rule in section 5 is met. Nothing in tier 3 exists until a release ships it, and no other document in this repository describes it as if it does.

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

**Status.** Tier 2 is release 0.2.0: the guards under `guards/`, the hooks file under `hooks/`, manifest version 2, the `upgrade` skill, and the diff check with its git hook and CI templates. The demand rule (section 5) governs shipping it to the official plugin directory; the maintainer may release it earlier as a deliberate decision. The decisions the design below left open are settled in section 8, and whether enforcement is free or paid is settled in section 9.

Tier 2 is specific to Claude Code because that is the harness whose hook events can stop a tool call before it runs.

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

Each guard below says what it does; the README's enforcement table states, next to each guard, what it cannot see.

- A hooks file in the plugin (hooks/hooks.json), registering one PreToolUse entry for Bash and the file tools, and one Stop entry. Each runs a Node entry point under the plugin root; `${CLAUDE_PROJECT_DIR}` gives the adopter's repository root, where the guards read the manifest.
- **Production-access guard** (PreToolUse on Bash). Denies SSH-family clients in command position (ssh, scp, sftp, rsync, autossh, sshpass, mosh, ssh-copy-id, telnet, and absolute paths to them), remote shell schemes, and any literal named in the manifest's production list: hosts, login strings, tunnel ports, and production database URLs. A denial is final; the reason tells the agent to diagnose on a local copy and to hand the operator a single-line command when a production-side action is needed.
- **Protected-tree guard** (PreToolUse on Bash, Read, Edit, Write, Grep, Glob). Denies reads of any path under `protected_trees` through the file tools and through content readers in shell commands. Allows metadata commands and the retirement commands the `post-merge` skill uses to move working docs into an archive (version-control add, move into the tree, commit, status). Denies a recursive grep from the repository root that would walk a protected tree without naming it. A deliberate read named by the operator passes when the command starts with `CHECKREIN_ALLOW_PROTECTED=1`; the hub states that the agent never sets it on its own initiative.
- **Secrets guard** (PreToolUse on Bash and the file tools). Denies reading or writing any file matching `secret_globs`, including redirections into or out of one, while allowing metadata commands and any file the manifest marks as an example template.
- **Approval guard** (PreToolUse on Bash). Asks, never denies, before a push, a pull request creation, a pull request merge, a mutating API call that creates or merges pull requests, moves refs or writes file contents, and any dependency or lockfile mutation. The dependency commands come from the manifest because package managers differ. A lockfile-faithful install stays unprompted.
- **Consulted-evidence Stop hook.** When the turn edited files matching the manifest's code globs, it searches the session transcript for evidence that the corrections log was read: a read tool call on it, a search whose path names it, or a shell command that reads it. Missing evidence blocks the end of the turn once with the file name, or shows a warning when the manifest's `consulted.mode` is `warn`; the harness flag for a repeated stop guarantees the second stop passes, so it cannot loop. The transcript is the evidence; no file is written to record a read. A transcript the harness has not written yet allows, so a lag never produces a false block.

### Design constraints

- **Zero dependencies.** Node standard library only, the same floor as the tier 1 scripts.
- **Fail closed.** A parse error, an unreadable manifest, or an internal exception produces an ask with the error text before a tool call, one block with the error text at the end of a turn, and exit 1 in the diff check, never a silent allow.
- **One evaluator over normalized commands.** Every Bash guard calls the same evaluator, which removes backslash-newline continuations, tokenizes with awareness of single quotes, double quotes and escapes (a separator inside quotes is argument data), splits on `;`, `&&`, `||`, `|`, `&` and newlines, opens `$( )`, backticks and parenthesized subshells into their own segments, unwraps `sh -c '...'` and its relatives by evaluating the quoted string recursively, strips variable assignments and wrapper commands, and separates redirection targets from arguments. Guards then match on segments first, with raw text only where a rule says so (production markers, and a protected tree named in a segment's text).
- **Cases as data.** An allow and deny case file (one JSON array of command, tool, expected decision, and a one-line reason) holds at least 100 cases and is run by `node --test`. Every exception, every past bypass, and every false positive an adopter reports becomes a case before the fix lands.
- **Honest scope.** The hooks are a guardrail for cooperative agents, not a security boundary. A determined evasion (a path assembled from variables, a symlink made in an earlier command, a script written now and run later) defeats any lexical matcher. The hub rule is what stops it; for an operating-system boundary, the operator layers the harness sandbox on top. The README and the `init` and `upgrade` summaries say this.

### Manifest additions

Tier 2 raises `manifest_version` to 2; the adopter check accepts both, and every new key is optional so a tier 1 manifest keeps working.

- `production_markers`: lists of hosts, login strings, ports and database URL patterns that identify production.
- `protected_trees`: already present in tier 1; tier 2 enforces it.
- `secret_globs`: already present; tier 2 adds an `example_globs` list for templates an agent may read.
- `approval`: which actions ask (push, pull request create, pull request merge, dependency change) and the dependency commands for the project's package manager.
- `consulted`: the code globs that count as a code edit and the files that must have been read, with the corrections log always included.

### Fallback outside Claude Code

checkrein's guards run only in Claude Code, so for other harnesses tier 2 ships two fallbacks that run one diff check (`guards/diff-check.mjs`, copied to the adopter's root as a standalone file; it carries its own copies of the manifest path helpers, and a test keeps them equal to `guards/manifest.mjs`):

- A pre-commit and pre-push pair under .githooks, enabled with one git config line, that runs the diff check over the staged diff and the outgoing commits. It fails on secret files added or modified and on protected trees modified, deleted or moved out of (adding a file is retirement and passes), and warns on production markers written into tracked files.
- A CI job that runs the adopter check and the same diff check on every pull request to the trunk, over the range from the merge base.

These catch what reaches a commit. They cannot catch a read, a live connection, or anything an agent does in a shell that never produces a commit. The README states that boundary for each harness.

### Upgrade path

Enforcement is an upgrade an adopter opts into, never a change that arrives with a plugin update.

- **The switch is the manifest.** The hooks act only in a repository whose `checkrein.json` says `manifest_version` 2 or higher. A fresh `init` writes version 2. A repository set up with 0.1.0 holds version 1 and stays as it was until the operator runs the `upgrade` skill.
- **The upgrade skill.** It reads the manifest and reports its version, prints one table of what each guard does and what it cannot see, asks the operator in one message for the production markers, example files, approval classes, consulted mode and code globs, then changes the version to 2 and adds the four new keys after the existing ones. No existing key is reordered, renamed or changed. It copies the diff check, the git hooks and the CI workflow without overwriting, writes or appends the `.ignore` file, prints the `git config core.hooksPath .githooks` line and the plugin update line, and runs the adopter check. It commits nothing.
- **The plugin update.** The operator runs `claude plugin update checkrein` and starts a new session, because hooks load at session start. The update reaches the adopter only because the plugin's version string moved to 0.2.0; an unchanged version reports the install as current.
- **What the adopter sees change.** The install or update pane lists the hooks the plugin adds. In a version 1 repository nothing else changes: every hook stays silent. After the upgrade, a command that reaches production, reads a protected tree or touches a secret file is denied with a reason that names the allowed alternative; a push, a pull request creation or merge and a dependency change ask first; a turn that edited code without reading the corrections log is held once at its end. The diff they review holds the manifest keys and five new files, and once the git hooks path is set, a commit that adds a secret file fails locally and the CI job runs on every pull request to the trunk.
- **How version 1 keeps working.** The adopter check from 0.2.0 accepts versions 1 and 2, and every version 2 key is optional with a default. The skills read the same keys as before. A version 1 copy of the check script rejects a version 2 manifest, so the upgrade skill compares it with the release copy and replaces it only on the operator's word. To switch enforcement off again, the operator sets the version back to 1 and removes the four keys; the upgrade skill never lowers a version.

### Effort

Estimate, made before the build: 6 to 10 focused working days for one maintainer, about half of it spent on the evaluator and the case file, the rest on the four guards, the Stop hook, the git hooks and the documentation.

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

The method stays free: the hub, the templates, the skills, the checks, the tier 2 guards, the adapters and the conformance suite. Stack packs are the candidates for a paid one-time pack, since each carries curated per-stack review checklists, a rule registry with fixtures, and upgrade notes that take sustained work to keep correct. A paid pack never gates a protocol step; tier 1 alone always runs the full loop. Section 9 records why the guards stay on the free side of that line.

## 5. Demand triggers and the decision rule

A single pack or adapter in tier 3 starts only after three distinct asks for what it contains, and the same count governs shipping tier 2 (release 0.2.0) to the official plugin directory. The maintainer may release earlier as a deliberate decision; a decision is not an ask and does not count toward any trigger. An ask is an issue or a message from a different person or team naming the need, in their words. Stars, forks, downloads and reactions do not count. The maintainer's own projects do not count as an ask; a defect they find in tier 1 is a tier 1 fix. When three asks exist, the maintainer links them from the issue that starts the work, so the trigger is visible in the record.

## 6. Distribution notes

- The plugin validates with `claude plugin validate . --strict` before every release; a release that fails validation does not ship.
- The official plugin directory accepts submissions through the developer portal at claude.ai/directory/manage, which requires a paid plan, after strict validation passes; the portal runs its own additional checks. Submission is a maintainer decision (section 8), not a release step.
- The repository is also a plain folder. Other harnesses copy the `skills/` folder into their own skills location, or copy the templates by hand, and the README says exactly that without promising any third-party installer.

## 7. Maintenance model

- The maintainer's own projects run the kit. That is where defects surface and where improvements are proven before they reach the kit.
- Improvements flow by hand from a project into the kit. The private leak scan is the gate: no change lands until the leak scan and the em dash scan find nothing, and the change reads as generic to someone who has never seen the project it came from.
- Template changes travel with skill changes. When a skill starts reading or writing a section, the matching template and its filler guidance change in the same release.
- Every release bumps the version string in `.claude-plugin/plugin.json`, because an unchanged version makes plugin update report the install as current.
- The repository keeps its own changelog in `CHANGELOG.md`, one `## <version>` section per release, newest first, with Added, Changed and Fixed subsections present only when non-empty. The version strings in `.claude-plugin/plugin.json` and `package.json` move together, and the repository checks fail when they differ or the changelog lacks the current version's section.

## 8. Decisions for the maintainer

Settled by the tier 2 build:

- Tier 2 ships inside this plugin, switched on by manifest version 2, with `guards/` kept self-contained so it could move out as one folder.
- The consulted-evidence Stop hook blocks from its first release; `consulted.mode` set to `warn` turns the block into a warning for an adopter who wants that.
- The deliberate-read variable is `CHECKREIN_ALLOW_PROTECTED=1` at the start of a shell command. It does not check the operator's last message; the hub rule that the operator names the path carries that part.
- Enforcement is free (section 9).

Still open:

- Which stack gets the first pack, and whether stack packs are paid at all.
- Whether team mode belongs in checkrein or in a separate project.
- When to submit to the official directory: at tier 1, at 0.2.0 by deliberate decision, or after the demand rule in section 5 is met.

## 9. Enforcement as an upgrade: free or paid

Version 2 is the first release that does something new for an adopter who already runs the method, so it is the natural point to ask whether it is sold. Three options were weighed.

**(a) A free upgrade, released as 0.2.0.** The guards ship inside the free plugin. They become the second launch story ("the rules now hold at the moment the agent acts"), and the paid layer, if any, stays the tier 3 stack packs.

- For: it keeps one plugin and one install line; every adopter gets the safety rules enforced; the story strengthens the free kit rather than splitting it.
- Against: nothing is earned from the work that went into the evaluator and the case file.
- Watch out: a free guard still draws bypass reports and support questions. The case-file rule (every bypass becomes a case before its fix) keeps that cost bounded and visible.

**(b) A paid enforcement plugin.** `guards/` and `hooks/` move into a separate plugin listed as a private marketplace entry, sold with a one-time licence. The free core keeps the same rules as text in the hub.

- For: it puts a price on the part that took the most engineering, and the split is clean because the folder already stands alone.
- Against: the guards are small scripts anyone can read and copy, so the licence protects little; two plugins double the install and update paths; adopters who most need a production-access guard are the ones least likely to pay before they have been burned.
- Watch out: a licence check inside a hook is one more thing that can fail, and a guard that fails must ask (fail closed), so a licence outage would turn into a prompt on every tool call.

**(c) Free guards plus a paid team licence.** The guards stay free. A team licence buys priority on bypass reports (a reported bypass becomes a case and a fix first) and help setting up the manifest, the markers and the CI job.

- For: it charges for time and attention, which is what a team actually lacks, not for code that is already public.
- Against: it is a service, which needs a support channel and a response promise one maintainer may not keep.
- Watch out: it must never become a paywall on a fix. A bypass reported by anyone is fixed for everyone; the licence buys order in the queue, not the fix.

**The pick is (a).** The guards are small scripts anyone can copy, so charging for them protects little. They are the credibility story for a free kit: the claim "checks beat prose" is strongest when the checks run at the moment of action. Charging for safety inside a free workflow reads badly, as though the free version were left unsafe on purpose. And no demand signal exists yet: no adopter has asked for enforcement, let alone with a budget.

(b) stays possible without a rewrite. `guards/` imports nothing from `scripts/` or `skills/`, `hooks/hooks.json` names only files under `guards/`, and activation runs through the `upgrade` skill and `guards/manifest.mjs`. That loader is the one seam a licence check would use; nothing about licensing is built now, and the seam stays clean so none is needed later.

What would change the pick is a team asking for enforcement with a budget. That turns into (c): the team pays for priority and setup help. It never turns into a paywall on the hook code.
