# Signup security release architecture and read-only audit

4 November 2026 (Asia/Dubai). User explicitly authorized merging PR26, deployment with safe migration, and live signup/email verification. PM owns every merge, deployment/removal, backup, credential revocation and live test mutation. Architect owns this read-only audit and record only.

## Release candidate and actual production baseline

Final worktree: `/Users/ekene/.codex/worktrees/signup-security/radar-push`, branch `kenny/signup-security-hardening`, candidate `f322e5972a01c8b1cb744d4462ebba8ed3ed34e7`. PR26 targets main, initially draft, mergeable/CLEAN, no CI checks configured. Remote main and both actual running containers are `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49`; no unrelated main source intervened at baseline.

Reverified Railway project `radar` / `863ea66d-04b9-40e8-b27f-89a4f75c026e`, production environment `168aae6e-c038-4198-910a-e388afaac157`:

| Service | Service ID | Old active deployment | Observed status |
|---|---|---|---|
| web | `0c4df5c5-938d-421e-a16a-1c0781ac5118` | `8a979ad1-0ead-4ce1-b10f-dc1e3da82b52` | SUCCESS |
| worker | `711ee076-4ac6-48f4-8721-91757f22cf7f` | `73105fc8-3065-4866-9dac-73e22a56fff8` | SUCCESS |
| Postgres | `00a7f660-385f-4d6b-b425-d8fac4ac0f0a` | unchanged | identified through project inventory |

Both app services track GitHub `kenny-io/radar` branch `main`, one replica in the same region. Web has pre-deploy `npm run db:migrate`, readiness `/api/health`, restart ON_FAILURE/max10. Worker has no pre-deploy, `npm run worker`, restart ALWAYS. Their current manifest overlap/draining overrides are unset. Running web reports production mode, signup Turnstile off, real Resend/sender configured, billing on. Only safe booleans/source/deployment identity were printed; no credentials.

Read-only repeatable-read transaction against actual running web's database at `2026-11-04T16:37:51.061Z` (20:37:51 Dubai):

| Aggregate | Baseline |
|---|---:|
| Users / non-guest | 5 / 5 |
| Google-only / password-only / mixed | 5 / 0 / 0 |
| Businesses / memberships / billing accounts | 6 / 6 / 2 |
| Non-guest sessions / guest sessions | 6 / 0 |
| Migrations applied | 9 (0000–0008) |
| Queued / running jobs | 0 / 0 |
| `email_verified_at` column | absent |

Private ignored0600 snapshot `.data/signup-security/release/baseline.json`, SHA-256 `c2d482f2811eff94c3bdd2b8dff60a225e07be79c4272ab041b799154a83d483`. It stores cohort IDs and user stable-field hashes excluding the expected password/verification changes, whole-row hashes for every business/member/billing row, original session IDs, migration hashes and safe runtime flags. It contains no raw passwords or external credentials. No cohort IDs/emails are printed in tracked evidence. This is a focused audit snapshot, not a complete backup; PM owns the separately authorized full private pg_dump.

## Safest migration sequence

Railway normally leaves the old deployment serving traffic until the new one is active, then removes it with overlap. A web pre-deploy command alone therefore cannot ensure the old auth code stops issuing sessions while 0009 resets credentials. Changing overlap seconds alone does not close the pre-deploy interval.

Use the explicitly authorized short web maintenance window:

1. Finish/review full private database backup and verify archive usability; retain focused cohort snapshot above. Verify current main still equals the intended candidate base and no other deployment is pending.
2. PM removes/stops the exact old web deployment, keeping worker and Postgres running. Wait for that deployment to be REMOVED and confirm public auth endpoints no longer serve the old app; one-replica inventory must show no other active old web instance. Do not merely observe that a removal command was accepted.
3. Only after old web removal is proven, merge the reviewed PR26 candidate. Both main deployments start automatically. Web pre-deploy applies 0009 while no old web can authenticate. Migration marks prior Google accounts verified, clears unsafe mixed passwords, and revokes all non-guest sessions. Worker preserves normal business jobs; the new token-pruning maintenance query only runs at UTC minute07, and no user jobs were queued/running at baseline.
4. Wait for the new web healthcheck and both deployments SUCCESS. Inspect actual new containers for expected merge source, NODE_ENV=production, development stubs false, signup Turnstile false, existing mail/sender and billing configuration intact. Wait for every old web instance to remain REMOVED before declaring migration complete.
5. Architect performs post-migration cohort audit BEFORE any live test account is created. Expected: same five user identities/stable fields, all five verified Google-only, no retained legacy password; all six original non-guest sessions gone; all six businesses/memberships and both billing rows byte-equivalent by hash; migration count10 and exact 0009 hash present; no pending verification rows introduced by migration.
6. PM/QA then perform the specifically authorized live signup/email/confirmation tests and ordinary public smoke, keeping their new synthetic-account effects distinguishable from the preserved baseline cohort. Record actual inbox receipt separately from provider acceptance/local stubs. Do not charge cards or change subscriptions.

