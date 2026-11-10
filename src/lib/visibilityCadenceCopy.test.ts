// AI Visibility is checked once a week (VW-4). Everywhere Radar says how often, it says weekly: the marketing pages, the
// social card text, the blog call to action, the add-prompt toast, the lesson email, and what crawlers read (llms.txt,
// llms-full.txt, pricing.md, the RSS feed). No nightly, daily or overnight claim about it remains.
// The Daily Brief is a different feature: its own copy ("every morning") is not checked here.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEO_PAGES, blogRssXml, llmsFullText, llmsText, pricingMarkdown } from './seo';
import { BLOG_POSTS } from './marketing-posts';
import { EDUCATION_LESSONS, renderEducationLesson } from '@/server/services/lifecycle/educationContent';

const NIGHT = /night/i;                                           // nightly, every night, tonight, overnight
const source = (file: string) => readFileSync(fileURLToPath(new URL('../' + file, import.meta.url)), 'utf8');

describe('AI Visibility cadence copy says weekly', () => {
  it('marketing pages: the home page, its story section and the AI visibility page', () => {
    const home = source('features/marketing/Home.tsx'), story = source('features/marketing/HomeStory.tsx'), page = source('features/marketing/AiVisibility.tsx');
    for (const s of ['Checked every week across five', 'Weekly checks across ChatGPT, Perplexity, Gemini, Claude and Grok.', 'Radar checks five assistants every week and turns every gap into a topic.', 'Yes. Radar checks your prompts every week across ChatGPT, Perplexity, Gemini, Claude and Grok,']) expect(home).toContain(s);
    expect(story).toContain('Every week, Radar asks five assistants what your customers ask, and shows where you stand.');
    for (const s of ['Every week, Radar asks ChatGPT, Perplexity, Gemini, Claude and Grok the questions your customers ask,', '<span className="fv">Every week</span>', 'Five assistants answer, every week.', 'For each assistant, every week.', 'Once a week. Collect now runs a check on demand.']) expect(page).toContain(s);
    for (const [name, text] of [['Home.tsx', home], ['HomeStory.tsx', story], ['AiVisibility.tsx', page]]) expect([name, NIGHT.test(text)]).toEqual([name, false]);
  });

  it('page metadata and social card text, and the blog call to action', () => {
    const page = SEO_PAGES.find(p => p.path === '/features/ai-visibility')!;
    expect((page as any).cardDescription).toBe('Five assistants. Weekly checks. Clear next steps.');
    expect(BLOG_POSTS.map(p => p.cta.headline)).toContain('Radar asks five assistants your customers’ questions every week.');
    expect(NIGHT.test(JSON.stringify(SEO_PAGES))).toBe(false);
    expect(NIGHT.test(JSON.stringify(BLOG_POSTS.map(p => [p.title, p.description, p.dek, p.cta])))).toBe(false);
  });

  it('what crawlers read: llms.txt, llms-full.txt, pricing.md and the RSS feed', () => {
    for (const [name, text] of [['llms.txt', llmsText()], ['llms-full.txt', llmsFullText()], ['pricing.md', pricingMarkdown()], ['rss', blogRssXml()]]) {
      expect([name, /night|every day|each day|once a day|daily check|checked daily/i.test(text)]).toEqual([name, false]);
    }
  });

  it('the app: adding a prompt says its answers are being collected now, not tonight', () => {
    const screen = source('features/performance/Performance.tsx');
    expect(screen).toContain("toast('Prompt added. Radar is collecting its first answers now.')");
    expect(/tonight|overnight|nightly|every night/i.test(screen)).toBe(false);
  });

  it('the AI visibility lesson email: a new question is collected when added, then weekly', () => {
    for (const access of ['workspace', 'start_trial', 'restart', 'setup'] as const) {
      const lesson = renderEducationLesson('ai_visibility', { businessName: 'Paper & Pixel', offering: 'design tools', audience: 'independent studios', gscConnected: false, access });
      const text = [lesson.subject, lesson.preheader, lesson.heading, ...lesson.paragraphs, ...lesson.steps, lesson.ctaLabel].join('\n');
      expect(lesson.steps[0]).toContain('Radar collects answers to a new question as soon as you add it, then checks every question once a week.');
      expect([access, NIGHT.test(text)]).toEqual([access, false]);
    }
    // No other lesson says anything about AI visibility's cadence either.
    for (const id of EDUCATION_LESSONS) {
      const lesson = renderEducationLesson(id, { businessName: 'Paper & Pixel', gscConnected: false, access: 'workspace' });
      expect([id, /nightly|every night|tonight|collected overnight/i.test([...lesson.paragraphs, ...lesson.steps].join('\n'))]).toEqual([id, false]);
    }
  });
});
