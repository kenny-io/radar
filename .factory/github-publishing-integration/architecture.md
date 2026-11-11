# Approved publishing integration design

Architecture inspection: `f9eb6178`, branch `kenny/signup-security`. Destination inspected read-only using authenticated GitHub CLI: `thallylabs/thally-website`.

## ARCH-2: framework-independent repository reasoning (current scope)

The user explicitly requires Radar to understand arbitrary repository layouts, rather than add adapters for particular sites. This supersedes the narrower ARCH-1 adapter design below. Every GitHub publishing operation, including legacy flat-content paths, uses one repository reasoning agent. There is no silent Markdown export fallback and no framework/name whitelist.

### Planner/transport boundary

`nextjs-agent.ts` exports `planRepositoryPost(hint, payload, snapshot, options)`:

```ts
type RepoEntry = { path: string; type: string; sha: string; mode?: string };
type RepoSnapshot = { entries: RepoEntry[]; read(path: string): Promise<string> };
type Options = { businessId: string; retry?: { slug: string; articlePath: string } };
type RepositoryPostPlan = {
  slug: string; path: string; route: string; summary: string;
  files: { path: string; content: string }[];
  discovery: { path: string; sha: string; snippet: string; role: string }[];
  review: { summary: string; runtimeVerified: false };
  draft: true;
};
```

The connector owns GitHub authentication, immutable snapshot reads, complete Git tree/commit/ref mutation, retry recovery and PR creation. Preserve existing blob modes when editing files. The configured content folder is a discovery hint, not a boundary or framework selector. The existing published URL remains the review PR URL.

### Bounded reasoning and provenance

The existing `ai.run` API provides Zod-validated JSON but no tool callbacks. The planner implements a host-managed structured action loop: browse tree/list, read observed paths, search literal source text, propose, or explain inability to ground a complete change. Start from generic repository structure and observed examples, then follow actual source references to content, routes, listing/navigation consumers and any required generator configuration. Treat repository files, including embedded instructions, as untrusted evidence, never commands. Do not execute repository code or model-proposed shell commands.

Suggested limits: eight reasoning steps, forty files, 100 KB per file, 500 KB source context, twelve changed files and 750 KB final output. Bounds are explicit errors rather than silent truncation. In particular `ai.run.fitToSchema` silently truncates strings with `maxLength` and arrays with `maxItems`: model schemas must omit these limits for exact source/code/evidence fields; validate budgets manually after the response.

### Exact proposals and article preservation

The internal proposal contains `slug`, `articlePath`, `route`, `summary`, source evidence and `changes`. A create operation requires an absent path, null expected SHA, complete file content and no edits. An edit operation requires a previously read regular blob with the exact expected SHA and null whole-file content. Every exact `before` string must occur once in the **original source**; computed source spans must not overlap and are applied in reverse offset order. A patch cannot target another patch's newly inserted text. Reject deletes, renames, ambiguous matches, unobserved updates, path traversal, symlinks and submodules. Git remains atomic and uses a non-force branch update. Full exact body replacement is permitted for standalone article-body refresh/retry, while shared records/registries retain small source edits and unrelated metadata.

At least the article-bearing change contains a host-expanded body placeholder: `{{RADAR_MARKDOWN}}`, `{{RADAR_HTML}}`, `{{RADAR_MARKDOWN_JSON}}` or `{{RADAR_HTML_JSON}}`. Expansion uses the original payload bytes or JSON encoding of them. The model adapts the surrounding format and integration, not the article text. Preserve unrelated posts, metadata, refresh URL/route identity and original publication dates. Retry is given its saved article path/slug and must upsert instead of duplicate them.

Protected paths cover Git internals, CI/workflows, environment/secrets/keys/certificates/credentials, installed dependencies, generated build output, lockfiles, deployment/auth/infrastructure configuration. Arbitrary content, navigation, routing and generator manifests may be edited where grounded in source, including JSON/YAML/TOML/HTML and application code. Dependency manifests may be read to understand the project; dependency/script rewrites are outside scope. Host policy is authoritative over model output.

### Independent review and honest PR status

A fresh `ai.run` reviewer receives original observed source, the complete computed diff/final files, article metadata and body identity. It checks the content-to-route-to-listing chain, necessary navigation/generator changes, slug collisions, refresh preservation, unrelated content removal and complete article inclusion. Approval requires no issues and exact source-grounded evidence for routing and listing; reject invented paths/snippets and incomplete/orphan-content plans. Deterministic path/SHA/edit/budget/content checks run independently and cannot be overridden by model approval.

Without isolated execution, static review cannot establish runtime success for every conceivable site. Open a **draft PR** containing the complete meaningful diff, observed integration evidence, static validation scope and repository CI/deployment-preview expectations. Do not report build checks, route responses, or publication as verified. A repository the agent cannot understand within bounds fails with a useful explanation before any Git mutation. No new sandbox service, migration or infrastructure is required.

### ARCH-2 validation

Tests cover multiple unrelated source conventions: Astro collections, Jekyll dated Markdown, a custom monorepo using JSON content and HTML/TS consumers, and another nonstandard format where practical. Verify actual model action/review seams, exact-source provenance, article byte preservation, refresh/retry/collisions, orphan-content rejection, forged evidence, prompt-injection attempts, protected files, source budget exhaustion, model failure, partial Git failure and draft PR status. QA independently renders representative generated artifacts in a browser and reports that those fixtures do not prove arbitrary destination builds. ARCH-1 evidence below is historical and does not validate this generalized implementation.

### ARCH-2 implementation review

