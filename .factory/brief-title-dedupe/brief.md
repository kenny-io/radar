# Brief: brief-title-dedupe

**Problem:** the production check of kenny-io/radar#11 found the same post drafted twice in Thally's brief on 2026-10-26. Both were Hacker News items titled "Show HN: ADRs for AI – Deliberation records for human–AI work, versioned in Git", ids 50246884 and 50241217. The scan treated them as different threads because it deduplicated by id only.

**Owner request:** "dedupe by normalized title within a day and across scans".

**Decisions (PM):**
- **Key:** a thread key is the platform plus the title in lower case, without punctuation or accents.
- **Same platform only:** the same title on another platform is another audience, and a generic question there is another conversation.
- **No key for generic titles:** a title under 5 words, or one made only of its author (X search results titled "Name (@handle) on X"), gets no key. Without this, distinct posts would be merged.
- **Within one scan:** the thread with more engagement wins, then the newer one.
- **Across scans:** `CandMark.tk` stores the key. Days scanned before this change still match against the titles of their replies.

**Acceptance criteria:**
- **TD-1:** two new threads with the same key in one scan produce one candidate (more engagement wins, then the newer).
- **TD-2:** a later scan skips a thread whose key matches an earlier scan's candidate or a reply already in the day.
- **TD-3:** generic titles and the same title on another platform are not merged.
- **TD-4:** first scan, Scan again, Keep and rescans behave as before. The suite matches baseline.
- **TD-5:** DIVERGENCES B16 describes the rule.

**Delivery:** branch `kenny-dev/brief-title-dedupe`, PR to `main`. Merging deploys, so the owner approves the merge.

## Verification on the branch head
- **Typecheck:** `npm run typecheck` is clean.
- **Unit tests:** `plan.test.ts` passes 16/16. The 5 new tests use the real Show HN pair, accents, the X author-only title, a short title, cross-platform titles, engagement and recency tie-breaks, and keys from both an earlier scan and the day's replies.
- **Mutation check:** dropping the key check from `uniqueCands` fails 1 test.
- **Full suite:** `npx vitest run` on `radar_dbr` with dev stubs passes 670, fails 1 and skips 65. The failure is the known openrouter parity snapshot. The DB-backed `scan.test.ts` (first scan, rescans, Keep, failure skip) passes unchanged.
- **Not run:** a browser check (no UI change) and real sources.
