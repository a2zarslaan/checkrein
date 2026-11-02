<!--
Contract: the project brief.

What belongs here: what the product is, who it is for, what matters most,
the constraints it lives under, and what it deliberately is not.

What never belongs here: how the system is built (the architecture record),
how features behave (the business rules record), what exists in the code
today (the state document), or plans for in-flight work (working docs).

Who writes it: the operator, once, when the project adopts checkrein, and
again only when the product itself changes direction. Agents never edit it.
When an agent finds the brief contradicting the code or an issue, it says
so and the operator decides which one is wrong.

How agents read it: planning agents and the github-story-writer skill read
it in full before breaking work into stories. Implementing agents read only
the section a task needs. Keep it short so a full read stays cheap.

Replace every guidance line below with your own text. Keep the headings so
every agent finds the same section under the same name.
-->

# Project Brief

## What the product is

One paragraph: what the product does and the core loop a user repeats.
Example: a notes app where small teams write, tag and share notebooks, then find any note again in seconds.

## Who it is for

The users and roles the product serves, one line each, with what each role needs most.
Example: Writer (creates and edits notes), Reader (browses shared notebooks), Owner (manages the team and billing).

## Priorities

An ordered list. When two goals conflict, the higher one wins, and agents use this order to break ties.
Example: 1. Never lose a note. 2. Search is fast. 3. The editor feels simple.

## Constraints

Hard limits the work lives under: team size, budget, hosting, compliance, supported platforms, scale.
State each as a fact an agent can check a proposal against.

## Non-goals

Outcomes the product will not chase even inside its own scope, so agents stop proposing them.
Example: no real-time co-editing; one writer per note at a time is the decided model.

## Out of scope

Work this repository does not do, even when it is related: a desktop client, importing from other note tools, a public sharing page for notebooks.
An agent that finds a task drifting here stops and asks the operator.

## Glossary

The one name for each thing, used the same way in issues, code and docs.
Example: "notebook" (never "folder"), "note" (never "page").
