# State

Base: f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49, existing dirty branch kenny/signup-security. Do not stage unrelated work.

| Task | Owner | State | Scope / dependency |
| --- | --- | --- | --- |
| ARCH-1 | support_architecture / factory-architect | verified | Dedicated authenticated member endpoint, no paid gate, curated AI, explicit idempotent email, no migrations |
| ENG-API | support_backend / factory-engineer | verified | Contract, route, support services,20/20 focused tests and typecheck; docs/SUPPORT.md |
| ENG-UI | support_ui / factory-engineer | verified | SupportWidget, scoped CSS, AppShell mount; detector[]; independent browser7/7 |
| QA-1 | support_qa / factory-qa | verified | Focused20/20, API7/7, browser7/7, production-mode missing-provider smoke2/2 |
| PM-1 | main agent | verified | Requirements/design, code and visual review, production build, final typecheck and serial regression run complete |

Delivered locally and verified; uncommitted and undeployed. User confirmed support@thally.io. PM reviewed API/AI/mail implementation and desktop/mobile evidence. Fixed transcript-bearing insert error normalization before QA; no remaining product defect reported. Production build and final typecheck pass; serial full suite760 passed200 skipped with one documented pre-existing raster golden failure. No test expectations changed. Runtime matches independently tested fingerprint b9a1147081512961799e52336bc4bb9effb09d208efbc2afc722310f13c17446.

Remaining activation checks: configure existing AI/Resend/SUPPORT_INBOX settings in target deployment, verify live model answer quality/latency and actual receipt/replies at support@thally.io. No production deployment or external test email was performed.

## Contract

POST /api/b/[bid]/support. Ask: {kind:'ask',message,history:[{role:'user'|'assistant',text}],page}; handoff adds kind:'handoff',requestId:UUID. Envelope {ok:true,data}; data is {kind:'answer',reply,needsHuman} or {kind:'handoff',delivered,reference}. delivered:false means development capture only. Shared types/limits in src/lib/support.ts, owned by ENG-API. Client api() receives object body and returns full envelope. Body max32KiB; message1..2000 chars; history<=12, each1..4000 chars. Email destination/config never supplied by client or model. Resend live retry uses stable user/business/request UUID key and immutable payload. No silent AI-triggered mail.
