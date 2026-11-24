# UI design: custom posts

Companion to `architecture.md`. Extend the existing system only: `components/ui.tsx` (`Modal`, `Field`, `Btn`, `Seg`, `Tabs`, `Status`, `AutoText`, `Empty`), `PlatLogo`/`PlatName`, `radar.css` tokens. No new dependencies.

## 1. Flow (and why scheduling is not in the composer)

1. **Social Marketing** (`SocialMarketing.tsx:37-39`). Add `Btn kind="secondary" icon="edit"` "Write a post" in the `PageHead` actions, before "Generate social posts". It is `disabled` for Viewers, with the same `canEdit` as Generate. Route param `?write=1` opens it, like `?generate=1`.
2. **Composer** (`CustomPostComposer.tsx`, a `Modal full width={720}`). Name, platforms and starting text, each platform's text with its live counter, then **Save post**.
3. **Landing.** On success: `app.refresh()` is unnecessary because the act route returns the workspace. Call `onClose()` and `go('social', { pack: packId })`, and toast "Post saved. Add media and schedule each platform here."
4. **PackView in custom mode.** Tabs for each platform. Each tab has a text editor with a counter, a **Media** slot (upload image or video, replace, remove), and the existing `PublishBox` (Post as, Post now, Schedule, Reschedule/Unschedule, TikTok/YouTube options, issues). The header has **Schedule all** (`ScheduleAll.tsx`: one day, a time for each platform) when two or more platforms can be posted.

**Decision: schedule in PackView, not inline in the composer.**

- C1 is done in PackView in one of two ways:
  - Schedule all: pick tomorrow, LinkedIn 2:00 PM, X 12:00 PM, with the zone label shown by `TzNote`.
  - Or Schedule on each tab.
- Inline scheduling would duplicate `PublishBox`: account choice, expiry note, TikTok and YouTube options, locks, failed and held states, and the posted link. It would also need media before the pack exists, but the upload route needs a `packId`.
- The composer's job is to write. Media attaches after the save (C4 doesn't require it in the composer). The composer says so: "Next: add images or video and schedule each platform."

## 2. Composer

```
┌ Write a post ─────────────────────────────────────── [×] ┐
│ Name (optional)        [ Thally launch ……………………… ]        │
│                        hint: Shown in your content library. │
│ Platforms   [LinkedIn ✓] [X ✓] [Instagram] [TikTok] …       │  (toggle buttons, aria-pressed, wrap)
│ Starting text                                               │
│ [ textarea ……………………………………………………………………… ]                │
│ hint: Copied into each platform below. Edit any platform    │
│       without changing the others.                          │
│ ── LinkedIn ───────────────────────── 1,204 / 3,000 ──      │
│ [ AutoText (prefilled) ]                                    │
│ ── X ───────────────────── 312 / 280 · 32 over ── (red) ─   │
│ [ AutoText ]                                                │
│   Shorten by 32 characters to post on X. You can still save.│
│ ── Facebook ─────────────── 1,204 characters · copy & paste │
├─────────────────────────────────────────────────────────────┤
│ Next: add images or video and schedule each platform.       │
│                                       [Cancel] [Save post]  │
└─────────────────────────────────────────────────────────────┘
```

### Platforms

- Toggle buttons in a wrapped row (`row` + `flexWrap: wrap`, gap 8), each `PlatLogo` plus its label, using `aria-pressed`.
- The initial selection is LinkedIn and X.
- Instagram, TikTok and YouTube carry a sub-hint: "Needs an image or video" (YouTube: "Needs a video").
- Copy-only platforms carry "Copy and paste". When publishing is off, every platform carries "Copy and paste".

### Starting text and its link to each platform

- Each platform field holds `linked: boolean`, initially `true`.
- While a field is linked, it mirrors the starting text.
- The first edit to a platform field sets `linked = false`.
- Each unlinked field has a small `Btn kind="link"` "Use starting text", which sets `linked = true` again.
- Deselecting and reselecting a platform keeps its text for the session (C2: "without losing the others").

### Counters

- The shared `<TextBudget k text video?>` component (`TextBudget.tsx`) is used by both the composer and PackView. It renders `textBudget()` from `lib/socialPublish`, the same function the server's preflight uses.
- Postable platforms show `used / max`. YouTube shows "bytes". Copy-only platforms show "N characters".
- When text is over the limit, the counter turns `var(--bad)` and reads "· N over". A message line below says "Shorten by N characters to post on {Platform}. You can still save."
- Empty text shows the message "Write something to post on {Platform}." in muted tone, not red, until the user tries to save.

