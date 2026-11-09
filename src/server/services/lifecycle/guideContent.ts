import type { EducationContext } from './educationContent';

export const GUIDE_IDS = ['article_workflow', 'search_refresh'] as const;
export type GuideId = typeof GUIDE_IDS[number];
export interface GuideContent {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  steps?: string[];
  progress?: string;
  ctaLabel: string;
}

/** Editorial content only. Scheduling, eligibility and fixed destinations belong to the runtime. */
export function renderGuide(id: GuideId, context: EducationContext): GuideContent {
  const active = context.access === 'workspace';
  if (id === 'article_workflow') return {
    subject: 'What happens before an article goes live',
    preheader: 'I’ll walk you through choosing a topic and reviewing your first draft.',
    heading: 'Let’s get your first useful article ready.',
    paragraphs: [
      'I want to help you get an article onto your site that answers a real question for a potential customer. Radar uses your Business Profile to suggest topics, so you have somewhere to start.',
      'Here’s how I’d work through the first one. These steps assume Autopilot and Blog autopilot are off, so you can choose the topic and review the draft before publication.',
      ...(active ? [] : [context.access === 'restart' ? 'You can pick this up when you resume your subscription access. Your account is the place to start.' : context.access === 'setup' ? 'First, finish reviewing and saving your Business Profile. Once your workspace is active, you can follow these steps in Content Calendar.' : 'Your saved profile carries into your Radar trial. Start it when you’re ready to try these steps in Content Calendar.']),
    ],
    steps: [
      'Review the proposed topics in Content Calendar. Open one, read who it’s for and what it should answer, then choose Approve & schedule. Radar prepares the draft for you to review.',
      'Read the draft as someone considering your product. Correct the facts, add an example you know firsthand and check its links. Connect your publishing destination, then approve and schedule the article when it’s ready.',
    ],
    progress: 'You can follow the topic’s status in Content Calendar. Turning on Autopilot or Blog autopilot can allow articles to publish without a separate review.',
    ctaLabel: active ? 'Choose my first article' : context.access === 'restart' ? 'Reopen my Radar account' : context.access === 'setup' ? 'Continue setting up Radar' : 'Start my Radar trial',
  };
  if (id === 'search_refresh') return {
    subject: 'Your next article might be a page you already have',
    preheader: 'Before writing something new, I’d look at the pages people already find.',
    heading: 'There may be a useful next step in an existing page.',
    paragraphs: [
      'Before you spend time on another article, I’d look at what people are already finding on your site. Your Search Console data can help you choose a page worth improving.',
      'I’d investigate a page with impressions and few clicks, or a query around positions 10–20. Read the page and the search results before deciding what to change. A clearer title, a better example or a missing answer might be a useful place to start.',
      ...(active ? [] : ['The guide below is public. You can use it now, then review your measured pages in Radar when your workspace access is active.']),
    ],
    steps: [
      `${active ? 'Open Performance' : 'Once your workspace access is active, open Performance'} and review the Pages and Queries tables over the same period. Pick a page to investigate. Use Google Search Console itself if you need to filter queries for that particular page.`,
      'Choose one change you can justify: a clearer title, an updated example or a missing explanation. Review Radar’s suggestions and add a useful change to Content Calendar. Check it before anything publishes.',
    ],
    progress: 'Record the date of the update. Compare clicks and impressions once more data is available, using a similar period. The page-two refresh guide shows how to evaluate the opportunity before deciding what to change.',
    ctaLabel: 'Read the page refresh guide',
  };
  throw new Error('Unknown lifecycle guide');
}