If old deployment removal cannot be proven, pause before merge/migration; the alternative is an explicit guarded final revocation of all non-guest sessions AFTER proving every old web instance exited and before announcing completion. The stop-before-merge sequence is preferred because it closes the vulnerable interval rather than cleaning up sessions afterward. PM owns any such revocation; architect performs read-only checks only.

Source migration file SHA-256: `8d86dadf2209699bbd4c6e3a67d2b5ea2c766c36e13bf308e18066de2ea1ed5b` (`drizzle/0009_signup_security.sql`). Drizzle's stored migration hash must match this exact SQL file. Credential revocations are intentionally irreversible; never restore old passwords or sessions from backup, and never roll back to the vulnerable old auth binary. If the new revision cannot start, keep web in maintenance and forward-fix; worker/DB data stays intact.

## Post-deployment audit — passed before live signup

Independent read-only repeatable-read transaction at `2026-11-04T16:43:48.127Z` (20:43:48 Dubai), through actual new web deployment `d6cf14cb-f1bb-49a5-8fe0-0d4c23dcb075`, source `582e0eb74522881d9f772c8add6fab6f0bacbfa3`:

| Invariant | Result |
|---|---|
| Original user identities and stable fields | all 5 preserved; 0 new users |
| Historical Google identity migration | all 5 verified Google-only; 0 password credentials |
| Original 6 non-guest sessions | all revoked; 0 current non-guest sessions |
| Original businesses | all 6 full-row hashes identical; 0 added/missing |
| Original memberships | all 6 full-row hashes identical; 0 added/missing |
| Original billing accounts | both full-row hashes identical; 0 added/missing |
| Migration history | 10 rows; all 9 prior hashes preserved; exact 0009 SQL hash matches |
| Verification tokens created by migration | 0 |
| Job aggregates | unchanged: 370 done, 9 failed, 0 queued/running |
| Actual runtime | production; development stubs false; signup Turnstile false; Resend/sender present; billing on |

Private ignored0600 post snapshot `.data/signup-security/release/post.json`, SHA-256 `7600951370d2aca9031059e43aefe04ff815b49f45e676e538094a7b123793f8`. Comparator `.data/signup-security/release/compare-audit.py` checked the original cohort and returned all preservation/policy/migration invariants true. No user IDs, addresses, raw credentials or bearer tokens were printed.

This audit ran BEFORE PM created any authorized live test account. The old-web removal plus zero remaining original sessions proves the intended safe revocation sequence; an additional blanket session revocation is unnecessary and would invalidate subsequent legitimate sessions. Actual mailbox delivery/confirmation and public browser acceptance belong to PM/independent QA evidence and are separate from this database audit. Architect performed no signup, payment, publication, schema change or credential mutation.

## Platform evidence

