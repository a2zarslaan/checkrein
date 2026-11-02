---
name: dev-code
description: A manual coding-discipline lens with four principles (think before coding, simplicity first, surgical changes, goal-driven execution) that counter common agent mistakes such as silent assumptions, speculative abstractions, drive-by edits and vague definitions of done. Manual only. The agent does not auto-invoke it for general coding work; run it when the operator explicitly asks for it, for example "/dev-code", "use dev-code", "be disciplined on this one" or "keep this surgical". It reads no project files and produces no document; it changes how the agent behaves for the task at hand. It sits above the specialist skills (structured-debugging, preflight-check, docs, package-upgrade) as a posture, not a replacement for them.
---

# dev-code: Coding Discipline Lens

Four behavioral principles that reduce common agent coding mistakes, based on observations by Andrej Karpathy about how language models go wrong when they write code.

This is a manual-only skill. The operator opted in because they want disciplined execution on this task, not because the task is inherently complex. Treat the invocation as a signal: slow down, surface tradeoffs, and avoid the four failure modes below. For trivial work (a one-line typo, a rename, a config tweak) where asking costs more than being wrong, use judgment and move on without ceremony.

This skill reads no manifest and no project files, so it has no resolution step and no file table.

Claude Code note: a Claude Code user invokes it by typing `/dev-code`. The agent never invokes it on its own initiative.

## When other skills take precedence

`dev-code` is a lens, not a specialist. If one of these applies to the task, run that skill first. `dev-code` rides alongside it.

| If the task is | Run first |
|---|---|
| Debugging a bug, a test failure or unexpected behavior | `structured-debugging` |
| About to open a pull request | `preflight-check` |
| Looking up project conventions, recorded rules or library APIs | `docs` |
| Changing a dependency version | `package-upgrade` |
| Reviewing a pull request that already exists | `dev-review` |

The four principles still apply inside all of these. The specialist skill gives the concrete steps; `dev-code` gives the posture.

## 1. Think before coding

**Do not assume. Do not hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If you are uncertain, ask.
- If more than one interpretation exists, present them. Do not pick one silently.
- If a simpler approach exists, say so. Push back when it is warranted.
- If something is unclear, stop. Name what is confusing. Ask.

Why this matters: hidden assumptions are the largest single cause of wasted iteration. A clarifying question costs one round trip. Building the wrong thing costs the whole feature plus the rework. When an instruction is ambiguous, the pull is to choose the likeliest reading and keep moving. That pull is exactly what this skill exists to interrupt.

## 2. Simplicity first

**Write the minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for code that is used once.
- No flexibility or configurability that nobody requested.
- No error handling for scenarios that cannot happen.
- If you wrote 200 lines and it could be 50, rewrite it before showing it.

Sanity check: would a senior engineer reading this change call it overcomplicated? If yes, simplify before presenting it.

Why this matters: every unnecessary line is a future bug, a future refactor and a future reader's confusion. A speculative abstraction rarely matches the shape of the real requirement when it arrives, so it has to be unwound. Three similar lines are better than a premature abstraction, because extracting a helper later is easier than undoing a wrong one.

## 3. Surgical changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Do not improve adjacent code, comments or formatting.
- Do not refactor things that are not broken.
- Match the existing style, even where you would choose differently.
- If you notice unrelated dead code or a latent bug, mention it in your reply. Do not fix it silently.

When your change creates orphans:

- Remove the imports, variables and functions that your change made unused.
- Leave pre-existing dead code alone unless you were asked to remove it.

The test: every changed line traces directly to the request. If a diff hunk does not, justify it in your reply or revert it.

Why this matters: drive-by refactors widen the change, confuse reviewers, invite merge conflicts and bury the real change under noise. The operator asked for X, so deliver X, not X plus opinions about the rest of the file. If the surrounding code needs work, surface it as a follow-up and let the operator decide. Do not smuggle it in.

Where the project keeps a record of accepted debt and settled decisions, an observation that matches a recorded row is not a finding. Cite the row and move on.

## 4. Goal-driven execution

**Define success criteria. Loop until they are verified.**

Turn vague tasks into verifiable goals:

- "Add validation" becomes "write tests for invalid inputs, then make them pass".
- "Fix the bug" becomes "write a test that reproduces it, then make it pass".
- "Refactor X" becomes "confirm the tests pass before and after, and that nothing else changes".

For multi-step tasks, state a short plan first, then execute it and confirm each verification before moving to the next step:

```
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Why this matters: strong success criteria let you loop on your own and finish without constant clarification. Weak criteria ("make it work") leave you guessing what done means and leave the operator babysitting. A named verify step also catches code that looks right but does not run. If you cannot name the check, you cannot claim the task is finished.

## Tradeoff disclosure

These guidelines favor caution and clarity over speed. For a one-line typo fix, a rename or a config tweak, applying all four is overkill, so use judgment. The principles earn their cost where getting it wrong is more expensive than asking one more question, which is most non-trivial work but not all work.

## Closing the task

When you finish, say in your reply:

- The assumptions you made and any that the operator should confirm.
- The verification you ran and its result, or that none was possible and why.
- Anything you noticed but deliberately left alone, so the operator can decide what to do with it.
