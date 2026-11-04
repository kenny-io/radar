# Individual indexing requests

Requested: individually submit all six Radar feature pages, blog index and five posts; verify Bing sitemap processing.

## Bing

Authenticated Radar Sitemaps report now shows **Success**, 16 discovered URLs, zero errors and zero warnings, last crawled 11/2/2026. Processing is complete.

Submitted all 12 public URLs in one URL Submission batch. Persisted submitted-URLs table lists all 12 at Today 02:50; URLs submitted today 12 and daily remaining quota 88 (previously100). These are crawl/indexing requests, not confirmation of actual index inclusion.

## Google

Organic search feature accepted: “Indexing requested”, added to priority crawl queue. Remaining URLs in progress. No site code or settings changed.

## Follow-up progress

Google acknowledged priority-queue indexing requests for `/features/organic-search`, `/features/ai-visibility`, and `/features/backlinks`. A subsequent Daily Brief inspection stalled; browser pages then rendered blank, and the user changed the active browser during recovery. Requested a quiet browser window to continue. Do not count the remaining nine Google requests as submitted.

The user expanded scope to Thally.io, lived.ae and usepeekup.com. Public sitemap inventory (all HTTP200):

| Project | Canonical sitemap | URLs |
| --- | --- | --- |
| Thally | https://thally.io/sitemap.xml | 38 |
| Lived | https://www.lived.ae/sitemap.xml | 1,942 |
| Peekup | https://usepeekup.com/sitemap.xml | 27 |

No submissions to those three projects yet. Their public indexability audit is running with three workers and stops per site on 429/503. Full public-only results stored under ignored `.data/indexing/`. None of the three home pages currently exposes a Bing msvalidate.01 tag; existing Bing property/import access must be checked before choosing any verification changes. Do not duplicate Radar's ownership token onto other sites.

Browser recovered after owner confirmed availability. Radar's six feature URLs now each have Google priority-queue acknowledgments; blog index request in progress. Bing's existing verified Thally property shows imported sitemap Success with38 discovered URLs; all38 individual URL submissions accepted (daily total38, remaining62). Peekup imported sitemap already Success with27 discovered URLs;27 URL batch submitted, acceptance readback pending. Existing Bing access to all three projects was available without new verification code or access grants by this run.

Further verified: Radar Google priority queue accepted blog index, AI recommendations guide, new website guide (initial Google server connection error; successful live retest and accepted retry), and Reddit guide. Google total10 accepted; page-two guide request in progress. Google retest and direct public HTTP200 cleared the guide's transient connection failure; no production source/config change made.

Peekup Bing27 URL requests accepted (persisted table27, daily remaining73). Lived Bing XML sitemap imported Success with1.9K discovered. Lived first1,000 URLs submitted in two500-URL batches (initial1,000-URL batch was rejected client-side due500-per-batch cap and not submitted). Persisted history shows1,000 requests, remaining daily quota0, reset56 minutes away at the time of readback. Remaining942 URLs in `.data/indexing/lived-bing-remaining.txt` and already supplied via full successful sitemap.

Google Thally XML sitemap refresh acknowledged; table Success38, last submitted/read Nov3. Lived XML sitemap already Success1,942 (Nov2 last read), refresh in progress. A legacy `/sitemap` HTML page is also registered as a sitemap in Google and reports one error; it is separate from the successful `/sitemap.xml` and supplies zero URLs. No removal performed.

Radar Google accepted page-two guide, bringing total to11. Final `/blog/safe-backlinks-new-sites` request was explicitly blocked by Google “Quota Exceeded — exceeded your daily quota; try submitting again tomorrow.” It must not be counted as individually submitted. It remains in successful full sitemap. Owner was told and follow-up preference is pending for quota-blocked work.

Google Lived full sitemap resubmission acknowledged successfully. Peekup full sitemap resubmission in progress; prior report Success27. For the additional sites, complete sitemap resubmission is Google's documented bulk recrawl request method: https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl . These do not imply all pages are indexed.

