# Suggested-change prompts and custom images

## Scope, starting point and ownership

Architecture task A1, based on the PM's `brief.md`. Inspected workspace `/Users/ekene/Downloads/design_handoff_radar/radar-push`, initially clean at `9d6c4016c693b9eecdda143a7c76b514e6da329d`; PM created `kenny/suggestion-prompts-custom-images` during discovery. No repository AGENTS.md found; user-provided instructions and `ARCHITECTURE.md`, `docs/CONTRACTS.md`, parent handoff `01-screens.md` §§6–8 and `02-system.md` §§7–10 apply. Existing architecture for body images also applies. No source implementation belongs to this architect.

Engineer 1 owns Performance UI, pure coding-prompt builder/tests, and narrow `suggestions.list` return-context changes in `services/gsc/suggestions.ts`. Engineer 2 owns image contracts/types, services, actions, social/Brief/article UI, tests, and corresponding image contract documentation. PM owns workflow records, environment, integration, independent QA and delivery. Coordinate any overlap through PM; no shared primitive restyling.

## Recommended design

Use deterministic prompt text over the exact recommendation already displayed. No extra AI request, job, database field or schema migration is needed for copying. Every actionable recommendation is rendered by `features/performance/Performance.tsx:133` RefreshSheet; Dashboard links there. The four suggestion kinds (refresh/meta/links/faq) all use the same diff shape in `server/services/gsc/suggestions.ts`. SEO title, meta and each add/edit block get a `Copy prompt` button; a `Copy all changes` action covers the whole suggestion. Empty title/meta rows render no action. Copy remains available to Viewer and never calls accept/dismiss/write actions.

Extend the existing image requests with optional per-item user direction and an explicit model-required mode. Keep provider ordering, crop sizes, object storage and existing default-generation behavior. Custom generation must never silently produce a brand template. The existing `renderImageFile` (`server/services/images.ts:128`) currently catches model failures and substitutes a template; bypass this fallback for explicit custom requests. No reference-image upload, search or provider edit API is in scope. A generated named subject is an interpretation; UI helper copy must not imply a verified photo of a real building.

## Prompt contracts and interactions

Builder input: suggestion `{title,why,impact,page,url?,kind,diff}`, business name and domain, plus selected scope (`all`, SEO title, SEO meta, block index). Return a string; missing optional context must not crash or invent source paths. Add `url` to `suggestions.list` from existing stored `SuggestionData.url`; legacy records fall back to resolving page against the business domain. This is an additive response field.

The string identifies the business/site and exact target URL/path, the requested change, and factual rationale. Title/meta include exact current/proposed values. Blocks include operation, heading and full instruction. All-scope includes all displayed changes. Include instructions to inspect the destination repository/CMS conventions, implement only selected scope, preserve unrelated functionality, verify facts/assets instead of inventing claims, perform relevant validation and summarize changes for review. Estimated impact must remain labeled as an estimate. Generic internal-links recommendations must not invent source article paths that Radar did not store.

Use existing Btn/Field/Sheet styling and responsive wrapping. Each button needs a distinct accessible name such as `Copy prompt for Photos`. Success feedback follows actual clipboard success. Existing `components/ui.tsx` copyText is fire-and-forget, so use a scoped awaited clipboard helper or carefully compatible improvement; catch async denial and expose a selectable read-only prompt as recovery. Clipboard writeText returns a Promise and can reject with NotAllowedError; see [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText). No new browser permission prompt is requested by Radar.

## Image contracts

Add optional JSON fields; preserve legacy absence:

- `SocialPost.imagePrompt?: string`: direction for this platform only. Existing pack-level `custom` remains a compatible default for old packs.
- `BriefImages.prompt?: string`: direction for this post's image set. Do not persist subject-specific text as the business-wide image default.
- Reuse `Article.img.prompt`. Body images already derive section-specific prompts from it in `services/drafting/bodyImages.ts:20`; explain this shared direction in the Media UI rather than introducing a separate per-image editor.
- `ImageReq.modelRequired?: boolean` (equivalent clear name allowed): when true, require a configured image model, use a model style (map branded/infographic to illustration), propagate model/storage failure as useful Radar error, and never render a template. Default false preserves existing callers. Image output remains `{url,bytes,type}` with existing tenant storage keys.

