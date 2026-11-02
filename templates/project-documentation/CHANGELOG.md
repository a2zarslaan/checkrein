<!--
Contract: the changelog. It answers "what changed, per merged PR?"

What belongs here: a short narrative of each merged PR, in the words a
teammate would use to describe it: what was added, what changed, what was
fixed. Every merged PR earns a section, structural or not.

What never belongs here: the structural inventory (the state document),
rules learned from mistakes (the corrections log), design rationale (the
architecture record), or release dates. Git owns history and dates.

Who writes it: the post-merge skill, when the operator runs it, either after
one merge or over a batch of them. Sections are ordered by merge time, never
by PR number, because PRs do not merge in the order they were opened.

How agents read it: rarely in full. An agent asking "when did this behavior
change?" searches the section headings, then reads the one section it needs.

Grammar (the check enforces it):
## PR #<number>: <PR title>
### Added
### Changed
### Fixed
One "##" section per merged PR, newest first. Each "###" subsection appears
only when it has at least one bullet; never leave an empty subsection.

Example section (invented, for shape only):
## PR #42: Add offline drafts to the notes editor
### Added
- Drafts save locally while the editor is offline and upload when the connection returns.
### Fixed
- The save indicator no longer reports success before the server confirms.
-->

# Changelog

No merged PRs recorded yet. The post-merge skill replaces this line with the first section.
