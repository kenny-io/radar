# Daily social drafts

Radar should prepare social content without requiring a daily manual request. Users review, edit, schedule or publish from the existing social library.

## Scope and decisions
- Extend the existing social auto job, library and generation flow; no new infrastructure.
- Unset automatic preferences default to daily at 08:00 in the business timezone, LinkedIn/X, branded images, save to library. Preserve explicitly saved off/custom/platform/style preferences and existing explicit auto-scheduling opt-in.
- Ground drafts in business profile, recent published Radar/blog content, upcoming calendar topics and search signals. Fall back to profile knowledge when no articles or keywords exist. Avoid repeating recent content; never imply an upcoming article is already published.
- Manual generation and existing edit/copy/download/schedule/post controls stay available. Publishing availability remains controlled by the deployment's existing feature flag.
- Work in the supplied checkout preserving extensive existing uncommitted work. Delivery target: implemented and verified workspace changes; deployment is outside current authorization.

## Acceptance criteria
- AC1: An active business with unset preferences gets one automatic pack per local day after its due time without visiting the UI. Draft/onboarding businesses and explicit opt-outs do not generate. Existing billing gates apply.
- AC2: Daily retries, overlapping work and repeated scheduler ticks do not create duplicate packs. Enqueue errors can recover; delayed ticks catch up during the same day.
- AC3: Sources use available business/profile, recent blog or Radar articles and content-calendar information, with a viable profile-only fallback and recent-history guidance. Tenant boundaries hold; source failures do not permanently suppress other viable sources.
- AC4: Default output is an editable library draft, never implicitly scheduled or published. Existing explicit scheduling preferences remain compatible.
- AC5: Social Marketing explains proactive daily drafts, shows automatic provenance, offers settings/pause and retains manual generation plus existing review/edit/schedule/post controls. Cover empty, generating and failure states with existing components.
- AC6: Meaningful automated tests and independent browser QA verify daily creation, deduplication, settings, manual creation, persistence/editing and publishing control. Record environmental limitations honestly.
