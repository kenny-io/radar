import { describe, expect, it } from 'vitest';
import { buildSuggestionPrompt, suggestionTargetUrl, type SuggestionPromptData } from './suggestionPrompt';

const business = { name: 'Lived', domain: 'lived.ae' };
const suggestion: SuggestionPromptData = {
  title: 'Refresh Sobha Sapphire', why: '1,736 impressions at position 9.5.', impact: 'Est. +50–85 clicks / month',
  page: '/property/sobha-sapphire', url: 'https://www.lived.ae/property/sobha-sapphire', kind: 'refresh',
  diff: {
    title: ['Sobha Sapphire | Lived', 'Sobha Sapphire: tenant ratings | Lived'],
    meta: ['', 'Read verified tenant reviews of Sobha Sapphire.'],
    blocks: [['edit', 'Page intro', 'Open with the building name, area and tenant score.'], ['add', 'Photos', 'Add labeled existing photos with descriptive captions and alt text.']],
  },
};

describe('coding-agent suggestion prompts', () => {
  it('hands off the full recommendation with exact SEO values, context, rationale and verification', () => {
    const p = buildSuggestionPrompt(suggestion, business);
    for (const text of ['Lived', 'lived.ae', suggestion.url!, suggestion.title, suggestion.why, suggestion.impact, 'Page intro', 'Photos', ...suggestion.diff.title!, ...suggestion.diff.meta!.filter(Boolean)]) expect(p).toContain(text);
    expect(p).toContain('Current value (exact): ""');
    expect(p).toContain('Proposed value (exact): "Read verified tenant reviews of Sobha Sapphire."');
    expect(p).toContain('Locate the existing section and revise it in place');
    expect(p).toContain('Add this section in the appropriate place');
    expect(p).toContain('Do not deploy or publish automatically');
    expect(p).toContain('If they differ, report the mismatch');
    expect(p).toContain('Do not invent statistics, reviews, property details, image assets or photographs');
    expect(p).toContain('Run the relevant project checks');
  });
  it('scopes SEO title copying to the title, without slipping in other suggested changes', () => {
    const p = buildSuggestionPrompt(suggestion, business, 'title');
    expect(p).toContain(JSON.stringify(suggestion.diff.title![0]));
    expect(p).toContain(JSON.stringify(suggestion.diff.title![1]));
    expect(p).toContain('only the selected website change');
    expect(p).not.toContain(suggestion.diff.meta![1]);
    expect(p).not.toContain(suggestion.diff.blocks[0][2]);
    expect(p).not.toContain(suggestion.diff.blocks[1][2]);
  });
  it('scopes meta copying and preserves multiline values exactly as quoted strings', () => {
    const s = { ...suggestion, diff: { ...suggestion.diff, meta: ['Old "description"\nwith another line', 'New description'] as [string, string] } };
    const p = buildSuggestionPrompt(s, business, 'meta');
    expect(p).toContain(JSON.stringify(s.diff.meta[0]));
    expect(p).toContain('Proposed value (exact): "New description"');
    expect(p).not.toContain(suggestion.diff.title![1]);
    expect(p).not.toContain(suggestion.diff.blocks[0][2]);
  });
  it('copies exactly the selected content block, even when headings are repeated', () => {
    const s = { ...suggestion, diff: { ...suggestion.diff, blocks: [['edit', 'Photos', 'Keep existing useful captions.'], ['add', 'Photos', 'Add the verified exterior asset.']] as SuggestionPromptData['diff']['blocks'] } };
    const p = buildSuggestionPrompt(s, business, { block: 1 });
    expect(p).toContain('Add content: "Photos"');
    expect(p).toContain('Add the verified exterior asset.');
    expect(p).not.toContain('Keep existing useful captions.');
    expect(p).not.toContain(suggestion.diff.title![1]);
  });
  it('does not invent additional article paths for an internal-link recommendation', () => {
    const s: SuggestionPromptData = { ...suggestion, kind: 'links', diff: { title: null, meta: null, blocks: [['add', 'Internal links', 'Add contextual links to /pricing from the top articles.']] } };
    const p = buildSuggestionPrompt(s, business);
    expect(p).toContain('Add contextual links to /pricing');
    expect(p).toContain('verify the destination and relevant existing source articles');
    expect(p).toContain('do not invent article paths');
  });
  it('keeps FAQ questions in the actionable content direction', () => {
    const s: SuggestionPromptData = { ...suggestion, kind: 'faq', diff: { title: null, meta: null, blocks: [['add', 'FAQ', 'Answer “What are the maintenance fees?” using verified page content.']] } };
    expect(buildSuggestionPrompt(s, business, { block: 0 })).toContain('Answer “What are the maintenance fees?” using verified page content.');
  });
  it('refuses missing selected changes instead of producing a misleading success prompt', () => {
    expect(() => buildSuggestionPrompt(suggestion, business, { block: 8 })).toThrow('unavailable');
    expect(() => buildSuggestionPrompt({ ...suggestion, diff: { ...suggestion.diff, title: null } }, business, 'title')).toThrow('unavailable');
  });
  it('uses the saved absolute URL, including its scheme, and resolves legacy rows', () => {
    expect(suggestionTargetUrl({ page: '/ignored', url: 'http://www.lived.ae/property?unit=1' }, 'lived.ae')).toBe('http://www.lived.ae/property?unit=1');
    expect(suggestionTargetUrl({ page: '/property/sobha-sapphire' }, 'lived.ae')).toBe('https://lived.ae/property/sobha-sapphire');
    expect(suggestionTargetUrl({ page: '/property/sobha-sapphire', url: 'broken' }, 'https://www.lived.ae')).toBe('https://www.lived.ae/property/sobha-sapphire');
  });
  it('does not turn malformed domains or unsafe legacy page paths into plausible target URLs', () => {
    for (const page of ['javascript:alert(1)', '//other.example/property', 'https://other.example/property']) expect(suggestionTargetUrl({ page }, 'lived.ae')).toBeNull();
    expect(suggestionTargetUrl({ page: '/property' }, 'not a domain')).toBeNull();
    expect(buildSuggestionPrompt({ ...suggestion, url: undefined }, { ...business, domain: 'not a domain' })).toContain('URL unresolved; verify the site domain and page path');
  });
});
