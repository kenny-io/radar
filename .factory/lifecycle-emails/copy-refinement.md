# Email copy refinement

Owner feedback: the first email drafts read as heavily AI-written. Refine the actual templates using Radar's product and marketing voice. This is a copy pass on PR25, not a new delivery system or campaign.

## Voice and sources

Read the current homepage (`src/features/marketing/Home.tsx`), setup story (`HomeStory.tsx`), and Organic Search, Daily Brief and Social Marketing feature copy. The useful pattern is concrete and conversational: what you sell, who buys it, how you sound; review a profile; choose an article or conversation. Use familiar product names and one clear action per message. No product-marketing context file was present at the standard paths.

Applied the copy-editing skill's clarity, voice, relevance, proof, specificity, emotion and friction passes. Removed corporate payment phrasing, repeated instructions, defensive boilerplate and generic reassurance. No invented founder origin story, personal-response guarantee, customer proof, growth promise or manufactured urgency. The founder email remains a service/setup check-in with the same opt-out, rather than a promotional pitch.

## Changes

- Welcome: plain subject, site-reading explanation, three useful next steps. Link goes through `/dashboard` so the existing guard opens setup or the finished workspace as appropriate. Removed a redundant account-versus-trial disclaimer; no trial or free-access claim is made in this message.
- Founder: one concrete tip about reviewing the Business Profile, an invitation to reply with a stuck step or an off-brand draft, and a short sign-off. Removed the procedural checklist and unsolicited warnings.
- Account/billing messages: shorter subjects and direct language. Receipts say what was received; failed payments explain the next action and possible paused access; cancellation says when access ends and that renewal stops. No guilt or retention pitch.
- Exact trial end, $1 credit, normal $49 first month, $50 renewal, automatic renewal, cancellation action, invoice amounts/currency, one-hour reset limit, session sign-out, support contacts and legal sender identity remain intact. Existing escaping and link validation are unchanged.

## Verification and delivery

Regenerated all ten HTML/plain-text previews from the actual renderer. Existing template tests pass **15/15**, unchanged; no implementation-mirroring tests added for this copy edit. Independent copy review and 20 browser viewport render checks are in `qa/copy-refinement/` and `copy-review.md`. Prior recovery/billing/queue verification belongs to the original implementation revision; it was not repeated or relabeled as a new full-flow run for this copy pass.

No emails sent, migration/configuration changes, merge or deployment. Existing approval for PR25 remains pending; the copy refinement updates the same reviewable PR. Existing unrelated search-indexing work is preserved.
