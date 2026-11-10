# Generic refresh integration for structured editorial pages

## Evidence and diagnosis

Read-only destination inspection: `/tmp/radar-destination-qa.j9TSIt`, commit `dbfb0f0b66b1a607bd3f0b2587a84064464c52b3`. Production retry reached source planning after the URL fix and returned an empty plan because its existing target was a structured landing page rather than a blog post. No accepted plan or destination write was produced.

Radar's `nextjs-agent.ts` SYSTEM, discovery, planning and review prompts repeatedly require a public *blog* listing and reuse of existing renderer syntax. They do not explicitly permit an additive content representation and its paired renderer when refreshing an existing non-blog editorial page. The host validator is already capable of this: exact edits to content types/registries/renderers are allowed; `articlePath` may be an existing shared content source; `{{RADAR_HTML_JSON}}` expands to a valid JSON-escaped JavaScript/TypeScript string. Syntax, SHA, path, body-token, route, edit-size, protected-file and independent-review guards do not need weakening.

Observed destination evidence:

- `apps/web/app/rent/dubai/hubs.ts:17–40` defines the Hub type; the target is the existing record with slug `1-bedroom-apartments`. Its plain `sections[].body` cannot render a full HTML body.
- `apps/web/app/rent/dubai/[slug]/page.tsx` uses `getHub(slug)`, derives static params from HUBS, and renders plain escaped editorial sections around lines 245–271. Header, area explorer/table, FAQ and related navigation are separate existing functions.
- `apps/web/app/rent/dubai/page.tsx` derives directory links and ItemList JSON-LD from HUBS. Sitemap and footer already link the target. Blog registry work would create an unrelated route/duplicate registration.
- Source sizes fit current read budgets: registry 45,218 bytes, renderer 14,327 bytes, directory 8,579 bytes.

## Approved generic contract

For `mode=refresh`, the source-grounded target may be any existing editorial page. Preserve its original route and source identity and prove its actual public discovery chain; an existing directory/navigation chain satisfies the `listing` evidence role. It need not become a blog post. New posts retain the existing blog integration requirement.

When the observed representation cannot carry the complete supplied body, the planner may propose a minimal **paired, additive** content schema/type extension and renderer extension. The extension must be optional per record, explicitly selected only by the target's stored body, and use exact inspected source conventions. Existing behavior remains the fallback when the optional body is absent. Content representation changes are distinct from forbidden dependency, deployment, authentication, credential or infrastructure changes.

One valid source-grounded pattern is an optional HTML body string on the existing content type, the complete `{{RADAR_HTML_JSON}}` token in only the matching existing record, and a conditional rich-body renderer at the existing editorial-body location, with the old editorial sections as the fallback. Field names and paths are inferred from each repository, never hardcoded by Radar. An equivalent safe observed renderer is acceptable; do not add dependencies or invent an unsupported Markdown renderer.

Requirements:

1. Retain original route, slug, required fields, existing attribution/publication metadata and all unrelated records. Do not move the refresh into another content family or register a second visible page.
2. Preserve existing structured features and their consumers, including navigation, listings, static params, forms/CTAs, area data, FAQs and related links. Replace or supplement only the intended editorial-body slot; do not erase unrelated functionality.
3. Render the complete host-supplied body once as actual rich content. Do not store HTML in a plain escaped text field, hide it, duplicate it alongside the replaced old editorial body, or regenerate/shorten it to fit an old schema. Full exact HTML from Radar's existing `blocksToHtml` uses escaped block text, guarded citation/image URLs and host-owned media markup. A raw-HTML rendering sink must consume only that static authored field, never request/query text or executable model code.
4. Pair every optional type/schema field with its actual rendered consumer. The independent reviewer must inspect original and final type, target record, renderer and discovery chain; reject schema-only edits, missing imports, unsupported consumers, invalid fallback behavior, deletion of sibling content, and demonstrated contradictory duplication.
5. Keep every current deterministic guard, exact original-source edits, byte/read/reasoning budgets, tenant binding, atomic Git commit, one correction limit and fresh independent review. A whole shared registry rewrite remains forbidden by review; small exact insertion is sufficient here. No model instruction can waive a failed guard.
6. Unsupported targets still fail before mutation with an actionable reason. Static review is not a build/runtime claim; open a draft PR with pending destination checks.

## Implementation and validation order

