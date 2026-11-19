# Delivery state

- PM M0: requirements and confirmed platform scope recorded; active.
- Architect A7: verified and approved, architecture.md; owns design records only.
- Engineer E7B /media_backend: active; owns media/**, shared types/schema/migration, media actions/jobs, AI beforeAttempt budget hook, env/redaction/readiness/storage helper and worker Docker/render tooling; backend-integration.md.
- Engineer E7U /media_ui: active; owns pack flow/preview/controls/downloads, ordered-slide publisher integration, social.generate/auto orchestration and default-off automation setting; ui-integration.md. Coordinate shared contracts directly with E7B.
- QA Q7: independent acceptance and browser verification planned after integration.

Latest direction: generated-first journey, no manual video-upload prompts/requirement. E7U reactivated for default YT/TT video + IG Recommended and complete pack-generation continuation, E7B coordinating backend intent/defaults; Q7 acceptance updated. PM owns brief/state; engineer updates handoff only. Prior UI freeze is invalidated by these requested changes. Backend closing architect peer-review source freshness, actual narration cue timing, accounting estimates, scheduler cleanup and lock-loss cancellation fixes before final freeze.

Next authorized sequential phase: five selectable video style presets, current drawing/narration one of five. Begin after this phase verified and delivered; .factory/video-style-presets/brief.md.

Base: advanced to main a8956315d30c64c0427b2c962bbf06f90cb8bf83 (PR64 OAuth fix). Worktree /Users/ekene/.codex/worktrees/radar-generated-media/radar-push, branch kenny/generated-social-media. Retention work is separate; merge its final main revision before final verification.

Integration: frozen media implementation committed as d6106456; deployed main/A6 + origin fixes merged at 40e0f092a73a54fed0bc826208e46f1af024d21e. Only conflict was equivalent upload route test table placement; retained main's independently verified version. Runtime auto-merges require combined verification.

A7A youtube-automation-design.md approved to close the actual unattended YouTube posting gap. E7U now owns its full-stack implementation plus generated editable title and all existing A6/media guard coexistence. E7B owns read-only integration review, no concurrent source writes. Required integration fix from that review: acquire business policy/FK lock before pub/pack/generation admission locks to avoid deadlock with A6 cleanup. Q7 extends acceptance to M11 and this concurrency boundary; final source not yet frozen.

E7U A7A is now frozen: automation-integration.md, 24-path fingerprint71ced612e480ffe4750bd06d7282ad4bc9cb5ba72d5da8a55381c2080c308432; final37new tests, prior177integrated+91additional and7developer browser checks pass; typecheck/diff clean. Business-first admission fences and per-pack notes context included. Q7 final independent acceptance dispatched against integrated source.

PM Node22 isolated production build passed on873 source/public/assets/config files with unchanged source/copy hashbd7ad2ef36a6b54a44063aab6d77e6f9c19fd41ee6929323d2a7e23b5110fb07, BUILD_IDxhmcGjFzZ8SVxesP3AJyd; /tmp/radar-generated-media-build.json and .log. Linux image precheck blocked only by local Docker manifest-fetch timeout; direct official Docker Hub metadata independently confirmed the exact pinned Node tag/digest and amd64 support. Actual deployed image/binaries remain required.

Production configuration staged without deployment: worker speech secret present; both web/worker model eleven_v4, speed0.78, speech estimate0.08USD/1000characters, media rolloutoff. Web has no speech secret. No generation cohort activated or new automatic preferences enabled. Owner YouTube default preference question pending; do not infer an answer or use preselected options.

PM setup: actual Brian eleven_v4 timestamped sample passed once with existing restricted local key; 464characters, 29.04s audio, matching monotonic alignment. Sample retained /tmp/radar-explainer-spike, no public post. Model/voice unchanged; observed167wpm at historical0.88 setting justifies a slower generation setting (not audio time stretching) for relaxed narration. Key staged only worker via Railway stdin/skip-deploys, no deployment triggered or secret in records. No production media feature enabled yet.
