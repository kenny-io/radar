# Verification: landing-blog-connectors

Baseline (`main` @ `b854e86d`): `npx vitest run` has one failure, the known `openrouter.qa.test.ts` golden snapshot.

## Engineer (L1), `ffa004de`
| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 517 passed, 144 skipped, 1 failed (baseline) |
| `next build` | pass (`tsconfig.json` restored) |
| 1440 and 375 px self-check | no horizontal scroll |

The Content Calendar card matches the AI card's height. `BrandIcon` has no webhook mark, so `WebhookMark` was added inline in Home.tsx.

## PM edits
- `4b63baf3`: the LBC-4 sentence names the platforms once.
- `22d95f47`: DIVERGENCES updated.

## QA (L2) on `22d95f47`: PASS
| Check | Result |
|---|---|
| Copy | The rendered-text diff against base shows only the LBC-1…6 strings. Curly apostrophes throughout |
| Layout | `scrollWidth` equals `clientWidth` at 1440, 1280, 1024, 1000, 960, 900, 800, 768, 700, 641, 640, 414 and 375 px. No overlap. The comparison row is aligned. The pricing list and logo row wrap cleanly. The Content Calendar card is 25–90 px taller; its neighbour stretches to match (cosmetic) |
| Accessibility | `list "Publishing platforms"` with 10 named items; marks are `aria-hidden`. `th scope=row`. FAQ works by keyboard. Tab order unchanged (34 and 26 stops) |
| Reveal animations | Every `.rv` element reveals on scroll. With reduced motion, the elements are visible at once |
| Regressions | tsc clean; vitest 517 passed, 1 failed (baseline); build passes (19 of 19 static pages); no console errors |
| Truthfulness | Claims checked against the connectors. Copy notes: (1) LBC-6 "Every platform" also covered the webhook, which is fixed below; (2) LBC-5 holds when the post is found; (3) LBC-2 doesn't mention opt-in autopilot, but review-first is the default |

QA didn't run screen readers, Safari, Firefox, touch devices or dark mode. Evidence is in the PM scratchpad, under `lbc-qa/`.

## After QA
LBC-6 now reads "Every CMS platform updates…". It's a one-span text change in OrganicSearch.tsx; tsc is clean. Because it's a copy-only change with no layout risk, QA wasn't re-run.
