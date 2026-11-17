# Brief: delete a business

Requested 2026-11-16. Branch `kenny-dev/radar-delete-business-36eee1`, base `main` `ead40f9b`.
Delivery: pull request to `main`. No merge or deploy without the owner's go-ahead (`main` auto-deploys).

## Problem
An account can hold several businesses (say Thally and Lived). There is no way to stop managing one. The owner
wants to delete a business and everything Radar holds for it. Radar keeps the data for 7 days after the delete,
then wipes it for good.

## Smallest complete version
1. The Owner deletes the business they have open, from Settings, after typing its domain.
2. From that moment the business is gone from the product for every member and all background work on it stops.
3. For 7 days the Owner can restore it, exactly as it was.
4. After 7 days a worker job wipes it. Nothing can bring it back.

## Decisions (PM, 2026-11-16)
- **Owner only.** Admins cannot delete or restore.
- **Restore is self-serve.** "Kept for 7 days" is only useful if the owner can get it back without support.
- **The window is enforced by time, not by the job.** Restore stops working at `purgeAt` even if the wipe has
  not run yet.
- **Connected-service tokens stay through the window** (so a restore is complete) and are revoked at the wipe.
- **Nothing scheduled fires late.** A post or article whose time passed while the business was deleted is not
  sent automatically after a restore.
- **Billing is untouched.** The subscription is per account (flat price, not per business). The dialog says so.
- **Deleting the only business is allowed.** The owner lands in the no-business state with Add and Restore.
- **One confirmation email to the owner**, with the wipe date and a restore link. It is also the way back in
  when no business is left.
- Content already published to the owner's site or social accounts stays there. The dialog says so.

## Exclusions
- Deleting the whole account, transferring ownership, exporting data before the delete.
- Deleting a business the owner cannot open (locked for no subscription): through support, as today.
- Onboarding drafts (they already have their own reset path).
- Telling the other team members by email.
- Support tooling to restore after the wipe (there is nothing to restore).

## Experience
Settings → Workspace group → new section **Delete business**, listed for the Owner only.

- Row "Delete <name>": one paragraph on what goes and the 7 days, and a danger button "Delete business".
- Dialog (existing `Modal`): title "Delete <name>?"; what stops now; "Radar keeps it for 7 days, until <date>,
  then wipes it for good"; "Your Radar subscription is not affected" and "Posts already published stay where
  they are"; a field "Type <domain> to confirm"; Cancel and a danger "Delete business" that is disabled until
  the text matches. Shows a busy state while it runs and the server's message if it fails.
- After: the app opens the next business the owner can use (Dashboard), or the no-business state. A toast says
  "<name> deleted. You can restore it until <date>."
- **Recently deleted** list under the delete row, and the same list on a standalone signed-in page that works
  with no business left: name, domain, "Wiped on <date>", a Restore button. Empty list: the block is not shown
  in Settings; the standalone page says there is nothing to restore.
- The no-business screen (onboarding) shows one line linking to the standalone page when the owner has a
  business inside its window.
- Restore: the business reappears in the switcher and opens. Toast "<name> restored."
- Uses the existing design system (`Section`, `Row`, `Modal`, `Btn`, toasts). Works at phone width, by keyboard
  (focus stays in the dialog, Esc cancels, Enter does nothing until the text matches), with labelled controls.
  Copy follows the house style: says "Radar", plain words.

## Acceptance criteria

### DEL — delete
- DEL-1 The section is listed for the Owner only. The server refuses a delete from anyone else whatever the UI shows.
- DEL-2 The delete needs the business's domain typed (trimmed, case-insensitive). The server checks it too.
- DEL-3 On confirm the business is marked deleted with `deletedAt = now` and `purgeAt = deletedAt + 7 × 24 h`.
  The owner is moved to the next usable business or the no-business state, with the toast.
- DEL-4 From then on, for every member including the owner: the business is not in the switcher or in
  `me.businesses`; its workspace, act, events, media, support and stored-file routes answer as not found; a tab
  another member had open on it moves them to their next business or the no-business state without an error screen.
- DEL-5 All background work on it stops: queued jobs do not run, crons skip it, nothing is published or posted,
  no AI or paid API call is made for it, no email about it is sent except DEL-7. A job already running does not
  publish, post or send after the delete.
