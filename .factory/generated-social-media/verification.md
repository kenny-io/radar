# Verification

Required checks are M1–M10 in brief.md. Implementation is active, not release-ready. Record exact tested revision and independent acceptance after freeze.

PM setup: real Brian eleven_v4 timestamped narration succeeded once, source/review/alignment/audio retained /tmp/radar-explainer-spike. Actual audio29.04s/81words, alignment monotonic/matching, maxpeak-2.4dB, mean-22.8dB; metadata/diagnostics only, no listening claim.

First cached-audio real render: /tmp/radar-media-spike/video.mp4,1080x1920/24fps,H264/AAC,30.34s,2,011,209bytes; backend reports full decode and volume diagnostics passed. PM visually inspected opening/midstroke/handoff/revisit/final frames. Text size/colors/diagram arrows legible, but M4/M5 fail this first pass: orphan caption line 'go' then next caption 'out.', phrase split 'record of / what happened', and entirely blank diagram at scene handoff although all semantic objects recur. Backend asked to fix measured balanced clause captions, immediate first input and persistent common objects at transitions, with regressions and cached rerender. These are required fixes, not accepted limitations. Fixture also needs a visible time gate/account check/receipt feedback rather than repeated generic three-card scenes; semantic node kinds must render meaningful shape/state distinctions.

V2 cached-audio render /tmp/radar-media-spike/video-v2.mp4: PM inspected opening-v2/handoff-v2/revisit-v2 images; previous orphan caption and blank handoff defects resolved. Balanced complete sentence captions, immediate recognizable input and retained-receipt cylinder/feedback clearly visible. Spike visual pass approved; this does not yet verify an actual model-generated plan, full workflow, listening or production artifacts.

PM inspected actual JPEG carousel slide-01-v2 and slide-03-v2 at1080x1350: legible labels/relationships, complete explanatory summaries, meaningful queue/time-gate and retained-receipt feedback, correct visible1/3and3/3order, no visible truncation/overflow. Full ordered publishing path remains Q7 acceptance-owned.

No independent Q7 acceptance, integrated build or production generation verified yet. No public post used for QA.

Local Linux worker image precheck attempted with Docker Desktop29.7.2/aarch64 and linux/amd64 target. It stopped at public Node base-manifest fetch with DeadlineExceeded, before any Dockerfile package/source step. Log /tmp/radar-media-worker-docker.log; this is not a passing Linux image build. Worker binary/font/runtime checks and actual image build remain required in the deployment environment. Do not weaken TLS or system network settings to bypass the local registry issue.
