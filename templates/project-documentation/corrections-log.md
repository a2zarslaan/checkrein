<!--
Contract: the corrections log. It holds anti-patterns found in review,
debugging and post-merge, each as a rule that stops the same mistake twice.

What never belongs here: behavior (business rules), design rationale (the
architecture record), or what exists (the state document). Code never
restates or line-cites an entry; the log is the one home for each rule.

Who writes it: the post-merge skill appends entries after a merge. Newest
first, append-only: an entry is never rewritten, except to fold a recurrence
into it or to correct a misassigned domain tag.

Heading grammar (the check enforces it). Every rule heading is exactly one of:
  ### Pattern [<domain>, <domain>]: <one sentence naming the failure mode>
  ### Convention [<domain>, <domain>]: <one sentence naming the convention>
Use one or more domains, comma separated, each taken from the manifest's
`domains` list. A Pattern records a failure that happened; a Convention
records a decided way of doing something. Below the heading, the entry
carries these four bold fields, in this order: What went wrong, Correct
approach, Rule, Files affected. Entries may be grouped under a
"## PR #<number>: <PR title>" section naming the merge that produced them.

How agents read it: never in full. The headings are the index. Search for
`^### (Pattern|Convention) \[` with line numbers, scan every heading line,
then read about 40 lines from each heading whose tags or wording match the
task, plus every `process` entry. Matching rules are hard constraints; a task
that must deviate names the rule and the reason in the PR body.

Example entry (invented, for shape only):

  ### Pattern [frontend, shared]: A date-formatting helper assumed the server's timezone, so due dates on notes shifted by one day for users far from the server.
  - **What went wrong:** The helper built the display date from the server's midnight instead of the viewer's, and every test ran in the server's timezone, so none failed.
  - **Correct approach:** The helper takes the viewer's timezone as an argument, and its tests run the same input in two timezones on either side of the date line.
  - **Rule:** A function that turns a timestamp into a calendar date names the timezone it uses; a test pins at least two timezones.
  - **Files affected:** the shared date helper and its tests.
-->

# Corrections Log

Headings are the index: grep them, pull matching entries, never read the whole file.