Actions remain Editor writes, tenant-scoped by existing dispatcher/context:

- `social.regenImage {packId,platform,prompt?: string}`: supplied prompt requests custom generation; omission regenerates with the persisted per-post direction when present, otherwise retains legacy behavior. Keep text, other posts, copy history and pub metadata intact. Update URL, seed, imageMeta, photo and compressed together only after success.
- `article.regenerateImage {entryId,prompt?: string}`: direct prompt avoids debounce races. Keep `article.save` for ordinary autosave. Explicit custom generation overrides static-template selection with an effective model style and stores consistent style/urlKey; keep prior cover on failure.
- `brief.visuals {date,id,style,n?,range?,prompt?: string}`: optional direction, existing remove semantics (`style:null`) and legacy range accepted. Store prompt on the item's image state; retry/regenerate passes it back. Existing `brief.visuals` job kind/ref remains unchanged.

Explicit custom prompt values are trimmed, nonempty and at most 1000 characters, consistently validated by UI and Zod. Empty optional Brief direction chooses the existing automatic path. Error copy should distinguish unavailable generation from retryable generation/storage failures, without exposing provider names/keys. Persist successful requests; keep failed typed input visible for retries. Prefer also preserving failed requested direction separately from the previous image if supported by the existing state without ambiguity.

Social PackView: below Style, add labeled `Describe your image` textarea, brief concrete subject/composition example and `Generate image` button. Keep Regenerate using the saved direction. State must be keyed/reset by pack/platform so switching tabs cannot apply LinkedIn text to X. Disable mutating controls for Viewer, active generation and publication locks. Preserve preview while busy and on failure; expose retry text near the field.

Article Media: make the existing Direction field clearly discoverable as the image prompt; add explicit `Generate from prompt` action separate from existing automatic Regenerate. Flush pending autosave and pass current prompt to the action. Cover generation affects cover only. Existing body generation uses the same article direction plus each section's context; no separate body prompt API is required for this increment. A user-requested body generation using custom direction must use strict generation if it is presented as fulfillment of that custom request; default full drafting retains compatibility.

Daily Brief Add/Change visuals modal: add optional labeled textarea and retain it when reopening/retrying. Keep style/count controls. For custom replacement, keep the last complete set visible while the candidate set is built and replace atomically only after all requested files are stored. Store request identity and pending target settings separately from the current complete URLs/meta, or use an equivalent job payload/snapshot approach; never publish a mixture of old and new images after partial failure. Error must remain visible even when old images are retained. Default generation may retain its existing streaming behavior.

## Isolation, concurrent changes and recovery

No client-set media URLs or file keys. Read/update rows by bid plus id. Generation prompt is untrusted user data passed only to an image provider; it is not executable instructions for Radar's action dispatcher. Do not fetch arbitrary photo URLs supplied in the prompt. Credentials remain in server env; existing generated public assets retain existing access semantics.

Preflight and final commit both recheck publication/editability and generation ownership. Social style/seed/prompt/image snapshot (or unique reserved request identity) prevents older renders from overwriting newer images or a subsequent style change. Recheck editability after model completion, since the post may become locked while the provider runs. Updating a different platform or post text during image work must survive.

Article cover work must use `assertArticleEditable`, `assertNoArticleWork` and the existing short article-row lock at admission/final commit, then compare generation inputs before merging only image-owned fields. Existing cover save rejects published/publishing but misses scheduled/pending-remote-publication restrictions; apply the stronger guard to the affected custom/cover path. Preserve current bodyImages, sources and SEO. Body-image completion already checks job attempt ownership and body snapshot; extend snapshot checks to direction/style if these can change while generating.

Brief job's existing seed check protects replacement/removal races. Custom pending results also need current request identity and publication lock/status checks at completion; stale or removed jobs discard output. A timeout can leave provider work running, so late completion must not overwrite a newer request. Storage failures leave prior complete media and useful retry state. Orphan candidate objects follow existing storage lifecycle; no new cleanup infrastructure is required here.

