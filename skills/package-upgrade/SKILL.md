---
name: package-upgrade
description: Run this skill before any dependency version change, including patch bumps. It covers upgrading, updating, bumping or migrating a package, a family of related packages, a language runtime, the package manager itself, or a container image tag. Trigger phrases include "upgrade <package> to v7", "bump <package>", "update our <library> packages", "migrate to the latest <library>", "is <package> 3 compatible with what we run", and "update the base image". It reads the manifest, every workspace's package manifest and lockfile, the target version's changelogs and migration guides, the vendored docs under the reference documentation root, and the codebase usages each breaking change touches. It produces a current-state summary, a migration plan with severity-rated breaking changes that the operator approves before anything is installed, the exact-pinned upgrade with every pin location bumped in one commit, verification through the project's configured commands, and a final summary.
---

# Package Upgrade

This skill upgrades dependencies safely. It is a mandatory sequence and each step gates the next: **research first, plan second, ask the operator third, execute last.** It applies to every version change, from a patch bump to a multi-major migration, and to versions pinned outside the package manifests (the language runtime, the package manager, container images).

Claude Code note: search the codebase with Grep and Glob, read manifests with Read, and find changelogs with WebSearch and WebFetch.

## Step 0: Resolve the manifest

1. Read the manifest (`checkrein.json` at the repository root). If it is missing or does not parse, stop and tell the operator: "No checkrein manifest found. Run the `init` skill first." Do nothing else.
2. Substitute every `{{ref:<dotted.key>}}` token in this skill with its manifest value. An empty `commands.*` value means that check is not configured: skip it and report it as "not configured", never invent a replacement command.
3. Print the file resolution table before continuing:

| File | Status |
|------|--------|
| The manifest | FOUND / MISSING |
| The package manifest in each root of {{ref:workspaces}} | FOUND / MISSING (one row per workspace) |
| The lockfile | FOUND / MISSING |
| {{ref:paths.refdocs_root}} | FOUND / MISSING |
| {{ref:paths.architecture}} | FOUND / MISSING |
| {{ref:paths.corrections_log}} | FOUND / MISSING |

A missing workspace manifest is reported, not recreated. A missing reference documentation root or architecture record does not stop the skill; say so in the Step 1 report.

Never read or edit a file matching {{ref:secret_globs}}, and never take setup or version guidance from {{ref:protected_trees}}.

## Required inputs (confirm before starting)

Make sure you have:

1. **Package name**, for example `<package>` or a scoped family `<@scope/*>`.
2. **Target version**, an exact `x.y.z`.
3. **The target version's local documentation**, already placed (or to be placed by the operator) in the library's folder under {{ref:paths.refdocs_root}}, fronted by its `<library-folder>/_INDEX.md`. Only the current version's docs are kept: there is no per-version archive to diff against, so the migration guide gathered in Step 2 is the authority for what changed.
4. **Changelog or migration guide.** Optional. If the operator does not provide one, you find it in Step 2.

If any of 1 to 3 is missing, ask for it before proceeding. If the project does not vendor this library's docs at all, say so and ask the operator whether to vendor them first or to proceed from the official documentation at the target version.

If the target version is not released yet, tell the operator and propose the latest stable version instead of proceeding.

---

## Step 1: Determine current state

Read the package manifest in every workspace root listed in {{ref:workspaces}}, plus the repository root's manifest if it is not itself a workspace. For each workspace that declares the package:

- Record the installed version. If the manifest holds a range rather than an exact version, read the installed version from the lockfile, and note the range as a pin defect to fix in this upgrade.
- Record which block declares it (runtime dependencies, development dependencies, peer dependencies). A shared library's **peer dependency** is a range by design: a bump there is a range change, and the installed version is decided by each consuming workspace.
- Calculate the version gap, for example "installed 5.0.1, target 7.0.0: two major versions".

Identify **companion packages** that must move in lockstep. Never assume the list is complete; confirm it by reading the target version's peer dependency declarations. The common shapes:

