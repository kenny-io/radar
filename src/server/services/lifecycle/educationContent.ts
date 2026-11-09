/** Plain-text lesson copy. The shared mail renderer owns escaping, links and the email frame. */
export const EDUCATION_LESSONS = ['ai_visibility', 'daily_brief', 'backlinks', 'organic_search', 'social_marketing'] as const;
export type EducationLessonId = typeof EDUCATION_LESSONS[number];
export interface EducationContext {
  businessName?: string;
  industry?: string;
  offering?: string;
  audience?: string;
  keyword?: string;
  gscConnected: boolean;
  access: 'workspace' | 'start_trial' | 'restart' | 'setup';
}
export interface EducationLessonContent {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  steps: string[];
  ctaLabel: string;
}

// Profile text is user-controlled. Keep subjects and examples compact and free of header control characters.
const clean = (value: string | undefined, max = 80) => value?.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || '';
const accessNote = (access: EducationContext['access']) => {
  switch (access) {
    case 'workspace': return [];
    case 'start_trial': return ['Your saved Business Profile gives you a starting point. When you’re ready, start your Radar trial and try the steps below.'];
    case 'restart': return ['You can pick this up when your Radar workspace is available again. Open your account to resume your subscription access first.'];
    case 'setup': return ['Start by adding your website and checking the Business Profile Radar creates. That gives Radar the context to help with the steps below once your workspace is active.'];
  }
};

