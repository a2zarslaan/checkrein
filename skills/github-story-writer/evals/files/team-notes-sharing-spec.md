# Feature spec: shared notebooks

## Background

The notes app lets each user write private notes, group them into notebooks, tag them, and search them. Teams have asked for one thing above all: a way to keep a notebook that several people can read and edit together. Today they copy notes into chat threads, which loses edits and history.

This spec describes shared notebooks. It is the planning input for the stories that will build the feature.

## Goals

1. A notebook owner can invite other users to a notebook by email.
2. Each member has a role on that notebook: viewer (read only) or editor (read and write).
3. Members see shared notebooks next to their own, clearly marked as shared.
4. Edits by one member appear for the others without a manual reload.
5. Every change to a note in a shared notebook records who made it.

## Out of scope

- Public links readable without an account.
- Sharing a single note outside its notebook.
- Real-time co-editing of the same paragraph (last write wins on save, with a conflict notice).
- Comments on notes.

## Roles and permissions

| Action | Owner | Editor | Viewer |
|--------|-------|--------|--------|
| Read notes | yes | yes | yes |
| Create, edit, delete notes | yes | yes | no |
| Rename the notebook | yes | no | no |
| Invite or remove members | yes | no | no |
| Change a member's role | yes | no | no |
| Delete the notebook | yes | no | no |
| Leave the notebook | no | yes | yes |

There is exactly one owner per notebook. The owner cannot leave; they can only delete the notebook or transfer ownership (transfer is a later phase and out of scope here).

## Data model

- **NotebookMember:** notebook id, user id, role (viewer or editor), invited by, joined at. One row per user per notebook; a duplicate invite updates the existing row instead of adding a second.
- **NotebookInvite:** notebook id, invitee email, role, token, expires after seven days, accepted at. An invite to an email that already has an account still goes through the invite flow so the invitee can decline.
- **NoteRevision:** note id, author id, saved at, title and body snapshot. A new revision is written on every save of a note in a shared notebook. Private notebooks keep the current behavior (no revisions).

Deleting a notebook deletes its members, pending invites, notes and revisions. Removing a member keeps every revision that member authored.

## API

- `POST /notebooks/:id/invites` (owner): body `{ email, role }`. Sends the invite email. Returns the invite without its token.
- `POST /invites/:token/accept` (signed-in invitee): creates the member row. Fails with a clear error when the invite expired or the signed-in email does not match.
- `GET /notebooks/:id/members` (any member): members with role and joined date.
- `PATCH /notebooks/:id/members/:userId` (owner): body `{ role }`.
- `DELETE /notebooks/:id/members/:userId` (owner, or the member themself to leave).
- `GET /notes/:id/revisions` (any member of a shared notebook): newest first, paginated.

Every existing note endpoint must check notebook membership and role, not only note ownership. A viewer calling a write endpoint gets a forbidden error, never a silent no-op.

## Live updates

When a member saves a note, other members viewing the same notebook see the new version within a few seconds. A member editing a note that someone else saved in the meantime gets a conflict notice on save, with the choice to keep their version or load the newer one. The mechanism (polling or a push channel) is an architecture decision for the team; the spec only fixes the behavior.

## Interface

- The sidebar lists "My notebooks" and "Shared with me" as separate groups.
- A notebook's settings page gains a Members tab: the member list, an invite form (email plus role), and role and remove controls for the owner.
- A note in a shared notebook shows "Last edited by <name>" and a History panel listing revisions.
- A viewer sees notes read only; the edit controls are hidden, not merely disabled.

## Email

One new email: the invite, naming the inviter, the notebook and the role, with an accept link. No other sharing event sends email.

## Acceptance for the feature as a whole

- An owner invites a colleague as an editor; the colleague accepts, edits a note, and the owner sees the edit without reloading.
- A viewer cannot change anything, through the interface or the API.
- Removing a member immediately revokes their access, including any page they already have open.
- The revision history of a shared note shows every save with its author.