### Save post

- Disabled when no platform is selected, or while saving (`loading`).
- Calls `social.createCustom` with `{ name?, posts: selected.map(k => ({ platform: k, text })) }`.
- Over-limit text never blocks Save. All-blank text is refused by the server, with the message shown inline ("Write something to post.").

### Dirty close

- When any text exists, Escape, × and Cancel open the confirm "Discard this post?" with **Keep writing** and **Discard** (`Modal focus`).

## 3. PackView custom mode (`PackView.tsx`, branch on `isCustomPack(pack)`)

| Area | Generated pack (today) | Custom pack |
|---|---|---|
| Header sub (`:71`) | "From an idea · date" | "Written by you · {fmtD(created)}" |
| Text editor (`:80`) | `AutoText` | Same, plus `<TextBudget>` under it for **every** platform. This replaces the X-only counter at `:55,93`. |
| Preview media (`:81`) | Template `Visual` when no image | `PostMedia` slot: the uploaded image, the video, or an empty dashed tile reading "No image · text-only post" (Instagram/TikTok: "Add an image or video to post here"; YouTube: "Add a video to post here") |
| Regenerate text, Regenerate image, Style, Describe your image (`:93-103`) | Shown | **Hidden** |
| `ExplainerMedia` (`:85`) | Shown | **Hidden** |
| Reddit disclosure line (`:104`) | Shown | Hidden: the user's text has no added disclosure |
| `nImg` to PublishBox (`:86`) | Today's formula | `video ? 0 : imageUrl ? 1 : 0` |
| Download (`dlOne`, `:44-53`) | Template `visualBlob` fallback | Uploaded file through `/api/b/{bid}/media?url=` (as the video branch does); nothing when there is no media |
| Download all | Copy plus visuals | Copy plus the media that exists; the toast counts real files only |

## 4. `PostMedia` slot (`PostMedia.tsx`)

Shown in the right column above PublishBox. It reads "Media · {Platform}".

- **Image platforms** (all except YouTube):
  - An **Upload image** button over a hidden `<input type="file" accept="image/jpeg,image/png,image/webp">` with `aria-label="Upload image for {Platform}"`.
  - Once an image exists: the preview, plus **Replace image** and **Remove image** (`social.imageRemove`).
  - The hint says "JPG, PNG or WebP, up to 5 MB." Instagram and TikTok add "Saved as JPG." Instagram also adds "Between 4:5 portrait and 1.91:1 landscape."
- **Video** (Instagram, TikTok and YouTube; only when `B.social.publishing`):
  - **Upload video** and **Replace video** use the existing `/social-video` route. This revives `VideoAttachment` (`git show d6106456^:src/features/social/channels/VideoAttachment.tsx`) with its copy.
  - **Remove video** calls `social.videoRemove`.
  - Uploading an image while a video exists asks first: "Replace the video with this image?"
- **After a successful upload or remove,** call `app.refresh()`, as `VideoAttachment` did. The route answers `{ ok, image }`, not the workspace. Call `app.flushLater()` before uploading.
- **Client checks** run before the request: size over 5 MB, or the input's `accept` set, so the user gets instant feedback. The server stays authoritative.

## 5. States