No migrations or new services are required. Existing SSE rev/job events and action errors cover observability; log failures with action/job context and without full user prompts or secrets. Rollback reverts code; optional JSON fields are ignored by older builds, and existing media remains usable.

## Implementation order and validation

1. Settle additive prompt/type/action contracts above; image engineer owns shared image fields. Both engineers can then implement independently.
2. Engineer 1 implements pure builder + reliable copy/recovery, then every RefreshSheet action.
3. Engineer 2 implements strict rendering and input validation first, then guarded social/article generation and Brief pending-set behavior, then UI wired to those contracts.
4. Focused tests, typecheck/build, PM integration review, independent real-browser desktop/mobile flows, draft PR.

Meaningful checks: every suggestion kind and single/all scope; exact copied values and URL; clipboard resolve/reject/manual recovery; Viewer local copy without mutations. Custom prompt reaches provider even from branded style; no provider/failing provider never returns template success; successful outputs match platform size; stored prompt/asset survive reload; text and other platforms survive; empty/overlong input and cross-tenant/Viewer requests rejected. Check lock transitions during generation, two overlapping requests, style/prompt changes, pending article jobs/publications, article prompt immediate click after typing, Brief partial-set failure/removal/replacement and job attempt expiry. Browser evidence must distinguish stubbed deterministic media from actual live provider output. Baseline raster hash failure documented in brief remains out of scope.

No unresolved product decision remains after PM's exclusion of reference photos. Main risks are falsely reporting template fallback as success, stale long-running completions, and losing existing media during a failed replacement. The strict path, guarded merges and atomic custom sets address those risks without new infrastructure.

## Integration review A2

Read-only interim review requested by PM while engineer 2 was still implementing. Confirmed unique social request reservation, atomic custom Brief candidate sets, strict rendering and stronger article publication guards were present. Sent these material findings directly to PM and engineer 2:

- Article style autosave renders outside the lock and initially committed its stale URL/urlKey without checking the latest image snapshot. A concurrent successful custom cover could be overwritten with the old render; require a snapshot comparison for rendered style commits.
- Brief failed/timed-out jobs can leave persisted `img.status='generating'`; the UI initially used that field alone and hid Retry/Change/Remove indefinitely. Terminal job status must expose failure recovery, with old complete images retained. Job ownership guards correctly prevent expired work from committing.
- Brief per-image monotonic seeds initially reset on Remove (`img=null`), allowing remove/re-add to reuse an old random 1–500 job identity. Use request identity that remains unique across removal, not only a counter derived from current image state.

PM resolved body scope during this review: custom cover input/action fulfills the article increment. No new body prompt API or control is required. UI may explain strict body-image reuse only after a custom cover succeeded (`img.modelRequired=true`); legacy automatic body direction remains compatible. This supersedes any broader interpretation of shared article direction above.

Recheck evidence: `server/actions/article.ts:68` now compares the cover snapshot before committing a rendered style change. `server/actions/brief.ts:130` creates a random request identity, persisted with the image and sent in the job payload; `services/brief/visuals.ts:28` and `:42` require it as well as seed. Removing/re-adding no longer permits an older request to commit. `server/workspace.ts:100` batches exact generating image job IDs, filtered by business and `brief.visuals` kind, and projects terminal/missing referenced jobs as failed while retaining complete assets/pending settings/direction. This survives reload after the normal two-minute recent-job feed expires. Article Media helper now describes body reuse after custom cover generation.

No additional material architecture blocker found in this source review. Independent execution/browser QA and the engineers' regression tests remain PM-owned. Residual recovery edge reported to PM: a process interruption between persisting `generating` and attaching jobId leaves no referenced job for the projection; a Change/Cancel recovery action while busy or broader setup-failure cleanup can address it without redesigning the queue. A successfully completed job read alongside an older day snapshot can briefly project failure; the next workspace revision resolves that ordinary eventual-consistency case.
