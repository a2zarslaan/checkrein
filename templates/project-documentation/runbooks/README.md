<!--
Contract: the runbooks folder. A runbook is a procedure the operator runs by
hand: operations, deploy, rollback, and integration setup.

What never belongs here: why the procedure is shaped the way it is (the
architecture record), product behavior (business rules), or one-off notes
from a single incident (the issue that tracked it).

Who writes it: whoever makes the decision that needs the procedure, at
decision time, in the same PR that makes it necessary. A runbook that lags
the system it operates is worse than none, because the operator trusts it.

How agents read it: an agent reads the runbook that governs an ops task and
hands the operator its commands. The agent never connects to production
itself; when a production step is needed, it gives the exact command and
stops.
-->

# Runbooks

## What lives here

One file per procedure, named for the job it does, for example "deploy.md", "rollback.md", "operations.md", or "<integration>-setup.md".
Each runbook uses the same shape:

- **Purpose:** what the procedure achieves, in one sentence.
- **When to run:** the trigger, and when not to.
- **Prerequisites:** access, versions and state the operator confirms first.
- **Steps:** numbered, one command per step.
- **Verify:** the command that proves it worked, and the output to expect.
- **Undo:** how to back out, or a link to the rollback runbook.

## Every command is single-line and short

Anything an operator pastes is one physical line, short enough not to wrap (aim under about 80 characters). Multi-line pastes break in real terminals and cost time diagnosing the paste instead of doing the work.

Never use, in any command handed to an operator:
- heredocs of any form;
- trailing backslash line continuations;
- pipelines split across lines;
- multi-line control flow (if, for, while blocks).

Stay single-line, in this order of preference:
1. Content of one to three lines: one `echo '...' > <file>` or `printf '...' > <file>`.
2. A short script body: `printf '%s\n' 'line one' 'line two' > <file>` on one line.
3. Anything longer than about five lines: tell the operator to open the file in an editor and paste the content, shown as a reference block.
4. Several commands: chain them with `&&` on one line, or split them into numbered steps.
5. Control flow: put it in a script file (created by step 3), then run that file with one short command.

Prefer paths relative to the repository root over absolute paths. If a command still cannot be made short, split it.

## Keep versions in step

Example commands use the exact versions the project pins. When a pin moves, update every runbook that shows it in the same commit: operators copy what they see.
