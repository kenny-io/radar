# Radar pre-trial email drafts

Current weekly-education work supersedes this directory’s proposed audience/timing: the owner now requests five actionable feature lessons for all registered users, default on with recipient opt-out, one per week. See `.factory/weekly-education/brief.md` and `src/server/services/lifecycle/educationContent.ts`. These seven earlier editorial variants remain historical references; they are not a second active sequence.

User supplied nine screenshots containing seven distinct competitor themes, then confirmed the main audience is people who analyzed their website and created an account but have not started a Radar trial. These are original Radar drafts and preview artifacts only. They are not registered in LifecycleType, queued, scheduled, uploaded to a mail provider or sent. No account/work reminder consent is reused as marketing consent.

Open `../previews/nurture/index.html`, or at the existing local review server `http://127.0.0.1:3934/nurture/index.html`. Plain text is in `../previews/nurture/drafts.txt`. Source copy is `copy.mjs`; rebuild with `node --import tsx scripts/preview-nurture-emails.mjs`. The main lifecycle gallery links here.

## Proposed timing and eligibility, for later wiring

| Day | Draft | Relationship |
| --- | --- | --- |
| 0 | Put your Business Profile to work | Alternative to the approved analyzed-profile welcome; never an additional welcome |
| 1 | Why we built Radar | Existing approved founder message; reuse its event and preference, do not add a second founder letter |
| 4 | What happens before an article goes live | First new educational draft; describes the workflow after trial activation |
| 7 | Would an AI assistant recommend your product? | Included Radar feature; no claim that results already exist or that there is a free standalone checker |
| 11 | Your next article might be a page you already have | Evergreen Search Console guide; public article CTA, no assumed connection |
| 14 | Read the sentence before you agree to the link | Optional-interest only, late in the sequence; public network explainer CTA |
| 18 | Find one conversation you can help with | Radar’s Daily Brief workflow; distinct from a live brief completion/follow-through notice |

These dates are an editorial recommendation, not a scheduler. Before any new nurture sequence is enabled, require separate explicit product-education consent, purpose-scoped unsubscribe and first-party mailing preferences; apply the shared optional-mail daily cap and at most two new educational emails per rolling seven days. Do not retroactively enroll existing users. Stop the new sequence as soon as a trial starts or the account has current paid/complimentary access or has already subscribed. Re-check state before send. Skip an already-completed feature/action, a previously sent draft or a topic the user did not express interest in. Ordinary billing/security emails and the existing founder preference keep their current scope.

The existing welcome/founder are references in this seven-theme set, not two more automatic messages. Their approved live-source copy has not been changed in this task. Any selected replacement should be reviewed as a separate edit to that existing event.

## Fact and tone boundaries

- The Business Profile exists before primary signup; no repeated website setup instructions.
- A pre-trial account has not started the product workflows described. Future behavior is explicit.
- Radar is review-first; autopilot is a separate choice. Daily Brief replies are reviewed/shared by users.
- AI Visibility lives under Performance → AI Visibility and supports five assistants. Missing collection is distinct from no mention. Topics can be taken into Content Calendar; no automatic citation-to-strategy claim.
- The network is optional; proposals show exact context, and approvals/optional auto-approval matter. No daily/high-DR/ranking promises or borrowed customer testimonials.
- The competitor’s dated Bing announcement is replaced with Radar’s supported Search Console workflow and an existing public guide. No unverified release claim.
- $1 confirmation begins a three-day trial and is credited to the first monthly invoice; normally $49 first month, then $50/month. Pricing captions derive from src/lib/billing.ts. No free-trial claim.
- The35%figure is an internal target, not an outcome in these emails. No fabricated graphs or social proof.

Actual Radar logo, compact buttons and plain personal copy are retained. Example recipient is Alex; no production customer data is used. Unsubscribe URLs in the gallery are visibly described as preview-only and are not mailing authority for a real nurture campaign. Existing source/workflow verification remains at its recorded fingerprint; this editorial task does not relabel it as a new send or production deployment.