- Railway [deployment lifecycle and remove semantics](https://docs.railway.com/deployments/reference#singleton-deploys): old deployment stays until new deployment is online; overlap and draining affect teardown.
- Railway [pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command): migrations execute before application start, not as a guarantee old containers already stopped.
- Railway [down](https://docs.railway.com/cli/down): removes the most recent successful deployment without deleting the service; PM must match the exact audited old deployment and verify removal.

No remote mutation was performed by the architect in this pass. All listed deploy/merge/backup/removal steps are instructions to the authorized PM, not claims of execution.


## Concurrent main deployment handled during maintenance

PM subsequently reported completion of a valid base64-transported private pg_dump (7,054,780 decoded bytes, 161 pg_restore TOC entries); an earlier SSH binary transport attempt was rejected as corrupt and was not used. PM separately proved the original web deployment REMOVED and public old auth unavailable before merge.

Another chat merged support changes as `a73e2400931dd4e6ee8ff705892ef9e688bba260` during maintenance, triggering an additional pre-auth-fix web build. PR26 then merged as `582e0eb74522881d9f772c8add6fab6f0bacbfa3`, retaining those support changes. PM canceled only the outdated web build through `deploymentCancel(id:String!)`; no feature/source was rolled back. Architect independently verified the live API exposes `deploymentCancel`, `deploymentStop` and `deploymentRemove` with String! ID contracts. [Primary API documentation](https://docs.railway.com/integrations/api/manage-deployments) distinguishes canceling queued/building deployments from stopping running deployments.

Independent read-only live GraphQL readback after PM cancellation:

| Deployment | Source | Status |
|---|---|---|
| Outdated web `1f1671d3-bd6a-43bc-b9fa-04f0d755a242` | a73e2400 | REMOVED |
| Outdated worker `3f99bbc7-6832-4def-8b87-9723f21595d0` | a73e2400 | REMOVED |
| Target web `d6cf14cb-f1bb-49a5-8fe0-0d4c23dcb075` | 582e0eb7 | BUILDING |
| Target worker `685c8e06-0620-4576-8d77-690b5f7387c6` | 582e0eb7 | SUCCESS |

No live signup had been performed at this point. Old pre-auth-fix web build is removed; await target web readiness before post-migration cohort comparison. Main autodeploy concurrency is a concrete release risk: inspect every pending/active web deployment after other main changes, not only the original old instance. PM owns cancellation/removal; architect made no remote mutation.

## Final independent deployment readback

Following the successful cohort audit, Railway deployment listings independently confirm target web `d6cf14cb-f1bb-49a5-8fe0-0d4c23dcb075` and target worker `685c8e06-0620-4576-8d77-690b5f7387c6` are both SUCCESS on merge `582e0eb74522881d9f772c8add6fab6f0bacbfa3`. The original f9eb web/worker and concurrent a73e web/worker are all REMOVED. The listed five most recent web deployments contain no other building/queued/active old-auth revision. This supersedes the earlier BUILDING observation in the concurrent-deployment table.


## Final post-cleanup read-only audit — passed

PM reported exact synthetic-account cleanup at `2026-11-04T16:51:55Z`, following successful actual Gmail inbox receipt and live confirmation/authentication/replay/quota checks. Those browser/mail operations and cleanup were performed by PM/QA, not the architect. Architect then independently reran the cohort audit at `2026-11-04T16:52:20.284Z` (20:52:20 Dubai):

- Exactly the original five user identities remain, with unchanged stable-field hashes; all five are verified Google-only identities with no password credentials. No synthetic user remains.
- All six original businesses, all six memberships and both billing-account rows match their baseline full-row hashes exactly; no added/missing row in those tables.
- Every one of the six original non-guest sessions is absent. One newly issued session exists and belongs to the preserved original user cohort; legitimate new sessions are intentionally allowed and were not revoked by this read-only audit.
- No confirmation tokens remain. Migration history still contains ten rows, all nine prior hashes unchanged and 0009 matching exact expected SQL hash. Completed/failed job aggregates remain 370/9, with none queued/running.
- Actual web is production with development stubs false, signup Turnstile false, existing sender/Resend configured and billing on. No schema, credentials, financial state or app data was mutated by the architect.

Private ignored0600 final snapshot `.data/signup-security/release/final.json`, SHA-256 `3472ed43f5f3d65d00e1d9bf0072f7f45f6d209914fee41f3454dce4819876e1`. Original-cohort policy/preservation/migration comparisons all passed. No raw account IDs, addresses or secrets were printed.

### Final running-source reconciliation

During the authorized live verification/cleanup interval, another chat's support-timeout PR28 advanced main to `085f1d88a83868b61c8cb0665dabea87f82180d3`. Both services independently read back SUCCESS on that source: web deployment `d06b23b4-ada3-4020-9120-edb23fe8b9d0`, worker deployment `2bad20bb-4a57-4495-9a9c-afecf7c7160a`; worker SSH additionally confirms actual commit/production mode. The original `582e0eb7` deployments are now REMOVED.

Independent GitHub compare `582e0eb7...085f1d88` reports only the support API route, support-answer implementation/test and support documentation/release record changed. All signup/authentication/session/verification/migration and affected UI source is unchanged from the reviewed/deployed signup release. The final preservation audit above therefore ran against the current production revision with unchanged security implementation, rather than assuming production still ran `582e0eb7`. No extra migration or credential restoration occurred. PM should report the current running source accurately; no rollback of the independent support change is warranted.
