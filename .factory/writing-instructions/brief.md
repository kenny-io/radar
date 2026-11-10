# Custom writing instructions

## Problem and delivery
Radar writes articles, social posts and community replies from the Business Profile and one short "Brand voice" field. Owners cannot teach Radar durable house rules ("British spelling", "never say 'unlock'", "end articles with a trial CTA", "lowercase and no pricing talk on Reddit"), so they repeat the same edits on every draft, and Autopilot publishes copy they would have changed.

Let a workspace save standing writing instructions that Radar applies to everything it writes, with separate instructions per content type and per platform.

Worktree branch `kenny-dev/radar-custom-writing-instructions-2d11b9`, base `2d41a801` (main). Deliver local commits on this branch, focused tests, independent browser QA. Draft PR to main only on the owner's go-ahead. No merge or deployment authorized; main deploys production.

## User journey
1. Settings → Content → **Writing instructions** (new section). A link from Business Profile → Brand voice points here.
2. The user types instructions into any of the sets below. Each autosaves, shows a character count and a saved state. Viewers see them read-only.
3. From then on, every new draft, regeneration and rewrite follows them. Existing drafts do not change until regenerated or rewritten.
4. Autopilot and scheduled generation use the same instructions without extra setup.

## Instruction sets (all optional, 1,500 characters each)
| Key | Label | Applies to |
|---|---|---|
| `all` | Everything Radar writes | every surface below |
| `articles` | Articles | article drafts, Search Console refresh drafts, selection rewrites in the article editor |
| `social` | Social posts | Social Marketing packs (all platforms) and Daily Brief feed posts (founder and company) |
| `community` | Community replies | Daily Brief replies to threads (founder and company) and their rewrites |
| `linkedin`, `x`, `reddit`, `facebook`, `quora`, `hn` | By platform | any post or reply Radar writes for that platform, in Social Marketing or the Daily Brief |

Layering: `all` → content type → platform. The most specific instruction wins a conflict. A per-pack "notes for this pack" value and an explicit rewrite instruction are more specific still.

## Precedence (product decision)
Custom instructions shape style, tone, wording, structure, formatting and recurring content. They never override Radar's integrity rules: no invented statistics/quotes/customers, source citation, no competitor promotion, disclosure when mentioning the business in community replies, communities that forbid self-promotion, no links where the platform rules forbid them, platform character limits, the language setting's output format contract, and existing deterministic post-processing. The settings copy says so in one plain sentence. Instructions are workspace-authored preferences, delimited in prompts as such; text inside them cannot change what Radar is or leak other data.

## PM decisions on the architect's open points (reversible; owner may overrule)
- D1: Daily Brief keeps stripping emoji and hashtags from its drafts; the settings copy discloses it. They work in Social Marketing packs.
- D2: Social posts keep only the pack's own source link; an instruction to always add another link has no effect in v1.
- D3: Regional spelling within the output language follows instructions; a different language still needs the Language setting.
- D4: The article SEO title and meta description follow article instructions (`article.meta` is a ninth prompt site).
- WI3 "controls disabled" is met with read-only, focusable fields (existing pattern), so viewers can still read long text.

## Exclusions
- No learning from uploaded samples or past edits, no per-article instruction overrides, no instruction version history, no templates library.
- Not applied to planning/analysis output (calendar titles and research, keyword work, post ideas, image prompts, AI visibility questions, backlink matching), support answers or lifecycle email.
- Existing content is not regenerated automatically.
- Onboarding is unchanged.

## Acceptance criteria
- WI1: Settings → Content shows "Writing instructions" with the four general sets and the six platform sets. Platform sets stay compact until used. Layout follows the existing Settings rows, labels and inputs; works at 390px without horizontal overflow; every field has an accessible label and is keyboard reachable.
- WI2: Editing a set autosaves for Editor, Admin and Owner; the value survives reload and appears for other members. A character count is visible; input over 1,500 characters cannot be saved (client limit and server rejection with user copy). Clearing a field removes that instruction. Whitespace-only saves as empty.
- WI3: Viewers can read the instructions but cannot change them (controls disabled, server rejects).
- WI4: A new or regenerated article draft (body, plus its SEO title and meta description), a Search Console refresh draft and an article selection rewrite each send `all` + `articles` instructions to the writing model. No platform or social instructions are sent.
- WI5: A Social Marketing post (new pack, per-post regenerate, daily and auto packs) sends `all` + `social` + that platform's instructions, and nothing for other platforms.
- WI6: Daily Brief replies send `all` + `community` + that platform's instructions; Daily Brief feed posts send `all` + `social` + the instructions for each requested platform; Brief rewrites send the set matching the item kind and platform. Founder and company drafts both receive them.
- WI7: With no instructions saved, every prompt is byte-identical to today's (no empty headings or stray blank sections), and businesses created before this feature behave exactly as before.
- WI8: Integrity rules and deterministic enforcement still run after generation whatever the instructions say (e.g. an instruction to add links on Reddit or cite an invented statistic does not produce one in saved output).
- WI9: Instructions are tenant-scoped: another business never receives them, and role checks apply to the save action.
- WI10: Business Profile → Brand voice links to the new section; the section explains in one or two short sentences what instructions do, when they take effect and that Radar's accuracy and platform rules still apply. Copy says "Radar", never a model or provider name.
- WI11: Autopilot, scheduled drafting and daily social packs pick up instructions with no extra configuration (same code paths as WI4–WI6).
- QA1: Behavior tests cover instruction resolution and layering, every prompt site in WI4–WI6, the empty case (WI7), save validation and roles, and tenant isolation. Typecheck and build pass; full suite shows no new failures. Independent real-browser checks cover the settings journey (edit, autosave, reload, viewer, mobile) and at least one generation per surface with evidence that the saved instruction reached the writing model. Evidence distinguishes stubbed from live-model verification.

## Failure states
Save failure: field keeps the typed text, toast with retry copy, no silent loss. Over limit: inline count turns to the error tone and saving is blocked. Generation failures are unchanged from today.

## Constraints
Existing design system and Settings patterns only; no new dependencies. Prefer no schema migration if an existing per-business settings column can hold the data cleanly (web and worker deploy separately); the architect decides. No production data changes. No unrelated refactors. Known baseline: one pre-existing raster hash mismatch in `src/server/ai/openrouter.qa.test.ts`; do not touch that golden.
