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
    case 'start_trial': return ['Start your Radar trial to try this in your workspace.'];
    case 'restart': return ['Resume your subscription access before trying these steps.'];
    case 'setup': return ['Save your Business Profile and activate your workspace before following these steps.'];
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
        preheader: 'A mention and a citation tell you different things. Here’s what to look for.',
        heading: 'Read what the assistant actually says.',
        paragraphs: [
          `An assistant can name ${business} without linking to your site. I’d read the answer itself to understand what it says about you, what it recommends you for and which sources it relies on. Radar collects these answers from ChatGPT, Claude, Gemini, Perplexity and Grok.`,
          ...intro,
        ],
        steps: [
          `Open Performance → AI Visibility and add two buyer questions. Try ${question}. Radar collects answers to a new question as soon as you add it, then checks every question once a week.`,
          'Open a collected answer and follow its citations. Look for whether your business is named, how it is described and which sources support that description. Compare those details with the information on your own site.',
        ],
        ctaLabel: cta('Check my AI visibility'),
      };
    case 'daily_brief':
      return {
        subject: named ? `Add a real example to ${named}’s replies` : 'Add a real example to your replies',
        preheader: 'Bring an example from your own work into the conversation.',
        heading: 'Make the reply worth posting.',
        paragraphs: [
          'A suggested reply is a starting point. Before posting it, I’d add something only you could contribute: an example from your work, a useful detail or an answer to the person’s exact question. Daily Brief brings the threads and draft replies together so you can do that.',
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
        preheader: 'Use search intent to judge which proposed article fits your business.',
        heading: 'What is the searcher trying to do?',
        paragraphs: [
          'Search intent tells you what someone is trying to do when they type a query. I’d use it to decide which proposed article would be useful to a potential customer, alongside the keyword estimates in Radar.',
          ...intro,
        ],
        steps: [
          `Open Content Calendar and compare two proposed topics${keyword ? `, including one around “${keyword}”` : ' that fit what you sell'}. Read each topic’s search intent and keyword estimates. Decide which reader you can help and what the article should answer.`,
          context.gscConnected ? 'Open Performance and read the Queries and Pages tables over the same period. Use the measured impressions and clicks as context for your choice; keep them separate from the estimates attached to proposed topics.' : 'Connect Google Search Console in Settings. Once data is available, read the Queries and Pages tables in Performance to see which searches already bring impressions and clicks. Keep those measurements separate from keyword estimates.',
        ],
        ctaLabel: cta('Review my Content Calendar'),
      };
    case 'social_marketing':
      return {
        subject: named ? `What could ${named} teach in one social post?` : 'What could you teach in one social post?',
        preheader: 'Turn a recurring customer question into a post with an example of your own.',
        heading: 'Put your own experience into the draft.',
        paragraphs: [
          'Think of a question customers ask you repeatedly. I’d use your answer as the basis for a social post, then add an example from your own work. That gives someone a reason to read it and remember your business.',
          ...intro,
        ],
        steps: [
          'Open Social Marketing and choose An idea. Enter one recurring customer question and ask for a post that answers it with a practical example. Generate a pack for the platforms you use.',
          'Edit one draft to include a detail from your business: a choice you made, a trade-off or a real example. Check its image and link, then share it when it’s ready. Review automatic posting settings separately before turning them on.',
        ],
        ctaLabel: cta('Create my social posts'),
      };
    default: throw new Error('Unknown education lesson');
  }
}

/** A progress check closes each lesson without implying any result already exists. */
export function educationProgress(lesson: EducationLessonId): string {
  switch (lesson) {
    case 'ai_visibility': return 'Keep the questions stable and compare their Mentioned and Cited your site counts next week. Not collected means an answer is missing; it is different from an answer that didn’t mention you.';
    case 'daily_brief': return 'Mark a reply posted only after you’ve published it. The copied and posted states show your follow-through; the original thread is where you’ll find responses and follow-up questions.';
    case 'backlinks': return 'Approval and live placement are separate. Backlinks → Live links shows placement and verification status, with Re-check when you need it. Search rankings and AI recommendations can vary.';
    case 'organic_search': return 'After publication, give Search Console time to collect data before comparing the page’s clicks and impressions. An estimate helped you choose the topic; measured activity tells you what happened afterward.';
    case 'social_marketing': return 'Use Radar’s scheduled, posted and failed states to follow the post’s progress. Once it’s posted, read the responses on the platform; a follow-up question can become your next topic.';
    default: throw new Error('Unknown education lesson');
  }
}
