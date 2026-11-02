# Publishing redirect hardening — E2

3 November 2026. Bounded follow-up from the architecture audit, owned files: `src/server/services/publishing/http.ts`, new `http.test.ts`, and `connectors.test.ts`. Shared checkout/base and unrelated edits preserved. No deployment, external publishing, migrations or changes to connector policy.

## Defect and fix

GET/HEAD used native redirect-follow after validating only the initial DNS lookup. A public CMS endpoint could redirect to a private destination that fetch contacted before any guard ran. Supplying `redirect: 'follow'` also bypassed the existing safe-write branch. Six private/prohibited redirect regressions failed against the old code (ignored `.data/production-launch-publishing-before.log`).

All connector requests now use manual transport redirects and validate every target before the next request. GET/HEAD allow five hops; existing writes preserve their method, body and credentials only for same-origin 307/308 and retain the prior three-hop limit. Explicit manual/error modes never follow, and explicit follow cannot bypass validation. Every URL must be HTTP(S) and contain no URL credentials. Cross-origin reads remove Authorization, Proxy-Authorization, Cookie and Host, matching the installed Undici fetch behavior; these headers stay removed if the chain returns to the original host. Header snapshots remain records to preserve existing connector/test contracts. Redirect response bodies are canceled before following.

Production strict mode also uses the PM-owned `assertPublicUrl` and `publicDispatcher` in `src/server/http/publicNetwork.ts`; the latter validates the DNS result used by the connection itself. This closes the separate-check/connection DNS rebinding gap for this transport. Literal private/reserved IPs are rejected before fetch. Existing nonproduction and explicit private-host override modes retain local/self-hosted reachability; protocol and URL-credential restrictions still apply. Other transports, infrastructure egress controls and deliberately enabled private-host override behavior are outside E2's proof.

## Checks

- New HTTP boundary suite: **13 passed**, including loopback/link-local/IPv6-mapped redirects, prohibited schemes/URL credentials, DNS recheck, relative GET/HEAD redirects, strict dispatcher presence, cross-origin credential removal, loops, explicit redirect modes, write semantics and override compatibility.
- Related connector regression: redirected WordPress refresh lookup resolves the existing post; no duplicate post creation. Local HTTP connector suite: **27 passed**.
- `npm test -- src/server/services/publishing src/server/actions/publishing.test.ts` → **242 passed, 51 skipped**, 13 passing files / 9 skipped files. Skips require external connector harness/platform configuration and are not counted as verified. Ignored log: `.data/production-launch-publishing-tests.log`.
- Broader connector tests initially exposed header-representation compatibility. Source now materializes headers as records per hop; tests/expectations were preserved. All affected tests above pass afterward.
- Exact final `npm run typecheck` and `git diff --check` → passed. Independent verification remains Q1-owned; PM must rebuild after integrating this follow-up and the shared public-network helper.