1. Update generic SYSTEM/discovery/plan/repair/review instructions consistently: refresh targets use their real editorial schema and discovery chain; permit bounded optional content-and-renderer extensions with preservation requirements. Keep proposal/transport schemas and validators unchanged.
2. Add a non-destination-specific fixture for a typed shared registry and dynamic landing-page renderer with no existing rich body. Assert exact body insertion, matching route, directory proof, untouched sibling records and fallback rendering. Include rejection cases for an escaped plain-text body, missing consumer, unrelated registry deletion, route changes and protected edits.
3. Run existing planner/connector/payload regressions and typecheck. Independent QA should derive checks from the contract, verify exact supplied body appears once, and compare unrelated page output before/after.
4. Exercise an actual configured-model plan against the pinned destination without Git writes; build/typecheck and browser-check the exact generated files in the disposable destination clone. Retain real source evidence and honest build/environment limitations.
5. Review the source diff, complete the authorized release, and retry the persisted failure only after deployed web/worker revision readback. Preserve entry mode, route, body and existing remote-draft recovery semantics. Verify the resulting PR diff, source review and destination checks; draft PR creation is not live-site publication.

## Decision and limits

This is a routine generic integration correction within the existing authorization to refresh the selected page and modify source to publish it. No owner decision is needed to retain the same page and add a backward-compatible optional content representation. There is no schema migration, new service, destination-specific adapter or manual destination workaround. A proposal requiring new dependencies, a route change, loss of existing page functionality, security/infrastructure edits, or a materially different page purpose must fail or return to the PM rather than broaden scope silently.

Architecture approval here covers the contract. Implementation review, independent QA, configured-model behavior, destination build/runtime evidence and release verification remain outstanding at this record's creation.

## Frozen implementation review

Architect read-only approval: `nextjs-agent.ts` SHA-256 `9b04bb27a91cb8cd2528fbf3fbe8af25e425a87ec3787772d4b78e0fb64fb7de`. The source diff adds one shared editorial-refresh instruction block and reconciles discovery, planning, repair, independent-review and follow-up discovery wording. Proposal/transport schemas, body tokens, route identity validation, protected paths, source/edit provenance, syntax validation, bounded budgets, one-correction behavior and independent-review acceptance checks are unchanged. No destination-specific branches or names were introduced.

Reviewed `nextjs-structured-refresh.test.ts`: a generic typed shared registry receives the optional body field through the existing host token; its paired conditional renderer replaces only the intended editorial slot. SSR assertions verify exact body once, unchanged peer HTML, original publication metadata, widgets, FAQ, directory and route lists. Negative cases explicitly exercise reviewer rejection of escaped HTML, missing consumer, peer deletion and duplicate old editorial content, plus deterministic route/protected-path rejections. These are authored fixtures with mocked model responses: they verify host integration and review handling, not actual provider semantic judgment or destination compatibility.

No material architecture issue remains at the reviewed fingerprint. Engineer/PM report focused and broad regressions passing; independent QA, the real-provider pinned-destination preflight, destination build/browser checks and verified release/retry remain required before claiming the production issue resolved. No source code was edited during this review.

## User-requested publication failure reporting

The user requests generic publication failure copy and an explicit Report issue to team action. A user click authorizes one report to `kenny@thally.io`, subject exactly `User Reported Issue on Radar`. This is separate from existing automatic operational failure alerts; merely viewing a failed article must not send this report. No additional confirmation is required.

### UI and public diagnostics

- Article failure copy: `Radar is unable to publish this post`. The draft remains saved. Keep Retry available to roles already allowed to publish; add Report issue to team for signed-in workspace members.
- Reporting states: idle, sending (disabled button), confirmed (`Issue reported`), and failed (clear generic retry message). Confirmed means the provider accepted the email and the outbox is marked sent. Queued/logged/stubbed/unconfirmed transport cannot count as confirmed. Preserve the same server incident identity on retry; repeated clicks must not create new reports.
- Dashboard publication alerts use the same generic copy and open the article for reporting/retry. Do not show raw planner/connector hints, repository/source paths, HTTP details or diagnostics in these surfaces.
- Hide diagnostics at the serialization boundary as well as JSX: `workspace.entryFromRow` currently passes the entire stored publishError; `actions/core.ts` job.get currently exposes publish.entry result.error; workspace job errors may also carry technical text. Public calendar and publication-job output must contain generic failure information only. Keep raw persisted server diagnostics for investigation and the explicit report. Other job types are outside this change.

