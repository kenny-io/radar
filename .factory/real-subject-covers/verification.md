# Verification

Source last changed in `9e7683c6`; base `main` `691806da`. Environment: macOS (darwin arm64), Node 22, `@napi-rs/canvas` 0.1.100, throwaway Postgres 16 on `127.0.0.1:55442`, stub mode for the browser (`RADAR_DEV_STUBS=1`, `RADAR_BILLING=off`, no provider keys).

## Baseline (`main` `691806da`, with a database)
Typecheck passes. 3,071 passed, 75 skipped, 1 failed: the parity snapshot in `src/server/ai/openrouter.qa.test.ts` (known).

## Final revision
| Check | By | Result |
| --- | --- | --- |
| `npm run typecheck` | engineer, QA, PM | passes |
| Full suite, fresh database | QA round 3 | 3,673 passed, 75 skipped, 1 failed (the known parity snapshot) |
| Full suite, fresh database | engineer (T2c) | 3,669 passed, 75 skipped, 5 failed: the parity snapshot and 4 in `visibility/digest.integration.test.ts`, which passes alone (40/40) and is untouched |
| The feature's own tests (11 files) | PM | 635 passed |
| QA's own probes (`.factory/real-subject-covers/qa/`) | QA round 3 | 494 passed, 0 failed |
| `next build` | engineer, at `fe1b91b8` | succeeded; the compiled action route contains the decode script. Not rerun after the matching fixes. |

## QA rounds (`qa.md`)
| Round | Revision | Verdict | Findings |
| --- | --- | --- | --- |
| 1 | `aa16969f` | do not ship the automatic path | D1, D2 major (another subject's picture, a share card as cover); D3–D6 minor. Fixed in `8227adb1`…`2b034f26` (brief D14–D20). |
| 2 | `2b034f26` | do not ship yet | Round 1 closed. N1 (share card through structured data), N2 (picture words that are also name words), N3 (blank check refuses thin objects). Fixed in `c7366c7e`…`9e7683c6` (brief D21–D24). |
| 3 | `9e7683c6` | ship | No open defect. Accepted limits listed in `qa.md` and in the pull request. |

## Browser (real browser, stub mode, by QA)
Round 1, as Owner, Editor and Viewer, at 1280×900 and 390×844: owner action with a page address and a picture address; the portrait fit; eight error messages inline; the notice and source link; hints and hidden buttons; style change on a real cover; both switch-back outcomes; the automatic path (found, miss); persistence after reload; Viewer and scheduled states; a 466-character source address at 390 px; moving to another article during a fetch; the existing placeholder notice, Regenerate and Generate from prompt. Rounds 2 and 3: the automatic path, both owner-action forms, one inline error and the switch back, on the fixed revisions.

## Decoder crash (PM)
`loadImage(Buffer.from([0xFF,0xD8,0xFF,0xD9]))` in a plain Node process exits with status 139. This is why the decode runs in a child process (brief D12).

## Departures from the design
Recorded as brief D12–D24. The design's title-lead confirmation, share-image use on the automatic path and in-process decode were all replaced after evidence from the engineer and QA.

## Not verified
- Linux and the production platform: the child-process decode, WebP, EXIF and blur results ran on darwin arm64 only.
- Any real website, a real image model, a real connector or publish, Autopilot end to end, mixed web and worker versions, an old browser bundle.
- The blank-picture message in the browser (checked through the real route; the stub site serves no blank picture).
- Safari, Firefox, screen readers.
