# Q7G independent storyboard registry acceptance

Base490ca8350cf8637715b37c77dd68fb226021dd15, branch kenny/media-storyboard-registry. Own QA records/harness only. Final tests wait for integrated freeze. Dedicated synthetic DB radar_media_storyboard_registry_qa, local app3855 in isolated snapshot. No production/provider calls or user browser.

Registry compiler must preserve semantic identity and strict Plan validation: one global definition per ID, reject duplicates, unknown refs and node overrides; expand per-scene state/chart/source data without altering cues/edges/revisits/claims. Distinct process labels Reproduce vs Add title or nav link remain distinct entities, never silently collapsed or IDs renamed. Expanded Plan still rejects unsupported charts, wrong cues and unchanged diagrams.

Recovery v2 bounded private raw draft saves before compile. Valid v1 plan resumes without another planning request; invalid v1 candidate gets at most one correction producing registry, sharing existing allowance and both reviews. Interrupted dispatch never automatically repeats. Persist corrected draft before compile even if invalid. Source/cap changes clear authority; real paid reservation and guard/deadline remain. No draft exposed via public state/notes/tenant routes or narration before acceptance. Rubric permits same-scene introduction then revisit and neutral plain definitions, rejects unsupported guarantees and reviewer evidence injection.

Actual browser Generate/Retry persisted stages and refresh, no file upload. Final source fingerprint, focused tests only; no unrelated suite/provider quality claim. Stop own local server and leave root config unchanged.