### Action and authorization contract

Add `publish.reportIssue` with strict input containing only `{ entryId: string }` using existing ID bounds. Do not accept recipient, subject, contact, failure text, diagnostics, request payload or arbitrary client context. Existing authenticated action routing enforces workspace membership; minimum Viewer matches existing support access because reporting does not edit/publish an article. Guests and nonmembers cannot report. Existing publish/retry role requirements remain unchanged.

The service reads the raw calendar row scoped by both businessId and entryId and requires status=failed with a stored publishError. Return not-found for another tenant and a generic conflict if the article is no longer failed. Use the authenticated user and trusted business context; never trust public client copies of errors. Obtain a coherent short database snapshot of the failed entry and latest tenant-scoped publish.entry job, releasing any article lock before mail/network work.

### Report body and incident identity

Build a bounded plain-text report from explicit allowlisted server fields: article ID/title/mode/status, business ID/name/domain, authenticated contact ID/name/email, safe target/destination type/reference, attempt count, latest publication job ID and safe error/diagnostic fields. Include an internal reference and app article link if useful. Do not select or include article body, prompts, source files/excerpts, decrypted connection credentials, tokens, arbitrary connection fields, job payload/result blobs or browser state. Sanitize string values using the existing observability/publishing redaction functions, including query/fragment/credential-bearing URLs; bound individual fields and total mail size. Format contact identity as data, not user-controlled headers; reply-to may use only the validated authenticated email.

Compute a deterministic server incident ID from business ID, entry ID, latest publication job ID and the stored failure fingerprint/attempt count. Use a fallback fingerprint for legacy entries without a job. The job ID distinguishes a later genuinely new failed retry even when its error and attempt count match. Repeated clicks, reloads and workspace teammates share the same report for the current incident. Store the first report snapshot durably in the existing outbox and reuse its exact recipient/subject/text/sender payload for all retries, rather than rebuilding mutable contact/title/diagnostics and changing the provider payload. Return only `{ delivered, reference }`, never the private report text.

### Existing mail infrastructure and delivery guarantees

No migration or new provider is needed. Reuse `outboxEmails`, existing transactional-mail/support delivery code and Postgres advisory locking. The existing support mail service demonstrates the required concurrency/delivery pattern: commit the durable request, serialize delivery by deterministic reference, return existing sent status, use a stable Resend Idempotency-Key and require a valid acceptance response. A new bounded helper or compatible extraction may serve the report without changing existing support behavior.

The general `sendMail` helper returns void for both sent and logged rows and does not itself suppress real sends in dev stubs. Therefore a report caller using it must explicitly prevent external delivery in stubs, fail before transport when production mail is unconfigured, and verify actual sent status before returning confirmed success. Prefer preserving the support service's existing safeguards rather than equating helper completion with delivery. Persist sanitized generic delivery errors only; do not log report content or provider responses. Provider-ambiguous retries reuse exact stored payload/key; hold unresolved requests older than 23 hours rather than resend outside the provider's deduplication window. Already confirmed sent requests remain safe to acknowledge after that window.

Reuse existing support-mail rate limits for new send attempts: 5/user/hour, 10/user/day, 15/business/hour. Authenticate and establish tenant/entry eligibility before mail access. Existing confirmed duplicates can return success without consuming another new-send quota. Database locking and provider idempotency prevent concurrent duplicate emails. Local/stub capture must never call Resend, even when credentials are present.

### Required verification and approval

Acceptance tests must cover fixed recipient and exact subject, server-read context, no article body/secret leakage, cross-tenant denial, Viewer access without publish rights, guest denial, changed article status, duplicate/concurrent clicks, immutable retries, expired ambiguous delivery, missing credentials, stub no-send behavior and provider rejection without false success. Verify public calendar/job serialization excludes hints/diagnostics while DB diagnostics remain intact. Browser QA must exercise generic failed-state copy, reporting success/failure/loading/retry, reload/dedup behavior and narrow screens.

Architect approves this bounded action/service/UI contract without another owner decision. Independent source review and QA are required before release. After the authorized deployment, PM may perform one explicitly authorized production report and verify its outbox/provider acceptance with recipient/subject readback; this verification must not send extra test reports or claim inbox receipt without evidence. Existing publication recovery remains in scope alongside this UX addition.

### ENG-3 customer diagnostics path audit

