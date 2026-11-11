# Independent QA defects

## EDU05-D1 — Lapsed/pretrial account cannot open authenticated email controls

Criterion EDU-05; severity P1 (release-blocking preference control for the expanded audience). Tested HEAD bed41631544a7a484d132ca75679bbee146eae44 plus integrated in-progress weekly runtime (exact final fingerprint will follow), Node22 local Next3939, isolated database radar_education_qa_20261109, ordinary verified synthetic owner.

Reproduce: sign in as comp owner, open Settings → Emails and save weekly preference. Change the synthetic local billing fixture to comp=false/status=canceled with prior subscription ID; navigate /settings?section=emails. Expected: authenticated account email choices remain visible and editable across access states. Actual: AppLayout redirects to /start-trial; there is no email checkbox. Dedicated authenticated preference GET/PATCH still return200 and save successfully; anonymous signed optout works. No business/billing access bypass is required to manage account-level optional email.

Evidence: edu05-d1-original-results.json (23preceding browser checks pass, final visible-control check fails); edu05-d1-original.png; browser.ts reproducer. Sent to PM and runtime engineer. Proposed account-level authenticated preference entry outside gated app; implementation decision belongs to PM/engineer.

Status: CLOSED. Engineer added authenticated no-token /email-preferences outside gated AppLayout, retaining signed scoped optout. Independent dev34/34 and configured optimized production35/35 browser retests pass, including lapsed and no-business pretrial visible controls, keyboard save and refresh. Final source fingerprint is in source-fingerprint.json. Original failing screenshots/results remain preserved.

## EDU01-D1 — Organic lesson empty-keyword fallback missing a space

Criterion EDU-01; severity P3. Empty keyword rendered “review one proposed topicthat matches what you sell.” Independently observed HTML/plaintext via content-boundaries.test.ts and content-checks.log; PM fixed fallback leading space. Subsequent independent content tests pass. CLOSED.

## EDU04-D2 — Optional education preempts ordinary transactional mail

Criterion EDU-04/architecture essential-mail priority; severity P2 (queue delay under batch pressure, no observed loss). Tested final-source candidate bed41631+weekly changes, dispatcher with a single-item batch.

Reproduce: queue an invoice_paid acknowledgment and due weekly lesson for one verified comp fixture, then dispatch limit1 with a fake provider. Expected: transactional invoice is processed before optional education. Actual: invoice remainsqueued because CASE assigned weekly=2 and default transactional=3. Urgent billing/recovery remained higher; ordinary welcome, receipt and trial-start messages were affected. Independent reproducer is state-machine.test.ts; original failure in edu04-d2-original.log (27other checks passed).

PM approved aligning the dispatcher CASE with the existing architecture. QA added limit1 invoice_paid and welcome regression cases. Status: CLOSED. Integrated CASE default=2/education=3/founder=4/work=5 preserves transactional priority and education anti-starvation. Independent29/29suite passes, including parameterized invoice_paid and welcome limit1 checks. UI source is unaffected; prior production browser evidence remains valid for unchanged UI.

## EDU06-D3 — Global header overrides lesson landing no-referrer

Criterion EDU-06/design privacy headers; severity P3. Real final-build HTTP probe on czUdLkPfcM7IJjQMcg_y1 observed /email/learn response Referrer-Policy: strict-origin-when-cross-origin although the route handler intended no-referrer. Next global header policy overrode the handler. No bearer token occurs on this landing URL; cross-site requests still sent only origin, so no observed credential disclosure. Signed email-preferences already had the intended policy.

Original evidence: edu06-d3-original-smoke.json. PM added explicit email/learn and email/open entries to the existing private no-referrer/no-store/noindex header list. Status: CLOSED. Final build6vbkp5nthyiRYjJX4tgtZ actual HTTP probes return no-referrer/no-store/noindex for both lesson and work redirect routes. Six final smoke checks pass in final-build-smoke.json; no UI implementation changed.
