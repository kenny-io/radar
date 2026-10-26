# Landing page: blog publishing as part of the offering

Branch `kenny-dev/landing-blog-connectors` from `main` @ `b854e86d`. Delivery: a PR to `main`. Merging deploys to production, so it waits for the owner's go-ahead.

## User problem
Radar now publishes to ten platforms, all live in production as of 2026-10-26 (blog connectors tranches 1 and 2). The marketing site barely says so:
- the home page mentions it only in the onboarding section and in one FAQ;
- the Organic search page's "Refreshes" line is now wrong. It says only WordPress, WordPress.com and Ghost update posts in place, but every CMS connector does since tranche 2.

The owner asked (2026-10-26) to show publishing as part of the offering in the most relevant places.

## Facts the copy may use (checked against the code on `main`)
- **Ten destinations:** Framer, Ghost, Next.js (a GitHub pull request), Notion, Shopify, Webflow, Wix, WordPress (self-hosted), WordPress.com, and a signed webhook.
- **Test connection:** creates a test draft and deletes it ("Every connection is tested before it's saved").
- **Refreshes:**
  - Every CMS connector updates the existing post in place.
  - Next.js updates the post's file through a pull request.
  - The webhook payload carries `mode: "refresh"` and `refresh_url`; the receiver decides what to do.
- **No overwrites or duplicates:** a taken slug gets `-2`, never overwriting another post, and a retry never duplicates.
- **Approval:** nothing publishes without approval unless the user turns on daily autopilot (review-first is the default).

## Placements and copy (PM decisions)
House style: short declarative sentences, curly apostrophes, no exclamation marks. Platform order is alphabetical, as elsewhere on the site. Logos come from `Logo`/`BrandIcon` (`src/lib/brandIcons.ts` has all nine CMS marks; `BrandIcon k="webhook"` draws the webhook). Logos are decorative (`aria-hidden`), and the name is always written as text.

| ID | Where | Change |
|---|---|---|
| LBC-1 | Home, Content Calendar card (`#search`) | Add a `bfine` line under the description, like the Daily Brief card's: "Approved articles publish to your site on schedule: Framer, Ghost, Next.js, Notion, Shopify, Webflow, Wix, WordPress or WordPress.com." The card's layout and the keyword demo must not break at any width |
| LBC-2 | Home, "Radar vs. going it alone" table | New row after **Articles**: th "Publishing"; With Radar "Sent to your CMS on schedule, after you approve"; On your own "Copy, paste and reformat every post" |
| LBC-3 | Home, pricing "Included" list | New item after **Content Calendar**: **Publishing**, "Framer, Ghost, Next.js, Notion, Shopify, Webflow, Wix, WordPress, WordPress.com, or a signed webhook." |
| LBC-4 | Home, "Paste your website" section, under "Publishes where you already do" | Change the sentence to "Nine platforms, or a signed webhook for anything else. Every connection is tested before it’s saved." (PM, after L1: the logo row now names them), and add a compact wrapping row of the ten platform marks, each with its name. Use existing marketing tokens and classes where possible; any new CSS goes in `marketing.css`, scoped |
| LBC-5 | Home FAQ "Where can Radar publish?" | Answer: "Framer, Ghost, Next.js (through a GitHub pull request), Notion, Shopify, Webflow, Wix, WordPress, WordPress.com, or any site through a signed webhook. Every connection is tested before it’s saved, and refreshing an article updates the existing post instead of adding a new one." |
| LBC-6 | Organic search, "Inside every article" → **Refreshes** | "Every CMS platform updates the existing post in place. Next.js does it through a pull request, and webhooks receive the live post’s URL." |
| LBC-7 | Both pages | No regressions: typecheck, tests (baseline: the `openrouter.qa.test.ts` snapshot), and `next build` pass. At 1440 px and 375 px there's no horizontal scroll and no overlap; reveal animations (`rv`) still run. Accessible names are unchanged, apart from the new text |
| LBC-8 | `DIVERGENCES.md` | One row under the marketing section: copy added beyond the 2026-10-25 prototype on the owner's request (2026-10-26), listing LBC-1…6 |

## Exclusions
- A dedicated Publishing/Integrations feature page or nav item.
- The "Where Radar carries your product" logo strip, which lists discovery channels, not CMSs.
- The Organic search step-03 demo list.
- New screenshots, and new dependencies.

## Known risk, for the owner
Shopify is listed (as it already was). But merchants outside the owner's Shopify organization can't install the app until it has custom distribution or an App Store listing (LAUNCH §7.5).
