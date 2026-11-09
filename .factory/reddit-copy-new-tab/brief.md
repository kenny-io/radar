# Reddit copy opens a new tab

User corrected the deployed interaction: copying a Reddit response must open the thread comments in a new tab and keep Radar available. Fix and deploy are explicitly authorized.

- AC1: Top Copy reply, footer copy/Copy again and C copy current visible text and open validated Reddit thread comments in a NEW tab. Radar URL and current item remain available; copied/manual I posted it state preserved.
- AC2: New tab creation remains tied to the user gesture, even when clipboard and persistence are asynchronous. External Reddit navigation waits for successful clipboard write and saved copied/edit state. Clear window.opener before navigating externally.
- AC3: Clipboard or save failure stays in Radar, shows existing recovery guidance and cleans up any reserved blank tab. Never navigate the original tab as fallback.
- AC4: Blocked/unavailable new tab preserves successful copy and save, with an explicit Open Reddit action opening a new tab. Missing/invalid destinations remain safe copy-only behavior.
- AC5: Current variant, edits, keyboard, repeat-copy and mobile paths work. Other platforms and brevity rules retain behavior.

Use existing UI/toast patterns. No schema, dependency or runtime configuration change. Work in existing isolated release worktree; preserve previous release receipts. Deliver via scoped PR/merge, both existing GitHub-main Railway deployments and final read-only production verification.
