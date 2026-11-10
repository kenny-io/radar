# Refresh publication recovery

Problem: production entry e_MCOBF9hZ (lived.ae) stores a refresh target as `/rent/dubai/1-bedroom-apartments`. The repository planner requires an absolute website URL, fails deterministically, and spends its correction attempt retrying immutable bad metadata. Production revision verified read-only: 75163f1ccf821fbe468c8a345aecb5b6de50fd2e.

Scope: normalize persisted refresh targets at the publisher boundary, preserve complete source URLs for future calendar/suggestion entries, and retain strict repository route identity checks. No UI, schema, auto-merge behavior, or production article mutations.

Acceptance:
- RP-1: Existing root-relative refresh targets become absolute business-site URLs in both refreshUrl and canonical, without editing saved articles.
- RP-2: Absolute CMS URLs, meaningful queries and SPA fragments retain identity; route changes are still rejected by repository validation.
- RP-3: Invalid/missing/non-web/unsafe targets fail clearly before hero/model/Git work. New articles retain null refreshUrl/canonical.
- RP-4: New refresh candidates and accepted suggestions retain the full source URL.
- RP-5: Focused publishing and affected regressions, typecheck, and independent QA pass on the integrated revision.

Delivery: reviewable isolated branch and PR against main. Repository production policy requires owner go-ahead before merge/deployment; final approval must follow concrete PR and test evidence. Existing customer failures are not retried as tests.