Additional public-link inventory: Thally homepage links only one query-variant absent from root sitemap, plus its public docs subdomain. docs.thally.io sitemap HTTP200 contains247 URLs. Lived homepage links four additional HTTP200/self-canonical/index-follow public pages absent from XML: `/submit-property`, `/verification`, `/contact-us`, `/accessibility`; `/submit-review` timed out. Peekup `/download` is HTTP200/self-canonical/index-follow and absent from sitemap. Peekup login/AML/ABC pages are noindex and excluded. Download Google inspection reflected an old Oct19 app-store redirect; current-page indexing request in progress.

Lived broad crawl stopped after repeated timeouts; do not claim all1,942 pages passed indexability. Independent sample: homepage200 in873ms; property URLs at sitemap offsets500,1200,1600 and final manager URL exceeded12s. Separate Googlebot fetch of `/property/azizi-riviera-22` and `/property/rabdan-building` returned no response headers or bytes within15s. Exact public results `.data/indexing/lived-latency-sample.json` and `lived-googlebot-fetch-sample.json`. This is an unresolved fetching issue, distinct from sitemap processing. Thally38 and Peekup27 audits both complete, all passed.

Owner explicitly approved finishing remaining942 Lived URLs after quota reset. Created and viewed thread heartbeat `finish-radar-and-lived-indexing`, ACTIVE, hourly, with instructions to submit only942 pending URLs in at-most500 batches, verify acknowledgments, retry Radar's last Google URL after its daily quota clears (avoid repeated same-day attempts), stay quiet on unchanged quota state, and pause itself when complete. Exact queues are tracked in `pending-bing-lived.txt` (942) and `pending-google-radar.txt` (1). No website code changes or deployments in this follow-up.

Google documentation report visually confirmed `/sitemap.xml` Success247, submittedOct27/readNov1. Refresh was not completed because the work browser window moved off the current desktop and clicks fail with `windowNotFoundAtPosition`; asked owner to restore it or defer checks to scheduled follow-up. Bing documentation report not yet verified. Peekup download request result still pending; do not count accepted without a visible acknowledgment.

Owner restored the work window. Google documentation sitemap refresh is now submitted (acknowledgment readback pending); prior report Success247. Bing documentation report confirmed XML sitemap Success246, zero errors/warnings; its sitemap contains247 entries but246 unique URLs.

Peekup download Google request also reached the daily “Quota Exceeded” block; it was NOT accepted. All remaining Google requests should observe the existing daily limit, not switch properties/accounts to work around it. Additional queues: pending-google-extra.txt (Peekup download plus four Lived pages absent from XML); pending-bing-extra.txt (the four Lived pages, outside the original942 queued from XML). These public pages were HTTP200, self-canonical, index/follow. Existing noindex pages remain excluded. Bing download request can still be submitted within Peekup's remaining quota.

Final audit update: docs.thally.io has247 sitemap entries /246 unique URLs; all246 unique public pages passed public indexability probes. Google documentation refresh acknowledged “Sitemap submitted successfully”. Bing documentation XML Success246 confirmed, zero errors/warnings.

Updated existing owner-approved follow-up to include four additional Lived URLs for Bing (total946 pending) and five additional Google URLs from sitemap omissions (total6 pending including Radar's last article). Google retry deferred at least24h after quota block; after Bing completion follow-up should switch from hourly to one daily03:30 Dubai run while waiting, then pause after completion. Persistent live-fetch failures require a confirmatory retest and an explicit blocker report, not indefinite resubmission.

Bing Peekup extra download accepted: persisted download row Today03:19, total28, remaining72. Final sitemap re-fetch confirms no URL deltas on main Thally38, Lived1,942 and Peekup27 XML files during this run.

Follow-up timing refined: first run remains hourly to catch Bing reset. After Bing completion, switch to daily12:30 Asia/Dubai for Google; earliest Google attempt2026-11-03T08:30Z. This is a planned retry time, not a guaranteed reset time. Probe one pending URL; if daily quota persists, stop Google submissions for that run and wait for the next day. This avoids unnecessary same-day quota retries while allowing a first check sooner than a full24h delay.
