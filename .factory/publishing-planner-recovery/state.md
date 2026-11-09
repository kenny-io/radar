# Publishing planner recovery: delivered

User request completed. Radar fixes are deployed. Both recovered articles were subsequently merged at the user’s explicit request and independently verified live on Thally production.

| Task | Owner | Status | Evidence |
|---|---|---|---|
| ARCH-1 bounded discovery, diagnostics, deadline | factory-architect | verified | architecture.md; exact source/SHA/atomicity retained |
| ENG-1 planner/transport/error/UI implementation | factory-engineer | verified | Radar PR39; Node22 broad397passed/85skipped, typecheck/build |
| QA-1 independent safety/persistence/browser | factory-qa | verified | qa.md;17 probes,10 browser scenarios |
| ARCH-2/ENG-2 public citation eligibility | architect/engineer | verified | Radar PR41; original stored article/research preserved |
| QA-3 source rendering | factory-qa | verified |37 probes,357 regression tests/51skipped, typecheck/Node22build |
| REL-1 production release and real retries | PM | verified | current108d6e1a contains PR39+PR41; both services healthy/exact renderer hash |
| QA-2 actual destination build/preview | factory-qa | verified | destination-qa.md; both exact-head builds/tests/audits/live previews passed |
| REL-2 authorized destination publication | PM | verified | PR137 merge8e5b3627; PR138 mergec9a3b859; production deploy6af2407136be45d7f1b18623 ready |
| QA-4 real production verification | factory-qa | verified | production-articles-qa.md;13 browser groups passed, no failures or blocked checks |

Released Radar PRs: https://github.com/kenny-io/radar/pull/39 (4908694f) and https://github.com/kenny-io/radar/pull/41 (518eb6db). Current deployed main108d6e1ae70f82f3fdfd854ca79fcc4579b2a172 also contains separately authorized email-formatPR40; publishing source unchanged from tested versions. Web0da3581e and worker6e5bdfed SUCCESS; health{ok:true}; Node22.23.4 renderer hash47b378f6 matches verified source.

Recovered articles:
- e_2UQxRIMM: https://github.com/thallylabs/thally-website/pull/137, draft head a8b33044653590327f0962c1ddeda89332efd05d. Complete original10,988-byte Markdown and saved research unchanged.
- e_2Qcpo76u: https://github.com/thallylabs/thally-website/pull/138, draft head75c11fb7049408abe4d4648a087865dedc9dbb6f. Complete10,097-byte public Markdown retained; saved body/all9research references unchanged,8usable public citations exported. Previously hidden invalid internal citation now omitted from public output only.

Final production receipt: both entries published, errors cleared, no saved remote draft/active job, healthy connection; one draft PR per article. Both destination PRs are now merged following the user’s subsequent authorization. Netlify published combined mainc9a3b859cd208ff380d4737659ec536fb967c9a8 atNovember10 01:52:45Dubai. Both canonical article pages return200, appear once in the blog and discovery surfaces, and pass full production browser/content/mobile verification. Earlier draft-only acceptance is historical; no publication step remains. No remaining task blocker or required implementation/verification work.

Live URLs: https://thally.io/blog/migrate-markdown-docs-to-hosted-site and https://thally.io/blog/documentation-analytics-for-developer-docs.