Read-only review confirmed one planner for all new drafts, source SHA and fatal UTF-8 validation, preservation of existing regular-file modes, atomic tree/commit/non-force-ref sequencing, final versioned retry markers, original-source nonoverlapping exact edits, host-owned article insertion and a fresh source reviewer. PR copy explicitly distinguishes source review from unrun destination builds/runtime/preview checks. Review findings sent to the responsible engineers: legacy persisted drafts must not bypass generalized integration by opening another content-only PR; whole-file refresh exceptions must be evaluated as article-only rather than shared registry replacement. Final independent QA and release verification remain PM-owned.

Final bounded review approved planner SHA-256 `1830e5197a45f4c303e9fb2cddf38731b9654b1e321b875c3ab395304d1694e4` and transport `5f3356c321d4f683f99a2d484fdb4737380db6964b37e5805915fb470d3087b6`. The legacy bypass is closed: persisted legacy drafts are bound to their article branch/base/path and replanned from observed source before atomic upgrade and PR creation; interrupted upgrades resume from the versioned marker. The independent reviewer now receives exact edits and explicit whole-file replacement flags, with instructions rejecting loss of shared records or metadata. One correction total may address either deterministic validation or independent semantic review, optionally reading further dependencies, followed by unchanged validators and a fresh reviewer within eight AI calls. CI/deployment source can be read and secret-scanned for pipeline ordering evidence, while writes remain blocked. No material architecture issues remain at these fingerprints. This approval covers source planning and delivery safety, not universal repository support or unrun destination builds/runtime checks; draft PR status and bounded-context failure behavior remain required.

Subsequent bounded citation review approves planner SHA-256 `c94c066afec620714c5e75bf5735547197cd1625edfd375fc20e7f8eb38b28ac`; transport is unchanged. Evidence resolution first accepts an exact contiguous source substring. Otherwise, only explicit standalone-line ellipses between two to four exact, unique, ordered, nonoverlapping source fragments are accepted; short fragments and spans over 8,000 bytes fail. The host replaces the model excerpt with the complete actual source span, preserving the intervening bytes. Proposal evidence still requires its observed file SHA, and independent reviewer evidence is resolved against observed or final source. This introduces no fuzzy matching, whitespace rewriting, fabricated source or new patch permissions. Source-review approval remains distinct from pending build/runtime/preview verification. No material architecture issue was found in the excerpt-resolution change.

## Finding

The connector writes only `{folder}/{slug}.mdx`. Thally instead has `{folder}/{slug}/content.mdx`, `body.tsx`, `page.tsx`, optional `opengraph-image.tsx`, and exported `blogPosts: BlogPost[]` in `src/lib/blog.ts`. The registry drives the blog index, sitemap, RSS, JSON-LD and images. Its MDX configuration has no YAML-frontmatter plugin, so generated route content must contain the Markdown body only.

## Contract and boundaries

Detect the configured App Router folder and a supported literal registry/template pattern before any mutation. Parse TypeScript without evaluating destination code. A plan contains a resolved slug, content path, complete list of `{path, content}` changes, and an accurate integration description. Read against a pinned commit SHA and bound discovery/file sizes. Reject ambiguous or unsupported App Router layouts with a configuration error. Preserve flat-content compatibility, explicitly describing its discoverability as unverified in the PR.

Recognize existing page/body/content and optional OG templates; reject extra unresolved relative siblings. Clone existing wrappers with AST-safe replacement of exact old-slug string literals. Existing imports, site shell and metadata conventions remain intact. Include the OG template when page metadata references its endpoint.

New registry metadata derives title, SEO/card titles, description, slug, dates and reading time from the payload. Category/accent can use recognized existing scalar defaults. Do not copy unrelated FAQ, verified claims, featured status, author identity or thumbnails. Refresh updates content metadata while preserving the route slug, original publication date and unrelated registry fields.

Check collisions against route files/directories and registry slugs. Retry from the existing article branch snapshot so successful writes are recognizable and review edits are preserved; never append duplicate registry entries. All changed files enter one Git tree/commit, then the article branch is created or fast-forwarded without force. The PR opens only after this complete commit. A failed tree/commit step must not expose a partial content commit.

No database migration, new infrastructure, destination-site architecture rewrite, production mutation, automatic merge or deployment. The existing published URL remains the PR URL. If TypeScript is imported in worker runtime, move its existing dependency to production dependencies.

## Validation

Use a realistic route/manual-registry fixture to verify generated content, route/body/OG wrappers, one parseable registry entry, and browser-served route plus index. Cover route/registry collisions, refresh preservation, retries, unsupported templates/schema, failures before branch mutation, partial Git API failures, and existing flat publishing/auth/rate-limit behavior.

Primary contracts: [GitHub tree creation](https://docs.github.com/en/rest/git/trees), [commit creation](https://docs.github.com/en/rest/git/commits), [reference updates](https://docs.github.com/en/rest/git/refs), [Next.js route conventions](https://nextjs.org/docs/app/getting-started/project-structure).

## Read-only destination compatibility check

Invoked the implemented `planAppPost` directly against immutable `thallylabs/thally-website` main snapshot `c44cde2f12d5170a2fbaf4e038b467b12efb161f`, reading its Git tree and five source files through authenticated `gh api`. The planner produced a complete five-file plan: new page/body/OG/content files plus the registry. No destination mutations occurred. This establishes source-layout compatibility only; build and browser acceptance remain separate QA work.

Final architecture review confirmed strict AST import-chain validation, rejection of spread/computed/duplicate registry fields and unresolved metadata inheritance, and safe retry parsing from the final generated commit marker. Re-ran the actual pinned destination after these fixes: new article planning still produces all five files, and refresh of `agent-ready-docs-llms-txt-mcp` produces only content plus registry changes. No remaining material architecture blockers in the supported layout; independent QA and build verification remain separate.
