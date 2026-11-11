import type { EducationContext } from './educationContent';

export const GUIDE_IDS = ['article_workflow', 'search_refresh', 'autopilot_intro'] as const;
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
  if (id === 'autopilot_intro') return {
    subject: 'Too busy to keep up with publishing?',
    preheader: 'Put Radar on Autopilot and hand over the day-to-day content and social work.',
    heading: '',
    paragraphs: [
      'If choosing topics, reviewing calendars and finding time to publish still feels like too much work, I’d put Radar on Autopilot.',
      'Radar handles your content calendar, prepares articles and creates social posts. Through connections that support automatic publishing, it can schedule and publish them without waiting for your review. Your SEO content and social work can keep moving while you focus on the business.',
      'Some publishing destinations still need their own approval. Radar emails you the action when a community reply or a connection needs your help.',
      active ? 'Enable it in Settings → Autopilot for this business. You can turn it off from the same place.' : context.access === 'restart' ? 'Resume your subscription access first, then open Settings → Autopilot to enable it for your business. You can turn it off there whenever you want.' : context.access === 'setup' ? 'Finish setting up your Business Profile and activate your workspace first. Then open Settings → Autopilot to enable it for your business.' : 'Start your Radar trial, then open Settings → Autopilot to enable it for your business. You can turn it off there whenever you want.',
    ],
    ctaLabel: active ? 'Open Autopilot settings' : context.access === 'restart' ? 'Reopen my Radar account' : context.access === 'setup' ? 'Continue setting up Radar' : 'Start my Radar trial',
  };
  if (id === 'article_workflow') return {
    subject: 'What happens before an article goes live',
    preheader: 'I’ll walk you through choosing a topic and reviewing your first draft.',
    heading: 'Know what goes live on your site.',
    paragraphs: [
      'Here’s the review process I’d use for a first article. Follow these steps with Autopilot and Blog autopilot off; enabling either can permit publication without a separate review.',
      ...(active ? [] : [context.access === 'restart' ? 'You can pick this up when you resume your subscription access. Your account is the place to start.' : context.access === 'setup' ? 'First, finish reviewing and saving your Business Profile. Once your workspace is active, you can follow these steps in Content Calendar.' : 'Your saved profile carries into your Radar trial. Start it when you’re ready to try these steps in Content Calendar.']),
    ],
    steps: [
      'Review the proposed topics in Content Calendar. Open one, read who it’s for and what it should answer, then choose Approve & schedule. Radar prepares the draft for you to review.',
      'Read the draft as someone considering your product. Correct the facts, add an example you know firsthand and check its links. Connect your publishing destination, then approve and schedule the article when it’s ready.',
    ],
    progress: 'Follow the topic’s status in Content Calendar after approval and again after scheduling, so you can see where it is in the publishing process.',
    ctaLabel: active ? 'Choose my first article' : context.access === 'restart' ? 'Reopen my Radar account' : context.access === 'setup' ? 'Continue setting up Radar' : 'Start my Radar trial',
  };
  if (id === 'search_refresh') return {
    subject: 'Your next article might be a page you already have',
    preheader: 'Before writing something new, I’d look at the pages people already find.',
    heading: 'There may be a useful next step in an existing page.',
    paragraphs: [
      'Before you spend time on another article, I’d look at what people are already finding on your site. Your Search Console data can help you choose a page worth improving.',
      'I’d investigate a page with impressions and few clicks, or a query around positions 10–20. Read the page and the search results to understand what the searcher expected before deciding what to change.',
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