Read-only audit of the initial implementation found the intended public boundaries covered: full/summary workspace calendar entries use `publicPublishError`; workspace jobs, core job.get and cached SSE workspaceEvents use `publicPublishingJob`; article.get returns Article data only and does not return its internal raw calendar row. SSE emits the mapped job snapshot. The persistent failed-jobs summary handles article.draft/calendar.generate only, not publish.entry; publishing success notifications contain no failure diagnostics. Existing automatic owner handoffs use generic publication copy. No additional customer publication-diagnostics path was found in this bounded review. The stored calendar publishError and job result remain available server-side.

Report snapshot uses a repeatable-read read-only transaction. Its failed-entry read establishes the same committed snapshot used for the latest publication-job read. Because publish.retry updates status and inserts its new job atomically, the report cannot mix an old failed row with the new retry's job ID. The prior failure can legitimately be reported if the retry commits after that snapshot. No mail/network work holds an article lock.

Initial outbox review confirms fixed recipient/subject, tenant-scoped article/job/destination reads, immutable first stored report text/sender on conflict, stable incident/provider key, serialized delivery and sent duplicates acknowledged without another send. Two concrete corrections were identified before freeze: reject invalid production configuration before inserting a new report (so an empty sender cannot be frozen), and remove query/fragment secrets from root-relative refresh URLs as well as absolute URLs. PM/QA separately identified empty/whitespace provider IDs as unconfirmed acceptance. Engineer owns these corrections and tests. Final implementation approval is pending their integrated review and independent QA; this initial audit is not release approval.

### ENG-3 implementation approval

Architect reviewed the corrected implementation read-only and approves its source design at these SHA-256 fingerprints:

- reportIssue.ts: `1fc03c3f1957b459969eb41a9f86f37a6a175aea981405dd15a9c010a9386b52`
- lib/publishingFailure.ts: `074e6f1ec66d441101e6a66e92d7a4a1805df2ffc76b91dc65d9ed2f28eb0b14`
- PublishFailure.tsx: `bd3d66081e1130288b066e593c14ad1b29f2bf8ae0d7f751139bd041121c8fb2`
- actions/publishing.ts: `3e914aa59c51de4f6971f76781f2e8e616193fdd2a5ada79ddb2f0e51735516f`
- workspace.ts: `5f2907d2aeb395b5495e1d38f82afbd175b6bbe66c41779ca75d0beae760358b`
- actions/core.ts: `36c3f912a72e4365c5f8664198c9bebaf9fbec5d1899e7b3130223b3dbb3dc80`
- events/workspace.ts: `a9bad2bd96c40e0012545cfdd94022394b2852674b1f4edda2a1a856e48840da`

The report action is a strict entryId-only Viewer write, so normal action membership/business gates and revision/activity bookkeeping apply; existing editor publication permissions are unchanged. Repeatable-read uses the actual Drizzle `accessMode: 'read only'` option. Snapshot and network transactions are separate. New incidents validate production sender/key before inserting; confirmed duplicates acknowledge even after configuration removal. Relative/absolute target queries/fragments and recognizable credentials are redacted. Transport acceptance now requires a nonempty trimmed provider ID. The first stored contact/sender/payload survives concurrent teammates, title edits, retries and sender configuration changes; stable outbox/provider references and advisory locking preserve deduplication. Failures remain unconfirmed and retry the immutable payload inside the bounded deduplication window.

Generic UI and publishing-only public projections match the approved contract. No destination adapter, planner guard or unrelated job behavior changed; planner remains at approved SHA `9b04bb27a91cb8cd2528fbf3fbe8af25e425a87ec3787772d4b78e0fb64fb7de`. Reviewed tests cover the reported corrections, transport/deduplication seams and public projection behavior, but test pass status, real DB concurrency/browser probes, production report acceptance and publication retry verification remain PM/QA-owned. No material architecture issue remains at the reviewed fingerprints; this is source approval, not a claim that release verification has completed.

Final delta review approves the two updated fingerprints above: the report's calendar SELECT now explicitly allowlists only its required metadata/error fields, excluding publishRemote and its source evidence; the public job-result mapper now accepts only known published/failed/retry/skipped outcomes rather than echoing arbitrary persisted result.status text. Tenant predicates, coherent incident snapshot, immutable delivery behavior and existing consumers remain intact. Other reviewed source fingerprints are unchanged. No additional architecture issue was introduced; final QA/release verification gates still apply.
