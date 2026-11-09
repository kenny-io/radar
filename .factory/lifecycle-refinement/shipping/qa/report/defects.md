# D1: Signed report preferences use global referrer policy

Severity P2. Acceptance: signed bearer preference pages must use no-referrer/no-store/noindex and must not leak signed URL context on navigation.

Tested source c14d39ec3acd6b837e5d69010af1704705f22049; optimized build iV9dUzBIiccfdYYwXpM-b; actual Chrome/local production http://localhost:3952.

Reproduce: open an actual report's signed /ai-email-preferences link, inspect the document response. Also reproducible without a token with `curl -sS -D - -o /dev/null http://localhost:3952/ai-email-preferences` (400 document has the same policy).

Expected Referrer-Policy:no-referrer. Actual Referrer-Policy:strict-origin-when-cross-origin. Cache-Control:no-store, X-Robots-Tag:noindex,nofollow and restrictive page CSP are present. The route supplies no-referrer, but next.config's global policy overrides it because the new route is missing from the sensitive-route list. Browser failed the privacy assertion after reaching the page; this is not a missing fixture or request-only observation. browser-results.json and initial-browser.log preserve evidence. Reported to PM and engineer; QA did not change implementation or weaken assertion.

Status: awaiting fix/rebuild/retest. Inspect API one-click policy too because it sets the same route header under the global override.

D1 closed on efa2c8c5 / optimized TjzZerUxRYPvhsoyumbnw: actual browser and header probes confirm no-referrer/no-store/noindex on both signed page and oneclick API. Added ordered Next matching regression passes independently10/10. Full browser then exposed D2 below.

# D2: Native signed opt-out rejects its same-origin form

Severity P2. Acceptance: an unauthenticated reader can use the signed confirmation form to disable only that business's report while bearer-link privacy is preserved.

Tested source efa2c8c5baa8ae5e23d2b9a882e65b9ed971239f, optimized TjzZerUxRYPvhsoyumbnw. Create an ordinary local owned business, open its actual valid signed /ai-email-preferences link in real Chrome, focus Turn off weekly AI reports and press Enter.

Expected success confirmation, HTTP303 and weekly report preference=false. Actual native POST403 displays “You don’t have permission to do that.” and preference stays true. Actual request Origin is literal null, Sec-Fetch-Site same-origin, content-type application/x-www-form-urlencoded. Chrome's no-referrer native navigation causes the null origin, which the generic assertAuthOrigin rejects. No mutation occurs, but the reader cannot unsubscribe through the normal page. native-form-diagnostic.json/.png and privacy-fixed-first-browser-results.json preserve real browser evidence; no token/recipient is logged.

Reported to PM and engineer. Keep no-referrer and hostile-origin rejection; a narrow signed native-form exception can use exact same-origin navigation metadata without weakening general authentication CSRF. Status: awaiting fix/rebuild/retest. QA did not change implementation or relax the failing browser assertion.

D2 CLOSED on272ed52db4b53c47b4980e25d19884a39839bec6, optimized R7jB76Uf9QoaQtlkN8XxE. Final full real-browser run22/22 passes, including anonymous keyboard form303 with persisted business-only opt-out and valid oneclick204. Native Chrome CDP extra-info captures exactly Origin:null, Sec-Fetch-Site:same-origin, Sec-Fetch-Mode:navigate, Sec-Fetch-Dest:document, successful303 and preference=false; native-form-cdp-retest.json excludes tokens/recipients. Independent strict origin metadata matrix and developer40 report cases pass. Shared authentication origin guard remains unchanged. Initial failure evidence is preserved, not overwritten or recast as a pass. No unresolved defect remains.
