# Repository-aware GitHub publishing

Radar must understand the connected repository and open a PR that integrates the written article into its blog. The user's scope correction explicitly rejects support limited to Thally or a fixed layout list. The initial deterministic route-folder implementation is baseline work, not the completed requested product.

## Scope and behavior

- Every destination uses framework-independent repository discovery, planning and validation. The configured content folder is a hint, not an architecture contract or sole write location.
- Trace existing article examples, content schema, loaders, routes, listing/navigation and related manifests. Follow observed conventions rather than assume Markdown, Next.js, filenames or registry names.
- Use the existing business AI layer for bounded source-grounded repository reasoning. Repository text is untrusted data. Do not send credentials/secret files to models or execute destination code inside Radar.
- Generate the full integration diff. Guard existing-file changes with read SHA and exact replacement text. A fresh independent review checks article fidelity and observed route/listing integration before writes.
- Commit all changes atomically, then open the article PR. No silent file-only fallback when discovery fails.
- PRs record observed integration evidence and actual validation. Source review does not establish a successful build; absent build/runtime verification, create a draft PR with explicit checks still needed.
- Preserve refresh identity, publication metadata, retry deduplication, unrelated source, tenant context and GitHub error behavior. Reject incomplete plans before mutation with useful recovery guidance.
- No promise that finite checks establish compatibility with every conceivable site. Unknown layouts get discovery effort; inability to establish a complete integration stays visible.
- Preserve unrelated checkout work. No remote mutation, automatic merge or deployment in this implementation task. Existing PR repair is not implicitly included.

## Acceptance criteria

- GPI-1: Every destination, including flat folders and non-App-Router sites, enters general discovery. No framework/layout allowlist, registry name, extension or folder shape gates reasoning.
- GPI-2: Planner can read/browse/search immutable snapshots within budgets, follow dependencies beyond the configured hint and ground route and listing/navigation behavior in observed source.
- GPI-3: Plan creates complete content and code/config/listing changes, or establishes automatic discovery from observed code. Preserve article fidelity and refresh identity. Incomplete/unproven plans fail before mutation.
- GPI-4: Host rejects stale/unobserved/nonunique/overlapping edits, unsafe/protected paths, symlinks/submodules, excessive changes and repository instructions seeking credentials, execution or unrelated infrastructure changes.
- GPI-5: Fresh independent review receives original source, complete diff and article. Rejected or ungrounded route/listing/content claims cannot produce PRs. Review is a separate request, possibly using the same model/provider.
- GPI-6: All accepted files enter one Git tree/commit/reference update. Retries reuse article identity and PR. Authentication/rate-limit/network errors retain classifications.
- GPI-7: PRs list changed files, inferred integration/evidence, actual static checks and unrun build/runtime checks. Runtime-unverified integration opens as a draft; never claim live publication.
- GPI-8: Diverse regressions cover automatic collections, dated generator posts, custom registries/static HTML and nonstandard monorepos; refresh/retry/rejection/security failures. Independent browser QA covers multiple layouts. Record actual AI/live/build coverage honestly.

## Baseline and target

Repository `kenny-io/radar`, checkout branch `kenny/signup-security`, starting HEAD `f9eb6178` plus initial adapter changes and unrelated user work. Target: reviewable local implementation. Prior-stage evidence remains in `verification.md` and `qa.md`; generalized-stage evidence must be distinguished.
