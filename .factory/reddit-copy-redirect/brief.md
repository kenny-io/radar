# Concise replies and Reddit copy redirect

Daily Brief users should see a short, useful response with an immediate copy action. Copying a Reddit response should open that thread's comments, ready to paste. Keep manual “I posted it” confirmation; no automatic submission.

## Acceptance criteria

- AC1: Copy reply, Copy again, and keyboard C copy the selected/edited Reddit response and open the thread comments after clipboard success and copied/edit persistence.
- AC2: Clipboard failure shows actionable feedback, stays in Radar, and does not mark the item copied. Save failure also prevents navigation and retains the draft.
- AC3: Preserve pending edits and existing copied/posted semantics. Other platforms and feed posts retain current copy behavior.
- AC4: Missing or invalid Reddit destinations remain copyable without unexpected navigation. Redirect works with popups blocked.
- AC5: Generated community replies and AI rewrites use at most three short paragraphs, aiming for two. Cover help, product mention, and company voices. Preserve required disclosure and existing platform limits; leave manual edits and feed posts intact.
- AC6: A visible Copy reply action appears above the response, before the Just help / Plug business switch in reading/tab order. Verify desktop and mobile.

## Design and constraints

Use the supplied screenshot and existing UI components. Extend the existing reply-header row with Copy reply before the variant switch; wrap on small screens. Retain footer confirmation/actions. Await clipboard then save before same-tab navigation to a validated Reddit permalink ending #comments. Reddit controls external scrolling and composer behavior.

Shorten the six-paragraph tone example. Reply-only generation instructions aim for 60–120 words, at most 150 words/three paragraphs, at most 50 words per paragraph. Apply the final brevity guard after disclosure insertion and fallback plugs; preserve useful help and product disclosure. No rendering truncation, manual-edit clipping, or historic-draft migration.

Delivery: local implementation, focused regression tests, independent real-browser verification. No merge or production deployment requested. Preserve unrelated working-tree changes on kenny/signup-security at base f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49.