export function renderEducationLesson(lesson: EducationLessonId, context: EducationContext): EducationLessonContent {
  const business = clean(context.businessName) || 'your business';
  const named = clean(context.businessName);
  const offering = clean(context.offering, 100);
  const audience = clean(context.audience, 100);
  const keyword = clean(context.keyword, 100);
  const question = offering && audience ? `“What should ${audience} look for when choosing ${offering}?”`
    : offering ? `“What should I look for when choosing ${offering}?”` : 'a question someone would ask when choosing a product like yours';
  const ready = context.access === 'workspace';
  const cta = (label: string) => ready ? label : context.access === 'setup' ? 'Continue setting up Radar' : context.access === 'restart' ? 'Reopen my Radar account' : 'Start my Radar trial';
  const intro = accessNote(context.access);
  switch (lesson) {
    case 'ai_visibility':
      return {
        subject: named ? `Does ChatGPT or Claude recommend ${named}?` : 'Does ChatGPT or Claude recommend your business?',
        preheader: 'I’d start with two questions a potential customer might ask.',
        heading: 'Let’s see what AI says about your business.',
        paragraphs: [
          `I want to help you see what someone might hear about ${business} before they ever reach your site. Start with a question they’d ask while choosing a product like yours.`,
          'Radar can collect the answers from ChatGPT, Claude, Gemini, Perplexity and Grok. Read the answers and their sources to find a question your own experience could help answer.',
          ...intro,
        ],
        steps: [
          `Open Performance → AI Visibility and add two buyer questions. Try ${question}. New questions are collected overnight. You can also open a result and choose Collect now to request an answer sooner.`,
          'Read one answer and its citations. Pick a question where your experience would add something useful, then add it to Content Calendar. Review the article before publishing it on your site.',
        ],
        ctaLabel: cta('Check my AI visibility'),
      };
    case 'daily_brief':
      return {
        subject: named ? `Find a conversation ${named} can help with` : 'Find one conversation you can help with',
        preheader: 'One useful reply is a good place to start. Here’s how I’d use Daily Brief.',
        heading: 'Help one person with a question you know.',
        paragraphs: [
          'I built Daily Brief to help you find people already talking about problems you can solve. It brings relevant conversations from Reddit, X, LinkedIn and Hacker News into Radar, with a suggested reply you can make your own.',
          'I’d start with one thread where you have something useful to add. Give the person a good answer before thinking about whether to mention your product.',
          ...intro,
        ],
        steps: [
          'Open Daily Brief and read the original thread for one promising conversation. Edit the suggested reply to answer the person’s question. Add an example or detail from your own knowledge.',
          'Copy the reply, post it in the conversation and mark it posted in Radar. Build up to five useful replies this week if you find five good fits. Mention your product when it helps, and disclose your connection to it.',
        ],
        ctaLabel: cta('Open my Daily Brief'),
      };
    case 'backlinks':
      return {
        subject: named ? `How ${named} could appear on another site` : 'How your business could appear on another site',
        preheader: 'I’d look for a mention that helps the other site’s reader.',
        heading: 'Help the right reader find you.',
        paragraphs: [
          `Someone reading another founder’s site could be looking for exactly what ${business} offers. I built the Backlinks network to help participating businesses find relevant places to mention each other.`,
          'My advice is to judge each suggestion as a reader. You can see the page and proposed sentence before deciding whether the link belongs there.',
          ...intro,
        ],
        steps: [
          'Open Backlinks and join the network if you haven’t already. Choose topics that fit your business and review your preferences for links from your site. Keep manual approval while you learn how the proposals work.',
          'When a proposal arrives, read the surrounding sentence and open the destination. Check the anchor, disclosure and link attribute. Approve a mention that helps the reader, or decline it. The partner may still need to place an approved link.',
        ],
        ctaLabel: cta('Explore my backlink network'),
      };
    case 'organic_search':
      return {
        subject: named ? `What should ${named} publish next?` : 'What should you publish next?',
        preheader: 'Here’s how I’d choose one useful question for your next article.',
        heading: 'Choose a question your next customer might ask.',
        paragraphs: [
          'I’d start by choosing one question a potential customer needs help with. A useful answer gives them a reason to discover your business.',
          'In Radar, your target keywords sit alongside proposed topics in Content Calendar. Use them to choose a question you can answer well and a reader who has a reason to know your business.',
          ...intro,
        ],
        steps: [
          `Open Content Calendar and compare two proposed topics${keyword ? `, including one around “${keyword}”` : ' that fit what you sell'}. Read the search intent and keyword estimates. Pick the question where you have a useful answer and a clear reason for that reader to know your business.`,
          `Check whether your site already answers that question. Approve & schedule a suitable topic, or add one that fits better. ${context.gscConnected ? 'Use the Queries and Pages tables in Performance to compare your plan with measured search activity.' : 'Connect Google Search Console in Settings when you want to compare the plan with measured search activity.'}`,
        ],
        ctaLabel: cta('Review my Content Calendar'),
      };
    case 'social_marketing':
      return {
        subject: named ? `Put ${named}’s article to work on social` : 'Put your article to work on social',
        preheader: 'I’d give a useful article another chance to reach someone.',
        heading: 'Let’s get more use from what you’ve written.',
        paragraphs: [
          'I want to help you get more use from the work you’ve already put into an article. A practical example or an answer inside it can make a useful social post on its own.',
          'Radar can turn those ideas into posts for your connected X and LinkedIn accounts. I’d start with one point you’d want a potential customer to remember.',
          ...intro,
        ],
        steps: [
          'Open Social Marketing and generate a pack from an article you want to share. If you haven’t written one yet, choose Suggest ideas for ideas based on your Business Profile. Read each post as someone who hasn’t seen the article.',
          'Check the wording, image and destination link. Publish one post now or schedule it for a time you choose. You can also copy it to share yourself. Review automatic posting settings separately before turning them on.',
        ],
        ctaLabel: cta('Create my social posts'),
      };
    default: throw new Error('Unknown education lesson');
  }
}

/** A progress check closes each lesson without implying any result already exists. */
export function educationProgress(lesson: EducationLessonId): string {
  switch (lesson) {
    case 'ai_visibility': return 'Here’s how I’d track it: note the Mentioned and Cited your site counts, then compare the same questions next week. Keep the questions stable. Not collected means an answer is still missing; it is separate from an answer that didn’t mention you.';
    case 'daily_brief': return 'Here’s how I’d track it: use the copied and posted states to track your follow-through. Return to the original threads for replies and follow-up questions. Mark a reply posted after you’ve published it.';
    case 'backlinks': return 'Here’s how I’d track it: open Backlinks → Live links for placement and verification status. Use Re-check if a link needs attention. Judge each link by its relevance to readers; search rankings and AI recommendations can vary.';
    case 'organic_search': return 'Here’s how I’d track it: follow the article’s status in Content Calendar. When Search Console data is available, compare the page’s clicks and impressions over time. Keep keyword estimates separate from measured results.';
    case 'social_marketing': return 'Here’s how I’d track it: check the post’s scheduled, posted or failed state in Radar. Once it’s posted, open it on the platform to read reactions and replies.';
    default: throw new Error('Unknown education lesson');
  }
}