- **Scoped families.** Packages published under one scope or prefix that align on one major version (a framework's core plus its adapters, its testing module, its plugins).
- **Runtime plus generated code.** A tool and the client or code it generates from a schema always move together.
- **Peer-coupled pairs.** A library and its integration packages (a form library and its schema resolver, a UI library and its icon set and styling engine, a view library and its renderer).
- **Single-copy dependencies.** Libraries that must resolve to exactly one copy across the tree (a UI runtime that several workspaces and a shared library peer-depend on). Every manifest that names one carries the same version.
- **Platform-coupled sets.** A platform that decides the versions of a whole set of packages. The set moves together, never one package at a time.
- **Client SDK plus service image.** An SDK whose server runs from a container image; the SDK version constrains the image version.
- **Shared development tooling.** The type checker, the linter and their plugins, used by every workspace.

Search the corrections log headings for the package and its companions: search `^### (Pattern|Convention) \[` in {{ref:paths.corrections_log}}, scan the heading lines only, and pull any matching entry by its line number (about 40 lines from the heading). Never read the whole log. A matching rule is a hard constraint on this upgrade.

**Report to the operator** before continuing:

```
Current state summary:
- Package: <name>
- Installed: <version> (in <workspaces>, <dependency block>)
- Target: <version>
- Version gap: <X major / Y minor / Z patch versions>
- Companion packages: <list, each with installed version>
- Pin defects found: <ranges where an exact version belongs, or "none">
- New docs: <library folder under the reference documentation root, or "not vendored">
- Relevant corrections: <entries, or "no relevant corrections found">
```

---

## Step 2: Gather changelogs

If the operator provided a changelog or migration guide, use it. Otherwise your **first action** is to find the official one:

- The package's release notes in its source repository.
- The official migration guide (most frameworks publish one per major version).
- Official announcement posts for major releases.

**Multi-version gaps:** when the upgrade crosses several major versions (for example 5 to 7), gather the changelogs for every intermediate version, 5 to 6 AND 6 to 7. Every breaking change in the whole range matters.

**Patch bumps are not exempt.** Read the release notes for every patch in the range. Patches can change defaults, fix a bug the code depends on, or raise a peer requirement.

For each companion, gather its changelog across the same range.

**Peer and environment requirements.** From the target versions, record:

- The peer dependency ranges each package declares, and whether every workspace's installed peers satisfy them.
- The minimum language runtime version.
- Any required server, service or container image version (the compatibility matrix for a client SDK plus service image pair).
- Any platform SDK version the package requires or supports.

Use the target version's local docs under {{ref:paths.refdocs_root}} as the primary reference for target APIs. Current usage comes from the live codebase (Step 3 searches it). A vendored pattern reference or project template may sit on an older version of the package: never take target-version setup from it; the target version's docs are the authority.

---

## Step 3: Analyze breaking changes against the codebase

Read every changelog and categorize each change:

- **Breaking changes:** API removals, renamed methods, changed signatures, changed defaults, new required configuration.
- **Deprecations:** still work, will break in a future version.
- **New features:** optional, note when relevant.
- **Bug fixes:** informational, but flag any fix the code may depend on.

For each breaking change and deprecation, **search the actual codebase** for the affected API in every workspace that uses the package:

- Count files and occurrences.
- Rate severity:
  - **High:** affects core functionality or many files, and the fix is not mechanical.
  - **Medium:** affects some files, and the fix is clear and mechanical.
  - **Low:** unused API, a trivial rename, or isolated to one file.

**Compatibility check across environments.** The upgrade must hold identically in every environment that runs the code: developer machines, CI runners and production. Find every place the environment is declared (container files, compose files, CI workflow files, runtime version files, the manifests' engine and package-manager fields, deploy scripts) and check each against the requirements recorded in Step 2. A requirement one environment meets and another does not is a High severity item, because it is the shape of a "works on my machine" outage.

**Template-pinned packages.** If a workspace was built from a template that pins this package, check the template's pinned version. If the target leaves the template's range, warn the operator that the upgrade may conflict with the template and that its compatibility has to be verified.

---

## Step 4: Present the migration plan and get explicit operator approval

**Do not touch any code or run any add or install command until the operator approves.**

Present the plan in this format:

```
## Upgrade Plan: <package> <current> to <target>

### Summary
- Workspaces affected: <list>
- Companion packages: <list, each current to target>
- Pin locations outside package manifests: <list, or "none">
- Overall risk level: Low / Medium / High
- Total files requiring changes: <N>

### Breaking Changes
| # | Change | Severity | Files affected |
|---|--------|----------|----------------|
| 1 | <description> | High | <N> files |
| 2 | <description> | Medium | <N> files |

### Environment compatibility
| Environment | Requirement | Current | Meets it? |
|-------------|-------------|---------|-----------|
| <dev / CI / production> | <runtime, peer, image, SDK> | <value> | yes / no |

### Deprecations (non-blocking now, will break later)
- <list>

### Migration steps
1. <step>
2. <step>

### Verification
- Commands that will run: <the configured lint, typecheck, test and build commands; name any that are not configured>
- Package-specific checks: <generate, validate, alignment, health check, binary rebuild, as they apply>

### Documentation
- Target version's docs: <path>
- Version strings to update: <files that name the old version>

Ready to proceed? Reply "yes" to begin, or ask questions.
```

For **major version bumps** this step is mandatory and non-negotiable. For minor and patch bumps with no breaking changes, keep the report brief, but still present it and still wait.

Wait for explicit operator approval before proceeding. Approval covers the plan as presented; if execution reveals work the plan did not name, stop and present the addition before doing it.

---

## Step 5: Execute the upgrade

Once the operator approves:

### 5a. Update the versions with exact pins

Every version the project declares is an exact `x.y.z`. Never write a range (`^`, `~`, `>=`, `x`, a bare major) in a dependency block, and never a floating container tag (`latest`, a bare major, or `major.minor`), because these resolve to different versions at different install or pull times and drift between environments silently.

Run your package manager's exact-pin add command in each affected workspace, with the companions in the same command. The generic shape is:

```
<add command> <package>@<x.y.z> <companion>@<x.y.z> <exact flag>
```

where `<exact flag>` is the option that writes the exact version instead of a range (some package managers do this by default through a configuration setting; an explicit range on the command line is still written as given). The only exceptions to exact pins are the exceptions the architecture record decides: read {{ref:paths.architecture}} for them (workspace links between packages in the same repository are a common one). Any other range is a defect; fix it in this upgrade and report it.

### 5b. Install and read the lockfile diff

Run the plain, re-resolving install once from the repository root. This is the one legitimate non-frozen install: it re-resolves the edited workspaces and rewrites the lockfile. Every environment that reproduces the tree (CI, image builds, deploys) installs with the lockfile-frozen mode, the option that refuses to modify the lockfile, so the lockfile you commit is the record of the whole tree.

Then read the diff of every manifest and of the lockfile:

- Each changed specifier is exact (or one of the recorded exceptions above).
- No resolved version outside the bumped packages and their transitive dependencies has moved. If unrelated versions moved, stop and report them before going further.

### 5c. Bump every pin location in one commit

When the upgrade touches anything pinned outside the package manifests (the language runtime, the package manager, a container image), find every location that declares it and update all of them in the same commit. The usual set: container base images in every container file, every compose or orchestration file, CI workflow runtime setup steps, the runtime version file, the runtime-engine and package-manager fields of the root manifest, and any activation line for the package manager inside a container file. Read the hub (`AGENTS.md`) and {{ref:paths.architecture}} first: if the project records a version parity rule with its own list of pin locations, that list is authoritative.

- A location left behind is silent drift between dev, CI and production, the exact failure exact pins exist to prevent.
- Update runbook examples under {{ref:paths.runbooks_dir}} that show the old version in the same commit. Operators copy what they see.
- When two components must align (a client SDK bump that forces a service image bump), write the compatibility window next to the pin, and name how it was verified.

### 5d. Apply the code migrations

Work through each breaking change one at a time:

- Show what changed and why.
- Apply the fix.
- Explain the new pattern against the old one.
- Cite the target version's docs for the correct API.

Use an official codemod or migration command when the target package's migration guide names one. Show the command to the operator before running it, and read its diff afterwards.

### 5e. Package-specific steps

Apply each shape that fits:

- **Runtime plus generated code:** after the bump, run the tool's generate command to regenerate the client, then its validate command against the schema. If the schema format changed, update the schema file through the tool's own migration path, never by hand edits the tool does not expect.
- **Scoped families:** every package in the family lands on the same major in the same commit. Read the family's migration guide for changes in its extension points (decorators, middleware, plugins, hooks).
- **Client SDK plus service image:** flag to the operator that the service's container image may need a bump, and give the image version that matches the target SDK from the compatibility matrix. The image bump follows 5c.
- **Platform-coupled sets:** follow the target platform version's upgrade guide, move the whole set to the platform's versions, and check each third-party library's support for the target **before** the bump.
- **Single-copy dependencies:** after the install, prove one copy by resolving the package from each consuming workspace root and comparing the resolved paths.
- **Shared development tooling:** update every workspace in sync, then run the typecheck and lint commands across the whole repository.
- **A switch to a different library** (replacing a stalled package with another one) is a decision change, not an upgrade. Stop and present it to the operator as a decision.

### 5f. Verify

Run the project's configured commands after the migration, in this order, and fix what each finds before moving on:

1. Typecheck: `{{ref:commands.typecheck}}`. Fix every type error.
2. Lint: `{{ref:commands.lint}}`. If the project has a pin guard, this is where it runs.
3. Tests: `{{ref:commands.test}}`. Report every failure. Never change an existing test's logic to make it pass; a test that fails because the package's behavior changed is reported to the operator with the changelog line that explains it, and changing it needs the operator's sign-off first.
4. Build: `{{ref:commands.build}}`.
5. Start the app once (the development server, or the built output) and confirm it does not crash on start.

Report any command that is not configured as "not configured". If a failure's cause is not obvious from its message, stop and run the `structured-debugging` skill before attempting a fix; never stack guesses.

---

## Step 6: Rotate the documentation

This is a first-class step, not an afterthought.

1. Confirm the target version's docs are present in the library's folder under {{ref:paths.refdocs_root}}.
2. Update that folder's `<library-folder>/_INDEX.md` to reflect new files, removed files, changed patterns and the pinned version or source ref the docs were taken at.
3. Search the hub (`AGENTS.md`), {{ref:paths.architecture}}, {{ref:paths.state_doc}} and the runbooks for explicit mentions of the old version (for example "<Library> 6") and update them to the new version. A version string recorded next to a compatibility window moves with the pin.
4. **Doc replacement is the operator's job.** Only the target version's docs are kept: the operator supplies the new folder contents and removes what they supersede. Your part is confirming the new docs are present and that the index matches them. Never delete or rewrite documentation folders yourself.

---

## Step 7: Summary

Give a final summary in this format:

```
## Upgrade Complete: <package> <old> to <new>

### Packages upgraded
- <package>@<old> to <new>
- <companion>@<old> to <new>

### Pin locations updated
- <file>: <old> to <new>   (or "none outside package manifests")

### Code changes
- <file>: <what changed>

### Verification
- Typecheck: pass / fail / not configured
- Lint: pass / fail / not configured
- Tests: pass / fail (<failures>) / not configured
- Build: pass / fail / not configured
- App start: pass / fail
- Lockfile diff: only the bumped packages and their transitive dependencies moved (yes / no)

### Documentation
- New docs used: <path>
- Index updated: yes / no
- Version strings updated: <files, or "none">

### Remaining action items
- <deprecation warnings to address later>
- <tests that need to be written>
- <a service image bump, binary rebuild or operator-run step, if applicable>
```

---

## Hard constraints

- Never run an add or install command before completing Steps 1 to 4 and receiving the operator's approval.
- Never skip changelog research for any version change, patch bumps included.
- For multi-version gaps, always collect the changelogs for every intermediate version.
- Never assume a companion list is complete without reading the target package's peer dependencies.
- Every declared version is an exact `x.y.z`, except the recorded exceptions in 5a. No floating container tags.
- Exactly one plain re-resolving install, from the root, after a deliberate manifest edit. Every reproducing environment installs lockfile-frozen.
- Every location that pins a component changes in the same commit, runbook examples included.
- Never delete anything from {{ref:paths.refdocs_root}}. The only write this skill makes there is the Step 6 index refresh.
- If the target version is not released, tell the operator and propose the latest stable version instead.
- Merging, production deploys and production access belong to the operator. This skill prepares the change; it never merges it or deploys it.
