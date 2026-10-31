/** A local, deterministic handoff for implementing Radar's website recommendations. */
export interface SuggestionPromptData {
  title: string; why: string; impact: string; page: string; url?: string; kind: string;
  diff: { title: [string, string] | null; meta: [string, string] | null; blocks: ['add' | 'edit', string, string][] };
}
export type SuggestionPromptSelection = 'all' | 'title' | 'meta' | { block: number };
export interface SuggestionPromptBusiness { name: string; domain: string }

export function suggestionTargetUrl(s: Pick<SuggestionPromptData, 'page' | 'url'>, domain: string): string | null {
  if (s.url) {
    try { const u = new URL(s.url); if (u.protocol === 'https:' || u.protocol === 'http:') return u.href; } catch { /* Try the legacy page path below. */ }
  }
  try {
    const base = new URL(/^https?:\/\//i.test(domain) ? domain : `https://${domain}`);
    if (!base.hostname || !['https:', 'http:'].includes(base.protocol)) return null;
    const u = new URL(s.page, base.origin);
    // A legacy page path must not quietly redirect the handoff to another site or scheme.
    return u.origin === base.origin ? u.href : null;
  } catch { return null; }
}

export function buildSuggestionPrompt(s: SuggestionPromptData, business: SuggestionPromptBusiness, selection: SuggestionPromptSelection = 'all'): string {
  const changes: string[] = [];
  const seo = (key: 'title' | 'meta', label: string) => {
    const values = s.diff[key];
    if (values) changes.push(`${label}:\nCurrent value (exact): ${JSON.stringify(values[0])}\nProposed value (exact): ${JSON.stringify(values[1])}\nUpdate the page's ${key === 'title' ? '<title> / SEO title' : 'meta description'} using the existing metadata or CMS conventions.`);
  };
  if (selection === 'all' || selection === 'title') seo('title', 'SEO title');
  if (selection === 'all' || selection === 'meta') seo('meta', 'Meta description');
  s.diff.blocks.forEach(([op, heading, description], i) => {
    if (selection === 'all' || (typeof selection === 'object' && selection.block === i)) {
      changes.push(`${op === 'add' ? 'Add' : 'Edit'} content: ${JSON.stringify(heading)}\nImplementation direction: ${description}\n${op === 'add' ? 'Add this section in the appropriate place without duplicating existing content.' : 'Locate the existing section and revise it in place, preserving useful existing content.'}`);
    }
  });
  if (selection !== 'all' && !changes.length) throw new Error('The selected recommendation is unavailable.');
  const target = suggestionTargetUrl(s, business.domain);
  return [
    `Implement ${selection === 'all' ? 'the following website improvements' : 'only the selected website change'} recommended by Radar.`,
    `Business: ${business.name || business.domain}\nSite: ${business.domain}\nTarget page: ${target || `URL unresolved; verify the site domain and page path ${JSON.stringify(s.page)} before editing.`}`,
    `Recommendation: ${s.title}\nRationale: ${s.why}\nExpected impact (estimate, not a guarantee): ${s.impact}`,
    `Requested changes:\n${changes.length ? changes.map((c, i) => `${i + 1}. ${c}`).join('\n\n') : 'Inspect the target page and determine the smallest change that addresses the recommendation above; explain the proposed change before editing.'}`,
    'Implementation guardrails:\n- Inspect the repository, routing, metadata and CMS conventions to locate the source for the target page before changing anything.\n- Apply only the requested changes. Preserve unrelated content, styles, links, functionality, accessibility and existing SEO settings.\n- Check current SEO values against the supplied current values. If they differ, report the mismatch and adapt carefully rather than overwriting newer work.\n- Verify factual claims using existing site content or provided sources. Do not invent statistics, reviews, property details, image assets or photographs.',
    ...(s.kind === 'links' ? ['- For internal links, verify the destination and relevant existing source articles. The target page above may be only one source; discover any additional source pages from the repository and recommendation, and do not invent article paths.'] : []),
    'Validation and handoff:\n- Run the relevant project checks; verify the target route, rendered title/meta when changed, working links, and responsive/accessibility behavior of changed content.\n- Summarize changed files, implemented changes, validation results, and any remaining uncertainty for review. Do not deploy or publish automatically.',
  ].join('\n\n');
}
