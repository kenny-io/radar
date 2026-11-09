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
    case 'start_trial': return ['When you’re ready to try this, start your Radar trial, then follow the steps below. You’ll see the price before confirming.'];
    case 'restart': return ['To put this into practice, reopen Radar and restart your access. You’ll see the amount due before confirming.'];
    case 'setup': return ['Start by adding your website in Radar and reviewing your Business Profile. Once your workspace is active, try the steps below.'];
  }
};

export function renderEducationLesson(lesson: EducationLessonId, context: EducationContext): EducationLessonContent {
  const business = clean(context.businessName) || 'your business';
  const named = clean(context.businessName);
  const offering = clean(context.offering, 100);
  const audience = clean(context.audience, 100);
  const keyword = clean(context.keyword, 100);
  const question = offering && audience ? `“Which ${offering} would you recommend for ${audience}?”`
    : offering ? `“What should I look for when choosing ${offering}?”` : 'a question a buyer would ask when comparing products like yours';
  const ready = context.access === 'workspace';
  const cta = (label: string) => ready ? label : context.access === 'setup' ? 'Continue setting up Radar' : context.access === 'restart' ? 'Reopen my Radar account' : 'Start my Radar trial';
  const intro = accessNote(context.access);
  switch (lesson) {
    case 'ai_visibility':
      return {
        subject: named ? `Does ChatGPT or Claude recommend ${named}?` : 'Does ChatGPT or Claude recommend your business?',
        heading: 'Ask the questions your buyers ask.',
        paragraphs: [
          `When someone asks an AI assistant for a recommendation, does ${business} make the answer? Radar’s AI Visibility lets you inspect responses from ChatGPT, Claude, Gemini, Perplexity and Grok, including the sources they cite.`,
          ...intro,
        ],
        steps: [
          `Open Performance → AI Visibility. Add two questions a buyer might ask before finding you. Start with ${question}. New questions are collected overnight; open a result and use Collect now if you want to request an answer sooner.`,
          'If an answer doesn’t mention you, read it and inspect its citations. Choose one tracked question you can answer well, add it as a Content Calendar topic, and review the resulting article before publishing. If you appear in every answer, choose a question where your own site hasn’t been cited.',
        ],
        ctaLabel: cta('Check my AI visibility'),
      };
    case 'daily_brief':
      return {
        subject: named ? `Five conversations ${named} could join this week` : 'Find five conversations you can help with',
        heading: 'You don’t have to start every conversation.',
        paragraphs: [
          'People are already asking questions, comparing tools and describing problems on Reddit, X, LinkedIn and Hacker News. Daily Brief finds relevant conversations and drafts replies in your voice. Your job is to decide where you have something useful to add.',
          ...intro,
        ],
        steps: [
          'Open Daily Brief and review today’s conversations. Aim to find five you can help with; fewer thoughtful replies are better than forcing five. Read each original thread and edit the draft so it answers that person’s actual question.',
          'Copy a reply and post it in the original conversation, then mark it posted in Radar. Mention your product only when it helps answer the question, and be clear about your connection to it. Repeat this on days you have something useful to add.',
        ],
        ctaLabel: cta('Open my Daily Brief'),
      };
    case 'backlinks':
      return {
        subject: named ? `Could another founder’s site introduce ${named}?` : 'Could another founder’s site introduce your business?',
        heading: 'Make the introduction fit the article.',
        paragraphs: [
          `A reader discovering a related business could also be a good fit for ${business}. Radar’s optional Backlinks network proposes relevant mentions between participating businesses, with the exact sentence and destination visible for review.`,
          ...intro,
        ],
        steps: [
          'Open Backlinks and join the network if you haven’t already. Choose the topics that fit your business and review the rules for links from your site. Keep manual approval while you get familiar with the proposals.',
          'Review a proposal when one is available: read the page context, check the destination, anchor, disclosure and link attribute, then approve it only if the mention is useful. An approval can still require the partner to place the link; it isn’t proof the link is live.',
        ],
        ctaLabel: cta('Explore my backlink network'),
      };
    case 'organic_search':
      return {
        subject: named ? `What should ${named} publish next?` : 'What should you publish next?',
        heading: 'Give your next article a clear job.',
        paragraphs: [
          'The next useful article starts with a question your customers need answered. Radar’s Content Calendar turns your Business Profile and target keywords into a plan you can review, with research and drafting handled in the same workflow.',
          ...intro,
        ],
        steps: [
          `Open Content Calendar and review one proposed topic${keyword ? ` around “${keyword}”` : ' that matches what you sell'}. Check the search intent, audience and whether you already cover it. Approve & schedule a useful topic, or add a better one.`,
          `When the draft is ready, check its facts, examples and links. Connect your blog if needed, then approve the article for publication. ${context.gscConnected ? 'Open Performance to review your synced Search Console data for that page.' : 'Connect Google Search Console in Settings to measure how your pages perform once data is available.'}`,
        ],
        ctaLabel: cta('Review my Content Calendar'),
      };
    case 'social_marketing':
      return {
        subject: named ? `Give ${named}’s next article another outing` : 'Give your next article another outing',
        heading: 'One useful idea can become several posts.',
        paragraphs: [
          'Your article may contain an answer, a practical example and a point worth discussing. Social Marketing helps turn those ideas into posts you can review and publish to your connected X and LinkedIn accounts.',
          ...intro,
        ],
        steps: [
          'Open Social Marketing and generate a pack from a blog article you want more people to read. If you don’t have an article ready, choose Suggest ideas for ideas based on your Business Profile. Choose the channels and check that each post makes sense on its own.',
          'Edit the wording, image and destination link, then publish a post or choose a time to schedule it. Review automatic posting settings separately before enabling them. You can also copy a post and share it yourself.',
        ],
        ctaLabel: cta('Create my social posts'),
      };
    default: throw new Error('Unknown education lesson');
  }
}

/** A progress check closes each lesson without implying any result already exists. */
export function educationProgress(lesson: EducationLessonId): string {
  switch (lesson) {
    case 'ai_visibility': return 'Check progress: record the Mentioned and Cited your site counts for the same questions, then compare next week. Keep the questions stable. Not collected means no answer was collected, not zero visibility; a mention or citation isn’t guaranteed.';
    case 'daily_brief': return 'Check progress: use Radar’s copied/posted states to track your follow-through. Revisit the original threads for responses. Copying a draft alone doesn’t mean it was posted or that anyone engaged.';
    case 'backlinks': return 'Check progress: look in Backlinks → Live links for placement and verification status. Use Re-check when a link needs attention. A network link doesn’t guarantee a search ranking or an AI recommendation.';
    case 'organic_search': return 'Check progress: follow the article’s status in Content Calendar. In Performance, compare Search Console clicks and impressions for its page over time. New pages need time and data; keyword estimates aren’t measured results.';
    case 'social_marketing': return 'Check progress: check each post’s scheduled, posted or failed state in Radar, then open the published post for reactions and replies. Scheduling a post doesn’t mean it has published successfully.';
    default: throw new Error('Unknown education lesson');
  }
}
