/** Public editorial metadata only: no React, session, SEO or customer-data imports. */
export type FeaturePath = '/features/daily-brief' | '/features/organic-search' | '/features/ai-visibility' | '/features/social-marketing' | '/features/performance' | '/features/backlinks';
export interface BlogPostMeta { slug: string; title: string; description: string; dek: string; category: string; date: string; dateModified: string; readTime: number; related: readonly [string, string]; cta: { label: string; headline: string; description: string; href: FeaturePath }; toc: readonly { id: string; label: string }[] }
export const BLOG_POSTS = [
  {
    "slug": "does-chatgpt-recommend-you",
    "title": "How to find out if ChatGPT recommends your product",
    "description": "AI assistants are a new front door for buyers. How to check whether ChatGPT, Perplexity, Gemini, Claude and Grok mention your product, and what to do when they don’t.",
    "dek": "AI assistants are a new front door for buyers. A simple way to check whether yours is open, and what to do when it isn’t.",
    "category": "AI visibility",
    "date": "2026-11-02",
    "dateModified": "2026-11-03",
    "readTime": 7,
    "related": [
      "rank-a-new-website",
      "page-two-refresh"
    ],
    "cta": {
      "label": "AI visibility in Radar",
      "headline": "Radar asks five assistants your customers’ questions every night.",
      "description": "See where you’re mentioned, where you’re cited, and turn every gap into a topic.",
      "href": "/features/ai-visibility"
    },
    "toc": [
      {
        "id": "shift",
        "label": "Buyers ask assistants now"
      },
      {
        "id": "prompts",
        "label": "Write your customers’ prompts"
      },
      {
        "id": "check",
        "label": "Ask more than once"
      },
      {
        "id": "why",
        "label": "Why some products get named"
      },
      {
        "id": "act",
        "label": "Improve useful content gaps"
      }
    ]
  },
  {
    "slug": "rank-a-new-website",
    "title": "How to rank a new website when Google doesn’t know you yet",
    "description": "Big sites own the obvious keywords. How a new domain finds the keywords it can realistically win, publishes on a schedule, and builds from there.",
    "dek": "Big sites own the obvious keywords. Here’s how a new domain finds the ones it can actually win, and builds from there.",
    "category": "Organic search",
    "date": "2026-10-27",
    "dateModified": "2026-11-03",
    "readTime": 8,
    "related": [
      "page-two-refresh",
      "safe-backlinks-new-sites"
    ],
    "cta": {
      "label": "Organic search in Radar",
      "headline": "A month of articles aimed at keywords your site can realistically compete for.",
      "description": "Radar sets your ceiling, plans the topics and publishes after you approve.",
      "href": "/features/organic-search"
    },
    "toc": [
      {
        "id": "why",
        "label": "Why new sites struggle"
      },
      {
        "id": "ceiling",
        "label": "Find your ceiling"
      },
      {
        "id": "intent",
        "label": "Keywords with a buyer behind them"
      },
      {
        "id": "cadence",
        "label": "Publish on a schedule"
      },
      {
        "id": "measure",
        "label": "Measure what’s almost working"
      }
    ]
  },
  {
    "slug": "reddit-without-getting-banned",
    "title": "How to market on Reddit without getting banned",
    "description": "A founder’s guide to relevant Reddit threads, useful replies, disclosure and community rules. No posting cadence or wording guarantees protection from a ban.",
    "dek": "A founder’s guide to useful replies, disclosure and community rules in the threads where buyers ask.",
    "category": "Communities",
    "date": "2026-10-20",
    "dateModified": "2026-11-03",
    "readTime": 7,
    "related": [
      "does-chatgpt-recommend-you",
      "rank-a-new-website"
    ],
    "cta": {
      "label": "Daily Brief in Radar",
      "headline": "Conversations worth joining, every morning.",
      "description": "Radar finds threads where you can help, with replies drafted in your voice. Reddit drafts never include links.",
      "href": "/features/daily-brief"
    },
    "toc": [
      {
        "id": "rules",
        "label": "Read the room first"
      },
      {
        "id": "find",
        "label": "Find questions, not audiences"
      },
      {
        "id": "write",
        "label": "Write the reply you’d want"
      },
      {
        "id": "disclose",
        "label": "Disclose, and leave the link out"
      },
      {
        "id": "rhythm",
        "label": "A rhythm that lasts"
      }
    ]
  },
  {
    "slug": "page-two-refresh",
    "title": "How to refresh pages ranking on page two",
    "description": "Use Search Console average-position data to shortlist pages for a focused refresh. Diagnose reader needs, improve the page and measure what changes.",
    "dek": "Use Search Console to find pages worth reviewing, diagnose useful changes and measure the result.",
    "category": "Search Console",
    "date": "2026-10-13",
    "dateModified": "2026-11-03",
    "readTime": 6,
    "related": [
      "rank-a-new-website",
      "does-chatgpt-recommend-you"
    ],
    "cta": {
      "label": "Performance in Radar",
      "headline": "Search Console data, with your next move spelled out.",
      "description": "Radar highlights page-two queries, suggests the refresh and adds it to your calendar for review.",
      "href": "/features/performance"
    },
    "toc": [
      {
        "id": "why",
        "label": "Why page two matters"
      },
      {
        "id": "find",
        "label": "Find your page-two pages"
      },
      {
        "id": "diagnose",
        "label": "Diagnose before you rewrite"
      },
      {
        "id": "refresh",
        "label": "What a good refresh changes"
      },
      {
        "id": "wait",
        "label": "Give it time"
      }
    ]
  },
  {
    "slug": "safe-backlinks-new-sites",
    "title": "Backlinks for new sites: what’s safe and what isn’t",
    "description": "Links still help Google trust a site. How a new domain can earn them honestly, what counts as a link scheme, and how to mark partner links correctly.",
    "dek": "Links still help Google trust a site. Here’s how to earn them without the shortcuts that put a new domain at risk.",
    "category": "Backlinks",
    "date": "2026-10-06",
    "dateModified": "2026-11-03",
    "readTime": 7,
    "related": [
      "rank-a-new-website",
      "page-two-refresh"
    ],
    "cta": {
      "label": "Backlinks network in Radar",
      "headline": "Reputation, earned honestly.",
      "description": "An optional network of relevant businesses. Review links yourself or enable rules-based auto-approval; network links stay disclosed.",
      "href": "/features/backlinks"
    },
    "toc": [
      {
        "id": "why",
        "label": "Why links still matter"
      },
      {
        "id": "risk",
        "label": "What counts as a link scheme"
      },
      {
        "id": "safe",
        "label": "Links worth earning"
      },
      {
        "id": "open",
        "label": "Trade links in the open"
      },
      {
        "id": "check",
        "label": "Watch what’s live"
      }
    ]
  }
] as const satisfies readonly BlogPostMeta[];
export type BlogSlug = typeof BLOG_POSTS[number]['slug'];
export function getPost(slug: string) { return BLOG_POSTS.find(post => post.slug === slug); }
export function editorialDate(date: string): string { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z')); }
