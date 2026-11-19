# M10 independent actual-media acceptance

**PASS for the actual generated-media/runtime artifact gate on deployed PR70, main `776be722f577c6d6c5570af5da2d84472bd6d9cb`.** No material artifact, content or timing defect found. This is the fresh live Owner pack, not the old0.88fixture. Prior local source/authorization/publishing QA remains separate.

## Independent observations

- Full MP4 decode succeeds with no FFmpeg errors. H264/yuv420p,1080×1920,24fps,2567frames; duration106.958333s. AAC mono48kHz is present for106.939s. Size6,734,798bytes. Container duration differs from master timeline106.939184s by19ms, within one24fps frame.
- Measured integrated loudness−16.7LUFS, range2.1LU, true peak−1.2dBFS: no measured clipping. Silence analysis at−45dB/0.5s finds no internal gap above0.77s; opening0.525s and trailing1.031s agree with the short lead/final hold. **No listening/playback QA capability was available; pronunciation, clicks and subjective delivery are not verified.** Measurements are not a listening claim.
- The actual checkpoint’s strict normalized Plan passes validation. Its1,614character alignment matches all259reviewed spoken words. All31captions contain the same words in order, have valid nonoverlapping timing and measured readable line fits (4–12words per caption). Full scene/cue/caption timeline recomputes exactly from saved actual alignment and audio duration, including the500ms audio offset.
-31actual MP4 frames sampled at exact24fps indices across opening, first/partial drawings, edge cues, every scene handoff and final hold match checkpoint rendering; minimum SSIM0.99757. Actual opening/partial frames, all4handoff pairs, completed relationships and final hold visually inspected. No clipping/material collision found. This storyboard contains0revisit cues; no live revisit sequence is claimed. Revisit behavior was independently verified in prior Q7L synthetic timing QA.
- All5actual ordered JPEG slides decode at1080×1350 and were visually inspected. Full titles, summaries, states, relationship labels and illustrative qualifications are legible. Their visual comparison to current checkpoint rendering gives SSIM0.99552–0.99636. Local JPEG encoding is not byte-identical, so no exact local-rerender-byte claim is made.
- Reviewed script/claims/caveats are internally consistent: independent checks remain independent, schematic results are qualified as illustrative, and no combined score or guaranteed reachability/ranking/business outcome is asserted. Source remains identified as owner-provided; this pass does not independently research the unavailable full source profile.

## Production provenance and paid reuse

PM supplied read-only redacted runtime exports; QA independently validated their consistency against the actual checkpoint and files. Initial, Instagram video override, and recommended-slides restore snapshots all show requested=attached=generation IDs, attached source/media match, ready status,0pending consumers and no active leases. TT/YT share the same actual video/narration. Instagram override attaches that existing video; restore returns to its original5slide generation. Call records remain unchanged across both switches, with exactly1successful fresh ElevenLabs `eleven_v4` narration call.

Safe narration proof matches the checkpoint narration ID and independently recomputed reviewed-script hash; it reports the actual narration cache key matches Brian, `eleven_v4`, speed0.78 and that reviewed script. No additional paid call, source rewrite, production mutation or user-browser action was performed by QA.

PM separately observed normal production browser video readyState4/106.958333s/1080×1920, shared TT/YT URL,5-slide Instagram preview, successful format override and restore, and both web/worker source/runtime confirmation. These are PM browser/deployment observations, not independently operated QA browser claims. Notes downloads were not captured by browser automation and remain **unverified**; no download success is claimed here. Known stale ready-frame progress2544/2567 is cosmetic; actual file/probe has2567frames and is complete.

## Exact artifact fingerprint

Six-media-file aggregate SHA256 (sorted filename + NUL + bytes + NUL):
`9632a18816c0bf95d661b25d001c6917bc59bf104b1e686e7089a8a6fa6f442d`.

| File | Bytes | SHA256 |
| --- | ---: | --- |
| slide-01.jpg | 109,147 | `3645e4f4839544ce44e57a31f3a086a3cb5fb9b640812dc9e16482e42612d7aa` |
| slide-02.jpg | 132,459 | `e153216013ad6fef139904a8370ee8b672b28345b5e4d8ac4faf12a7eee45c07` |
| slide-03.jpg | 130,217 | `a21c243fdf2d3595b39816ea7cb9505c32492f5d11d2c05ba160dab827a4e4cc` |
| slide-04.jpg | 119,551 | `574fc36d5555ff6582726e246910f6e8bc8fc6afac0d56359095fa76c5531160` |
| slide-05.jpg | 126,005 | `42087df45988ea0de5d93b2a65bcb204ae2ff100290e99b73e91dac990d6291c` |
| video.mp4 | 6,734,798 | `68b20512a7a074dd65623780634f2570c83a68ff3867c889191834ef748b63c7` |

Private evidence is retained under `/tmp/radar-live-acceptance/`: `probe.json`, empty-error `decode.log`, `loudness.log`, `silence.log`, `qa-artifact-metrics.json`, `qa-slide-comparison.json`, `qa-provenance-results.json`, `qa-fingerprint.json`, `narration-proof.json` and actual extracted `frames/`. Nothing from the checkpoint, script, source, URLs or rendered private media is copied into repository evidence.

Representative actual frames: `frames/0016-scene-0-first-drawing.png`, `0098-scene-0-partial.png`, `0541-handoff-1-after.png`, `1767-scene-3-complete.png`, `2384-scene-4-complete.png`, `2565-final-hold.png`.

Executed local commands included:

```sh
ffprobe -v error -show_streams -show_format -of json /tmp/radar-live-acceptance/video.mp4
ffmpeg -hide_banner -v error -i /tmp/radar-live-acceptance/video.mp4 -f null -
ffmpeg -hide_banner -i /tmp/radar-live-acceptance/video.mp4 -af ebur128=peak=true -vn -f null -
ffmpeg -hide_banner -i /tmp/radar-live-acceptance/video.mp4 -af silencedetect=noise=-45dB:d=0.5 -vn -f null -
node --import tsx /tmp/radar-live-acceptance/qa-audit.mjs
node --import tsx /tmp/radar-live-acceptance/qa-slides.mjs
python3 /tmp/radar-live-acceptance/qa-provenance.py
```

Applied [create-explainer-video review guidance](/Users/ekene/.codex/skills/create-explainer-video/SKILL.md). QA changed this record only, retained private artifacts outside the repository, launched no server, and made no provider/paid/deployment/posting request. Passing sampled visuals and full decode does not establish every possible delivery or pronunciation property.
