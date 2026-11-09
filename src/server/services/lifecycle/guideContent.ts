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
    preheader: 'Choose the topic, review the draft and decide when it belongs on your site.',
    heading: 'Start with one article you’d want a customer to find.',
    paragraphs: [
      'Radar uses the Business Profile to research article ideas. The steps below describe a review-first workflow, with Autopilot and Blog autopilot off. You choose which topics are worth writing and check each draft before publication.',
      ...(active ? [] : [context.access === 'restart' ? 'When you restart your Radar access, you can pick up this workflow from your account. You’ll see the amount due before confirming.' : context.access === 'setup' ? 'Finish reviewing and saving your Business Profile in Radar. When your workspace is active, you can follow this workflow in Content Calendar.' : 'Your saved profile carries into your Radar trial. You’ll see the price before starting, then you can follow this workflow in Content Calendar.']),
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
    preheader: 'Use your Search Console data to choose an existing page worth improving.',
    heading: 'Look at the pages people already find.',
    paragraphs: [
      'An existing page may be a useful place to spend your next writing session. Search Console can show which pages appear in search and what people were looking for when they saw them.',
      'Choose a page by reading that evidence. A page with impressions and few clicks, or a query around positions 10–20, is worth investigating. The explanation might be in the title, the search intent or an answer the page hasn’t covered well.',
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
