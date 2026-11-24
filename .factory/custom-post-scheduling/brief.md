# Custom posts: write, attach media, schedule per platform

## Problem
Every Social Marketing pack today is written by Radar (`social.generate`, AI job). A user who already knows what they
want to say (e.g. for the Thally business) has no way to write their own post. Example from the user: a LinkedIn post that
goes out at 2pm tomorrow and a different X version that goes out at noon, with an uploaded image, kept inside each
platform's character limit.

## Smallest complete version
A "Write a post" path in Social Marketing that creates a **custom pack** (no AI, no job) holding the user's own text per
platform and the user's own media, which then uses the **existing** per-post Post now / Schedule / Move / Unschedule
machinery (`social.schedule`, `PublishBox`, `ScheduleModal`, `social_pubs`, worker sender). No second scheduler.

## Decisions (PM)
- Custom pack = `SocialPack` with `source.kind: 'custom'`, `auto: false`. Stored in `social_packs.data` (JSONB) — no migration expected; architect confirms.
- Text is the user's text verbatim. It is never passed through `enforce()`, `fitTo()`, `keepOnlyLink()` or competitor stripping. Over-limit text is blocked with a counter and message, never silently rewritten.
- Limits and counting reuse `src/lib/socialPublish.ts` (`LIMITS`, `charCount` — X weighted, URL = 23, emoji = 2; `preflight`). The same function is enforced on the server at schedule, post-now and send time (already the pattern; confirm it covers edits after scheduling).
- Media the user can attach: images (any platform that accepts them, up to the platform's image limit if the existing slide/image path sends them without adapter changes, otherwise one) and video where Radar already supports video (Instagram, TikTok, YouTube) via the existing upload route. Upload type is decided by sniffed bytes, never filename or declared MIME. Uploaded media is never labelled AI-generated (X `made_with_ai`, TikTok `is_aigc`).
- Custom packs hide AI controls that would overwrite the user's work (Regenerate text, Regenerate image, Style, explainer media generation). Autopilot, proactive and auto code never rewrite or auto-schedule a custom pack.
- Copy-only platforms (Facebook, Reddit, Quora) may be included as copy-and-paste text, same as today.
- Times are in the business time zone (`B.tz`), with the zone label shown. "Tomorrow" = `B.today + 1`.

## Decisions after architecture (PM, 2026-11-24) — see architecture.md
- D1 Images: JPEG, PNG, WebP (stills). GIF and animated WebP are out of v1 (unsafe to decode without a separate path).
- D2 Image upload works with publishing off (for copy/download); video upload stays behind the publishing flag.
- D3 No reminder email for custom packs. D4 Uploads only on custom packs in v1. D6 No rename after creation in v1.
- D5 One image per platform in v1 (the send path only allows multi-image slides on Instagram carousels). C4 reads "an image".
- Scheduling happens in the existing PackView (Schedule per tab or Schedule all) right after the composer creates the pack.

## Exclusions (v1)
Video on X and LinkedIn (adapters do not upload video), threads, X Premium long posts, polls, first comments, AI assist
inside the composer, duplicate-pack. Different account per post beyond the existing "Post as" choice.

## Acceptance criteria
- **C1 (user scenario)** From Social Marketing an Editor writes one custom post with different LinkedIn and X text, schedules LinkedIn for tomorrow 14:00 and X for tomorrow 12:00 (business time zone, label shown). After a reload both show as scheduled at their own times in the pack, the library (Scheduled filter) and the Calendar/WeekStrip where scheduled posts already appear. With dev stubs, the worker sends each at its own due time and the pack shows Posted with a link.
- **C2 Composer** "Write a post" sits beside "Generate social posts" (disabled for Viewers). The user names the post (optional, defaulted from the text), picks platforms, and writes per-platform text. Starting text can be shared across platforms and then edited per platform without losing the others.
- **C3 Limits** Each platform's editor shows a live counter using the platform's own counting (X weighted). Over the limit the counter and a message say by how much, and Post now / Schedule for that platform are disabled; the server rejects it too (schedule, post now, and at send if edited after scheduling). Empty text is blocked the same way. Text containing links, emoji and CJK counts as X counts it.
- **C4 Media upload** The user can attach an image (JPEG/PNG/GIF/WebP as each platform accepts) per platform, see a preview, replace and remove it. Wrong type, too large (> 5 MB or the platform's limit) or undecodable files show a clear error and keep the previous media. For Instagram/TikTok/YouTube the user can upload a video through the existing video upload. Platforms that require media (Instagram, TikTok, YouTube) say so before scheduling. Uploaded media is sent to the provider and never flagged as AI-generated.
- **C5 Schedule per platform** Each platform in the pack has its own Post now / Schedule with its own date and time; past times are refused; scheduling one platform never changes another. Partial failure leaves the pack saved and says which platform failed and why.
- **C6 Edit after scheduling** Text and media stay editable until the existing 5-minute lock; edits after scheduling are what gets sent and are re-checked against limits.
- **C7 No AI overwrite** A custom pack shows no Regenerate text / Regenerate image / Style / explainer generation controls; its header says it was written by the user; automatic drafts, autopilot and proactive code do not modify or auto-schedule it.
- **C8 Permissions and tenancy** Viewers can read but not create, edit, upload or schedule. Uploads and actions are scoped to the business; another business's pack or file cannot be read or attached. Deleted businesses do nothing (existing gates).
- **C9 Publishing off** With social publishing off for the business, the composer still creates custom packs for copy-and-paste and hides Post now / Schedule, as other packs do.
- **C10 Library** Custom packs appear in the content library, are searchable by name/text, filter by status like other packs, and have a sensible thumbnail (uploaded image, or a text/neutral tile).
- **C11 Responsive and accessible** The composer works by keyboard, fields have labels, counters are announced politely, and it fits a 375px viewport without horizontal scroll.

## Constraints
Follow ARCHITECTURE.md conventions (actions via `action()`, zod, `RadarError` copy says "Radar", role checks, `gateBusiness`,
`assertAuthOrigin` on upload routes, deleted-business rules). Extend the existing design system (`components/ui.tsx`,
`radar.css`); no new dependencies. Delivery: branch `kenny-dev/thally-custom-post-scheduling-dfb0dc` → PR to `main`.
