# Independent QA plan

Exact initial integrated baseline: bed41631544a7a484d132ca75679bbee146eae44, kenny/weekly-education, /Users/ekene/.codex/worktrees/radar-weekly-education/radar-push. Final source fingerprint will supersede the initial baseline once implementation is frozen.

Environment: Node22.18.0 from ~/.nvm; Postgres15 freshly initialized under /tmp/radar-education-qa-pg, bound127.0.0.1:54329; isolated database radar_education_qa_20261109. No worker. No live providers. Browser fixture uses synthetic ordinary verified password users, comp access when testing workspace, no administrator bypass. Test account is ephemeral and cleaned by Fixtures. Local web URL planned http://127.0.0.1:3939.

Read requirements: weekly-education/brief.md, architecture.md, lifecycle-emails engagement brief/architecture and prior QA reports (prior results are not new evidence). QA owns only this directory and independent harness files.

| Criterion | Intended checks |
| --- | --- |
| EDU-01 | Five ordered lessons, exact two actions + progress in HTML/text across four access states, fallback/header/HTML escaping; factual product UI/source inspection;20previews mobile/desktop |
| EDU-02 | Existing/new verified users across no-business/pretrial/trial/paid/comp/lapsed; guests/unverified/historical optional optout excluded; member-only generic/no tenant personalization; deterministic multi-business and missing-profile context |
| EDU-03 | Concurrent collectors/dispatchers; no send before daytime;5actual accepted lessons>=7days apart; delayed collection/acceptance avoids bursts; completion/off-on never resets; simulated/logged never advances |
| EDU-04 | Retry immutable body/key after profile change; ambiguous failure/max attempts/expiry blocks; recipient/email verification/context loss; malformed and unavailable suppression lookup fail closed; shared founder/work cap includes ambiguous initial attempts; request pacing |
| EDU-05 | Keyboard preference save/refresh/read/write failure; no-access settings; signed anonymous GET safe + explicit form POST + RFC8058 oneclick; invalid/other-purpose token refused; category independence; unauth/cross-origin/foreign identity rejected |
| EDU-06 | Empty and main-like schema migration; startup readiness; source fingerprint; real-browser signin CTA roundtrip and authorized business switch, foreign/deleted business no selection; AI tab opens; no generation/approval/payment effects from link |
| EDU-07 | Reviewable local copy/gallery and evidence; no production/provider writes, merge/deploy |

Not applicable: actual inbox placement and SMTP acceptance cannot be established with mocked provider. Production release credentials/permission verification remains release review work outside local QA.