| State | What the user sees |
|---|---|
| Empty library | Today's `Empty`, with both actions available: "Write a post" (secondary) and "Generate social posts" |
| Composer, empty | Save disabled until at least one platform is selected. Counters read 0. No error is shown. |
| Typing | Counters update on every keystroke. Their `aria-live` region updates only on threshold changes (§6). |
| Over limit | The counter turns red with "N over", plus the message line. In PackView, `PublishBox` shows the same problem in `Issues`, and Post now and Schedule are disabled (`blocked`, `PublishBox.tsx:49`). |
| Saving | Save shows `loading`, and the fields stay editable but are not resubmitted. If it fails, the inline error appears (`role="alert"`) and the text is kept. |
| Uploading | The slot button shows `loading` with "Uploading…" (`role="status"`), and the previous media stays visible. PublishBox gets `mediaBusy`, so Post now and Schedule are disabled while the upload runs. |
| Upload error | The server copy appears inline under the slot (`role="alert"`, `var(--bad)`). Examples: "Choose a JPG, PNG or WebP image.", "Choose an image smaller than 5 MB.", "Instagram images must be between 4:5 portrait and 1.91:1 landscape.", "Radar couldn't read that image. Try another file." The previous media is kept and the file input is reset. |
| Media required | Instagram, TikTok and YouTube with no media: the `Issues` list in `PublishBox` shows "Add an image or video before posting to Instagram." (custom copy), and the slot tile repeats it. |
| Scheduling | The existing optimistic `withPub` in PublishBox, the toast "Scheduled for Tue, Nov 25 at 2:00 PM GST", and `ScheduleAll`'s toast. |
| Scheduled with issues (edited after scheduling) | In the scheduled panel: `Status ok` "Scheduled · …", the `Issues` list, and the line "Fix this before {time} or it won't post." (warn). Reschedule is disabled; Unschedule stays enabled. |
| Partial failure (C5) | Every platform schedules independently on its own tab, so one failing never affects another. The failing tab shows the server refusal in a toast, prefixed by the platform name in Schedule all (`actions/socialPublish.ts:307`). Schedule all is all-or-nothing, and its window stays open with the error toast. The pack is always saved first, because scheduling only happens after creation. |
| Send failed | Existing: "Didn't post {date}", the reason plus "Nothing was published.", and **Try again**. |
| Locked (5 minutes) | Existing: the editor is read-only, "Sending at …", and the media buttons are disabled with the title "It's too close to send time to change now." |
| Publishing off | The composer is identical. PackView shows Copy text, Download (the uploaded image) and image upload. There is no video slot, PublishBox or Schedule all (today's `pubOn` branch, `PackView.tsx:72,86-91`). |
| Viewer | "Write a post" is disabled. PackView's editors are read-only (`:80`), the media buttons are hidden, and the uploaded image is still shown. Copy text works. |
| Library card | A custom pack with an image or video uses its cover. Without media, a neutral text tile shows the first 140 characters of the first post's text on `var(--fill)`, with the label "Text post". The card meta adds "Written by you". The status filter works the same way. |

## 6. Accessibility and keyboard

- **Composer focus.**
  - The composer is a `Modal` with `full` and `focus`. Focus starts on Name (`data-autofocus`), and Tab stays in the dialog.
  - Escape follows the dirty-close rule in §2.
- **Labels.**
  - Every field has a visible label through `Field`. Each platform editor's `aria-label` is "{Platform} post text", and its `aria-describedby` points to its counter and message.
  - Platform toggles are `button[aria-pressed]` inside `role="group" aria-label="Platforms"`.
- **Counters** have two parts:
  - The visible counter, plus a visually hidden `aria-live="polite"` sibling.
  - The live region announces only when the state changes, between within the limit, over the limit by N (rounded announcements) and empty. It never announces on every keystroke. Example: "X: 32 characters over the 280 limit."
  - Each editor's describedby text always holds the exact count.
- **Upload controls.**
  - The file input is a real `input[type=file]`, triggered by a `Btn`, so it works with Enter and Space.
  - Status and error regions use `role="status"` / `role="alert"`.
- **No color-only meaning.** Every red counter also says "N over".

## 7. Responsive (375 px)

- **The composer at 375 px.** `Modal full` fills the screen. Content padding is `clamp(16px,4vw,32px)`. The platform toggles wrap. Counters sit on their own line under each heading on narrow screens (`flexWrap: wrap`). The footer buttons stack with Save full-width (`btn-block` under 480 px).
- **No horizontal scroll.** The textareas are `width: 100%`, and long URLs wrap (`overflowWrap: anywhere`).
- **PackView** already collapses to one column under 1100 px (`PackView.tsx:76`).
  - The media slot buttons wrap.
  - `ScheduleModal`'s 7-column `DayPick` already fits 375 px: 7 × about 40 px plus gaps.
  - QA must confirm `ScheduleAll` rows wrap: they use `flexWrap`.

## 8. Copy (all strings)

| Element | Copy |
|---|---|
| Button | "Write a post" |
| Dialog title | "Write a post" |
| Name field | "Name (optional)", hint "Shown in your content library. Leave it empty to use your first line." |
| Starting text | "Starting text", hint "Copied into each platform below. Edit any platform without changing the others." |
| Re-link | "Use starting text" |
| Footer note | "Next: add images or video and schedule each platform." |
| Save | "Save post" |
| Toast | "Post saved. Add media and schedule each platform here." |
| Header | "Written by you · {date}" |
