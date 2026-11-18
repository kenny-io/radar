# Email cadence correction

## Problem

On 2026-11-18 the owner reported Radar "bombarding me with emails daily". Their inbox for 11–16 November shows about three emails a day from two senders:

- **Work reminders (#10–#14)**, "Your open decisions in Radar", one every day for the business without Autopilot. The spec capped optional mail at one per rolling 24 hours. The Daily Brief and the daily social drafts create new unfinished work every day, so the ceiling is reached every day.
- **Autopilot owner actions (#29)**, "Radar Autopilot: N actions need you", one to three a day for the business with Autopilot on. They are outside the optional cap. `enqueueHandoff` sends one email per batch of new item keys, and the keys are new every day (`brief:{date}:{item}`, `pack:{dailyPackId}:{platform}`, `blog:{date}`, `blog-paused:{date}`, `stage:{name}:{date}`). Items that arrive later the same day get their own email. A problem that has not changed, such as a social account that is not connected, is announced again every day because its key carries the day's pack id.

The only cadences the owner agreed to were weekly: the five lessons and the Monday report. Both behave correctly and are out of scope.

## Decision (owner, 2026-11-18)

1. Autopilot: at most one email per business per day; late arrivals go into the next day's email.
2. A standing problem ("connect your account") is sent once, not every day.
3. Work reminders: at most one digest a week.

## Acceptance criteria

- **EC-01** A business with Autopilot on produces at most one owner-action email per business-local calendar day, however many runs happen and however many new items appear.
- **EC-02** The day's email goes out once the day's work is ready (today's Daily Brief and daily social pack have been processed) or at a local cut-off hour, whichever is first, so the day's prepared replies arrive together and not as a first trickle. The architect sets the exact rule.
- **EC-03** Items found after the day's email are kept and included in the next day's email if they still need the owner then. Items that no longer need the owner (posted, copied, skipped, scheduled, removed, Autopilot turned off or re-enabled under a new activation) are dropped. Nothing actionable means no email.
- **EC-04** A standing problem is announced once per occurrence for a business and activation: social account not connected, expired or failing the publishing check; no usable blog connection; article publishing paused; a scheduled post held for reconnection. It is not repeated while it stays unresolved, and it can be announced again only after it has cleared and come back. It never causes an email beyond the one in EC-01.
- **EC-05** An account receives at most one work reminder email (`work_update`) per rolling 7 days across all its businesses. The 09:00–18:00 window, the rolling 24-hour optional cap and the priority order (course, report, guides, founder, work) still apply. A digest still has at most three sections, one per kind. Sources still resolve when the owner acts, and expired sources are dropped, never saved up into a burst.
- **EC-06** Rollout needs no replay and causes no burst. Mail already sent counts: an account that received a work reminder in the last 7 days gets none until 7 days have passed, and a business that already received today's Autopilot email gets no more today. Existing dedupe marks, queued jobs and frozen retry payloads stay valid; a retry sends the identical email under the same idempotency key.
- **EC-07** Essential, billing, security, lesson, report, guide, founder, invitation and partner emails are unchanged in trigger, cadence and copy.
- **EC-08** `docs/EMAILS.md` (#10–#14, #29) and `.factory/lifecycle-refinement/schedule.md` describe the new cadence. Any Settings or email copy that states a cadence is accurate.

## Exclusions

No new email families, no copy rewrite beyond what the cadence change makes untrue, no new preference toggles, no change to what Autopilot does in the product, no provider or infrastructure change. Avoid a schema migration unless the design cannot be made durable without one.

## Constraints

- Worker and web deploy together from `main`; merging `main` auto-deploys, so the merge needs the owner's go-ahead (`.factory/production-launch/state.md`, Delivery constraints).
- Production data cannot be read from here. Behaviour is proven in tests against a local database.
- Known baseline failures are listed in the local test notes (OpenRouter parity snapshot; whole-suite flakiness on one shared database).

## Intended delivery

One PR from `kenny-dev/radar-email-cadence-6eec24` to `main`, with these records. Merge and deploy after the owner's go-ahead.

## PM decisions on the design (2026-11-18)

Taken from `architecture.md` section 12; these refine the criteria above.

1. **EC-03, Daily Brief replies.** A reply found after the day's email is not emailed. The product expires open brief items at local midnight, so it cannot still need the owner the next day; keeping yesterday's replies actionable would be a product change, which is excluded. Failed posts, failed articles, standing problems and a manual daily-pack post (one day) are carried as designed.
2. **EC-02, floor.** The day's email is not sent before the business's daily social time (08:00 local by default), also on a day with no social post.
3. **EC-04, publishing check.** A post that fails its own publishing check (too long, image too big, images pending) is that day's work, one item per post. Only a missing or expired account and a held post are standing, per channel.
4. **EC-08, Settings copy.** The wording proposed in `architecture.md` section 12 item 4 is approved.
5. The historical preview catalogue under `.factory/lifecycle-refinement/previews/` is not regenerated; only the cadence strings in `scripts/preview-radar-emails.ts` change.
