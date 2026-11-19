# Delivery state

- PM M0: requirements and confirmed platform scope recorded; active.
- Architect A7: verified and approved, architecture.md; owns design records only.
- Engineer E7B /media_backend: active; owns media/**, shared types/schema/migration, media actions/jobs, AI beforeAttempt budget hook, env/redaction/readiness/storage helper and worker Docker/render tooling; backend-integration.md.
- Engineer E7U /media_ui: active; owns pack flow/preview/controls/downloads, ordered-slide publisher integration, social.generate/auto orchestration and default-off automation setting; ui-integration.md. Coordinate shared contracts directly with E7B.
- QA Q7: independent acceptance and browser verification planned after integration.

Latest direction: generated-first journey, no manual video-upload prompts/requirement. E7U reactivated for default YT/TT video + IG Recommended and complete pack-generation continuation, E7B coordinating backend intent/defaults; Q7 acceptance updated. PM owns brief/state; engineer updates handoff only. Prior UI freeze is invalidated by these requested changes. Backend closing architect peer-review source freshness, actual narration cue timing, accounting estimates, scheduler cleanup and lock-loss cancellation fixes before final freeze.

Next authorized sequential phase: five selectable video style presets, current drawing/narration one of five. Begin after this phase verified and delivered; .factory/video-style-presets/brief.md.

Base: advanced to main a8956315d30c64c0427b2c962bbf06f90cb8bf83 (PR64 OAuth fix). Worktree /Users/ekene/.codex/worktrees/radar-generated-media/radar-push, branch kenny/generated-social-media. Retention work is separate; merge its final main revision before final verification.

PM setup: actual Brian eleven_v4 timestamped sample passed once with existing restricted local key; 464characters, 29.04s audio, matching monotonic alignment. Sample retained /tmp/radar-explainer-spike, no public post. Model/voice unchanged; observed167wpm at historical0.88 setting justifies a slower generation setting (not audio time stretching) for relaxed narration. Key staged only worker via Railway stdin/skip-deploys, no deployment triggered or secret in records. No production media feature enabled yet.