- DEL-6 The owner's other businesses and billing are unchanged. Other accounts never see the deleted business
  offered as a backlink partner.
- DEL-7 The owner gets one email: what was deleted, the wipe date, a restore link. A mail failure does not fail
  the delete.
- DEL-8 Only an active business can be deleted this way. Deleting twice is harmless. Invite links to a deleted
  business fail as an invalid invite.

### RES — restore
- RES-1 Until `purgeAt` the owner sees their deleted businesses in Settings and on the standalone page, which is
  reachable with no business left and from the email.
- RES-2 Restore brings back the same business: content, settings, connections, team and roles. Background work
  resumes on the next scheduler tick with no backlog burst, and nothing whose time passed while it was deleted
  is sent automatically.
- RES-3 Owner only. Refused with clear copy once `purgeAt` has passed, whether or not the wipe has run.
- RES-4 Restoring twice, or two clicks at once, is harmless.

### PUR — wipe
- PUR-1 A worker cron wipes every business whose `purgeAt` has passed, within about an hour of it.
- PUR-2 After the wipe nothing identifies the business: no row in any table (including tables that carry a
  business id without a foreign key), no stored file under its prefix, and its Search Console, social and blog
  tokens are revoked where the service has a revoke call (best effort, after commit). Kept, and listed in the
  architecture: account-level billing records, and one content-free log line for the wipe.
- PUR-3 The wipe is idempotent and safe with several workers. One failing business does not block the others
  and is retried on the next run. A restore racing a wipe ends as either fully restored or fully wiped.
- PUR-4 A business that is not marked deleted, or whose `purgeAt` is in the future, is never wiped (tested).
- PUR-5 Each run logs how many businesses it wiped and any failure, without business content.

### EDGE
- E-1 Deleting the only business leaves the owner able to add a business and to restore.
- E-2 Adding the same domain again during the window makes a new business; the deleted one stays restorable.
- E-3 Privacy page copy stays true (it says deleted data goes within 30 days).

## Decided after the architecture (2026-11-16)
Letters refer to `architecture.md` §12.
- **A (owner): keep published images.** Articles Radar published load their images from Radar's storage. The
  wipe removes every stored file of the business except image files used inside articles already published to
  the business's site, so those posts keep working. PUR-2 reads with that exception. During the 7 days public
  file URLs are left alone.
- B (PM): revoke Google at the wipe only when the owner has no other business holding Search Console tokens,
  because Google's revoke removes the grant for all of them. Otherwise the tokens are deleted without a revoke.
- C (PM): DEL-5 for a running job means no external call is started after the delete commits; one already on
  the wire completes.
- D (PM): no new retention rule for sent mail records in this change. Sent mail that names the business and
  carries no business id stays in the "kept" list. Leftover.
- E (PM): `events` and `ai_calls` are scrubbed to anonymous counters and kept.
- F (PM): restoring next to a newer business on the same domain is allowed, with no warning.
- G (PM): RES-2 states confirmed: overdue scheduled articles go to Review, overdue undrafted approved topics
  back to Proposed, overdue posts become "couldn't go out on time" with Try again. No extra notification.
- H (PM): restore works without a subscription; the business comes back locked.
- I (PM): another member's open tab shows "That business was deleted."
- J (PM, for the owner to review in the pull request): the privacy page gains one sentence saying images inside
  articles Radar already published stay available. E-3 reads with that sentence.
- K (PM): "published" for decision A also covers an entry Radar wrote to the site as a draft
  (`publish_remote` set), since the owner can publish that draft by hand.
- Delete and restore are two routes, not actions (the act route would rebuild the workspace of the business
  just deleted, and restore has no open business).

## Constraints
- Existing conventions: Drizzle schema plus a numbered SQL migration (`drizzle/0019_*`), actions in
  `src/server/actions`, crons through `defineCron` and `once`, user copy through `RadarError`.
- No new dependencies. No production database access; database tests run on a throwaway local Postgres.
- The wipe is the first code in Radar that removes a paying customer's data on a timer. It must fail closed:
  when in doubt it does nothing.
