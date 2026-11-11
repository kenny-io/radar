# Scheduled lifecycle messages

The seven earlier drafts now map to actual runtime messages. This directory is a preview adapter; it imports current copy from the real renderer rather than keeping a second set of editable email bodies.

| Earlier draft | Runtime destination | Timing |
| --- | --- | --- |
| Put your Business Profile to work | Analyzed-profile welcome | Immediately after confirmed account creation |
| Why we built Radar | Existing founder note | Planned24hours later; shared cap/daytime may defer |
| What happens before an article goes live | One-time article_workflow guide | First eligible workspace observation+24hours; pre-trial profile observation+3days; resolved by meaningful content work |
| Would an AI assistant recommend your product? | Existing AI Visibility lesson | First course slot |
| Find one conversation you can help with | Existing Daily Brief lesson | At least7days after previous accepted lesson |
| Read the sentence before you agree to the link | Existing Backlinks lesson | At least7days after previous accepted lesson |
| Your next article might be a page you already have | One-time search_refresh guide | Later of measured-data readiness observation+24hours and accepted Organic Search lesson+7days |

All remain subject to current verified recipient, relevant source state, opt-outs, daytime and the shared optional24-hour cap. The five-week course still ends after five lessons; guides are separate once-per-account events. Existing course progress and attempted payloads remain intact. The workspace-ready message stays retired.

These schedules are implemented locally in pending PR25. They are not active production sends until approved deployment and activation. Rendering this gallery neither queues nor sends mail. The earlier pre-trial-only audience, proposed day0/1/4/7/11/14/18 calendar and opt-in-only recommendation have been superseded by the user’s default-on lifecycle instructions.

Rebuild from the repository root:

```sh
node --import tsx scripts/preview-nurture-emails.mjs
```

Open `../previews/nurture/index.html` or read its `drafts.txt` (compatibility filename, now current scheduled-source copy). The complete28-family catalogue is under `.factory/lifecycle-refinement/previews/`. Full contracts and rollout limits are in `.factory/lifecycle-refinement/architecture.md` and `runtime.md`.
