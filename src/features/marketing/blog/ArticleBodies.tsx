import { Figure0, Figure1, Figure2 } from './Figures';
import type { BlogSlug } from '@/lib/marketing-posts';
function DoesChatgptRecommendYou() { return <>

<h2 id="shift">Buyers ask assistants now</h2>
<p>Buyers can research products through ChatGPT, Perplexity, Gemini, Claude or Grok as well as traditional search. An answer may recommend only a few products. Checking the questions your customers ask helps you understand whether your business appears in those particular answers.</p>
<p>There is no single reporting view across every assistant. Controlled prompt checks give you snapshots, not total exposure counts; referral analytics add another view. Google reports traffic from its own AI search features within Search Console’s overall Web results.</p>
<h2 id="prompts">Write the prompts your customers would</h2>
<p>Start with how people describe the problem, not how you describe the product. A founder might say “calendar-based time tracking”. A buyer types “best time tracker for freelance designers who hate timers”.</p>
<ul><li><strong>Recommendation prompts.</strong> “What’s the best tool for…”, “What do freelancers use for…”.</li><li><strong>Comparison prompts.</strong> “Tallyhour vs. alternatives for small studios”.</li><li><strong>Problem prompts.</strong> “How do I track billable hours without a timer?” These rarely name a product in the question, but often in the answer.</li></ul>
<p>Ten to fifteen prompts is plenty to start. Base them on the keywords you already target, since those reflect real demand.</p>
<h2 id="check">Ask more than one assistant, more than once</h2>
<p>Assistants don’t give the same answer twice. Wording shifts, the order changes, and a product mentioned on Monday can be missing on Tuesday. One check tells you very little. A pattern over several days tells you a lot.</p>
<Figure0 />
<p>Track three things for each answer: whether you were <strong>mentioned</strong>, your <strong>position</strong> in the list, and whether your site was <strong>cited</strong> as a source. Keep “not mentioned” separate from “no answer collected”. A missing check isn’t a zero.</p>
<h2 id="why">Why assistants mention some products and not others</h2>
<p>Answers depend on the assistant, query and available sources. These practices can make your public information easier to understand, but they are not a universal formula for selection:</p>
<ul><li><strong>Being described the same way in many places.</strong> Use an accurate, consistent product description wherever your business is listed. This helps readers identify what you offer.</li><li><strong>Pages that answer the question directly.</strong> Answer the reader’s question clearly and specifically. Useful pages serve people whether or not an assistant cites them.</li><li><strong>Being cited by the sources assistants already trust.</strong> Review the citations in your recorded answers to understand which sources were used for those checks.</li></ul>
<blockquote>A useful question you can answer well is a better starting point than a promise of guaranteed AI mentions.</blockquote>
<h2 id="act">Turn useful gaps into better content</h2>
<p>A missing mention is a research lead, not an instruction to publish another page. First check whether an existing article answers the question and can be improved. Create a new page only when you can add a useful, distinct answer; mention your product where it genuinely helps.</p>
<p>Keep a consistent checking method and record the date, assistant and exact prompt. Results can change; neither a timing estimate nor repeated checks guarantees a recommendation.</p>


<p className="po-sources">Further reading: <a href="https://developers.google.com/search/docs/appearance/ai-features">Google AI search guidance</a> and <a href="https://developers.openai.com/api/docs/bots">OpenAI crawler documentation</a>.</p>
</>; }

function PageTwoRefresh() { return <>

<h2 id="why">Why page two matters</h2>
<p>Search Console’s average position is an aggregate, not a promise that a page always appears on a literal second results page. Queries averaging around positions 8–20 can still be useful leads when they have meaningful impressions and a page you can improve.</p>
<p>Treat that range as a prioritization heuristic. It does not prove a refresh is cheaper or faster than new content, and improving a page does not guarantee a higher position.</p>
<h2 id="find">Find your page-two pages in Search Console</h2>
<ol className="po-steps"><li>Open <strong>Performance → Search results</strong> and set the range to the last 3 months.</li><li>Turn on <strong>Average position</strong> and <strong>Impressions</strong> alongside clicks.</li><li>Open the <strong>Queries</strong> tab and export the table. Shortlist rows with average positions around 8–20.</li><li>Sort that shortlist by impressions, then consider relevance and the page’s actual usefulness before choosing work.</li><li>Click a query, then the <strong>Pages</strong> tab, to see which page is ranking for it.</li></ol>
<Figure1 />
<h2 id="diagnose">Diagnose before you rewrite</h2>
<p>Search the query yourself and look at what’s ranking above you. Most page-two pages fall short in one of three ways:</p>
<ul><li><strong>The title doesn’t match the search.</strong> Someone searching “freelance invoice template” wants a template, in formats they can use. A title like “Invoice Template | Fieldnote” doesn’t promise that.</li><li><strong>A section is missing.</strong> If every page above you covers payment terms and yours doesn’t, that’s a gap Google can see.</li><li><strong>It’s out of date.</strong> Old screenshots, last year’s prices, or tools that no longer exist all signal a stale page.</li></ul>
<h2 id="refresh">What a good refresh changes</h2>
<p>A refresh isn’t a rewrite. Keep the URL, keep what works, and fix the specific gap:</p>
<div className="po-two"><div className="bc"><p className="bk mu">Before</p><s>Invoice Template | Fieldnote</s></div><div className="bc"><p className="bk">After</p>Free Freelance Invoice Template (Word, PDF, Google Docs)</div></div>
<ul><li>Rewrite the title and meta description to match what the searcher wants.</li><li>Add the missing section, written as well as the rest.</li><li>Update anything dated, and say when the page was last updated.</li><li>Link to the page from two or three related articles on your site.</li></ul>
<p>If your platform supports it, update the post in place rather than publishing a new one. You keep the history Google already has for that URL.</p>
<h2 id="wait">Give it time, then check</h2>
<p>Allow time for recrawling and collect enough data for a useful comparison. Four to six weeks can be a review interval, not a guarantee that rankings have settled. Compare similar periods and account for seasonality and other changes.</p>
<blockquote>Choose refreshes for a clear reader benefit, then measure what changed rather than assuming every edit will improve rankings.</blockquote>


<p className="po-sources">Further reading: <a href="https://support.google.com/webmasters/answer/7576553">Search Console Performance documentation</a>.</p>
</>; }

function RankANewWebsite() { return <>

<h2 id="why">Why new sites struggle</h2>
<p>A new website often competes with established pages that already answer popular questions well. Google uses many ranking systems and signals; domain age alone does not determine a result, and there is no fixed starting position for a new page.</p>
<p>That’s not a reason to stop writing. It’s a reason to choose topics differently. The goal for the first months isn’t traffic from the biggest keywords. It’s a steady set of pages that rank for smaller, specific searches, and earn the trust that makes bigger ones possible later.</p>
<h2 id="ceiling">Find your difficulty ceiling</h2>
<p>Most keyword tools give each keyword a difficulty score from 0 to 100, estimated from how strong the pages currently ranking for it are. The scores are rough, and they vary between tools, but they’re useful for one decision: what to skip.</p>
<p>Use difficulty as a planning estimate, not a Google score. The ceiling of 34 below is illustrative, not a threshold every new domain should use. Compare actual search results and your ability to provide a better answer before choosing a topic.</p>
<Figure2 />
<p>Specific searches can be valuable when they match the problem you solve. Evaluate relevance and results rather than assuming a particular number of articles will produce a particular amount of traffic.</p>
<h2 id="intent">Pick keywords with a buyer behind them</h2>
<p>Low difficulty isn’t enough on its own. Plenty of easy keywords are easy because nobody who searches them will ever buy anything. Ask one question of every candidate: <strong>would someone searching this plausibly need what we sell?</strong></p>
<ul><li><strong>Problem searches</strong> like “track billable hours without a timer” come from people who already feel the pain.</li><li><strong>How-to searches</strong> like “how to estimate design projects” reach your audience earlier, while they’re building a habit your product supports.</li><li><strong>Template and tool searches</strong> like “freelance invoice template” attract people ready to act, and are naturally linkable.</li></ul>
<p>Broad, definitional searches (“what is time tracking”) may be less useful for your immediate goals. Judge each topic against your audience rather than assuming every broad query behaves the same way.</p>
<h2 id="cadence">Publish on a schedule, not when you can</h2>
<p>Choose a sustainable schedule that leaves time for research, editing and useful examples. A schedule helps your team plan; publishing more frequently is not itself a ranking guarantee.</p>
<p>Plan a month at a time. Thirty topics sounds like a lot, but grouped into a few clusters around your core problems, it’s a map rather than a list. Each article should link to two or three others in its cluster, and to the product page it supports.</p>
<blockquote>Publish at a pace that lets you help the reader well. Quality and relevance matter more than meeting an arbitrary posting quota.</blockquote>
<h2 id="measure">Measure what’s almost working</h2>
<p>Connect <a href="https://search.google.com/search-console">Google Search Console</a> on day one, even before you have traffic. As data becomes available, it can show queries where your pages appear but rarely get clicked. Those are your next moves:</p>
<ul><li>Queries with average positions around 8–20 can help you shortlist pages for review; that range is a heuristic, not a guaranteed quick win. We wrote a <a href="/blog/page-two-refresh">whole guide on that</a>.</li><li>Queries with impressions but no useful matching page are research leads. Check relevance and existing content before deciding whether a new page is warranted.</li></ul>
<p>There is no fixed ranking timeline. Be wary of promises of a particular position by a particular date.</p>


<p className="po-sources">Further reading: <a href="https://developers.google.com/search/docs/appearance/ranking-systems-guide">Google ranking systems</a> and <a href="https://developers.google.com/search/docs/fundamentals/creating-helpful-content">helpful content guidance</a>.</p>
</>; }

function RedditWithoutGettingBanned() { return <>

<h2 id="rules">Read the room first</h2>
<p>Every subreddit is its own community with its own moderators and rules. Some ban self-promotion outright. Some allow it on a weekly thread. Some are fine with a mention if you’re a regular. Reddit’s own site-wide rules prohibit spam and misleading behavior everywhere.</p>
<p>Before you post anywhere, read the sidebar rules and the top posts of the past month. If people in the community would be annoyed to see a founder there, they’ll be annoyed whatever you write.</p>
<h2 id="find">Find questions, not audiences</h2>
<p>The mistake most founders make is looking for subreddits where their customers hang out, then posting about their product. The better approach is looking for <strong>threads</strong> where someone is asking a question you can genuinely answer.</p>
<ul><li>Search Reddit for the problem, in your customers’ words: “track time without a timer”, “how do you price design work”.</li><li>Consider recent, active threads where your reply is still useful. Follow the community’s rules about replying to older discussions.</li><li>Look for questions you can answer with something useful that has not already been said.</li></ul>
<h2 id="write">Write the reply you’d want to read</h2>
<p>Good replies share something specific from experience. They don’t need your product to be useful. Compare:</p>
<div className="po-two"><div className="bc"><p className="bk mu">Pitch</p>Great question! We built Fieldnote to solve exactly this. It’s the best time tracker for designers. Check it out!</div><div className="bc"><p className="bk">Help</p>I stopped running timers. I block my calendar the night before, then spend fifteen minutes on Friday checking it against what actually happened. Less precise minute to minute, far more honest across a week.</div></div>
<p>The second reply is useful to everyone who reads it, including people who will never buy anything. That’s the point. It builds a reputation that makes your profile worth clicking.</p>
<p>A few habits help:</p>
<ul><li>Answer the question in the first sentence.</li><li>Use first person and real detail. “I tried X, it failed because Y” is more credible than any claim.</li><li>Keep it short. A tight paragraph beats an essay.</li><li>No marketing language, hashtags or emoji.</li></ul>
<h2 id="disclose">Disclose, and leave the link out</h2>
<p>Only mention your product when the community permits it and the reference genuinely helps. Disclose your connection, for example: “I work on Fieldnote, so I’m biased, but…”. A disclosure does not override subreddit rules or guarantee that moderators will allow the reply.</p>
<p>Leave the link out. People who are interested will find you from your name or profile. Link-free wording does not automatically make promotion acceptable. Some communities restrict mentions as well as links; check their rules and ask moderators when unsure.</p>
<blockquote>The default should be help without a mention. A mention is a choice you make thread by thread, not a habit.</blockquote>
<h2 id="rhythm">A rhythm that lasts</h2>
<p>There is no universally safe posting quota or guarantee against removal or a ban. Participate where you have something relevant to add, and avoid bulk, repetitive or automated promotional posting.</p>
<p>Keep a short list of the threads you’ve replied to, and check back a day later. Answering follow-up questions is often where the most trust is built.</p>


<p className="po-sources">Further reading: <a href="https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam">Reddit spam guidance</a> and <a href="https://redditinc.com/policies/reddit-rules">Reddit Rules</a>.</p>
</>; }

function SafeBacklinksNewSites() { return <>

<h2 id="why">Why links still matter</h2>
<p>When a relevant site links to yours, it’s a signal that someone outside your company found your page worth pointing to. Google uses links among many signals; their importance depends on context. A link does not guarantee rankings or establish a fixed advantage for a new domain.</p>
<p>The problem is that the quickest ways to get links are also the riskiest.</p>
<h2 id="risk">What counts as a link scheme</h2>
<p>Google’s spam policies describe link schemes as links intended to manipulate rankings. The ones founders run into most often:</p>
<ul><li><strong>Buying links that pass ranking credit,</strong> whether for money, free products or services, without marking them.</li><li><strong>Excessive link exchanges,</strong> “I’ll link to you if you link to me” at scale, regardless of relevance.</li><li><strong>Automated link programs,</strong> networks and tools that create links for you.</li><li><strong>Keyword-stuffed anchors,</strong> links that all use the exact phrase you want to rank for.</li></ul>
<p>Sites caught in schemes can lose rankings, and the links themselves can be ignored. There is no reliable fixed recovery timeline.</p>
<blockquote>A safe link is one you’d be comfortable explaining to the reader who clicks it.</blockquote>
<h2 id="safe">Links worth earning</h2>
<p>The links that last are earned by having something worth linking to:</p>
<ul><li><strong>Useful assets.</strong> Templates, calculators and checklists get linked naturally, because they save the reader time.</li><li><strong>Things only you know.</strong> If your product gives you real, aggregated data, share what it shows. Never make up numbers.</li><li><strong>Adjacent businesses.</strong> A pricing guide for designers can genuinely link to a good invoice template. Find businesses that serve the same people without competing with you.</li><li><strong>Community presence.</strong> Helpful answers in forums and newsletters lead to mentions you didn’t ask for.</li></ul>
<h2 id="open">If you trade links, do it in the open</h2>
<p>Relevance and disclosure do not by themselves make a link arrangement compliant. Exchanges designed primarily to manipulate rankings, especially excessive or automated schemes, remain risky. Choose placements for readers rather than promised ranking credit.</p>
<div className="po-two"><div className="bc"><p className="bk mu">Risky</p>Swapping links with any site that asks, hidden in footers, with exact-match anchors and no disclosure.</div><div className="bc"><p className="bk">Honest</p>A link placed where it helps the reader, approved by both sides, disclosed as a partner link and marked <code>rel="sponsored"</code>.</div></div>
<p>Google documents link attributes for different relationships: <code>rel="sponsored"</code> for advertising or paid placements, <code>rel="ugc"</code> for user-generated content, and <code>rel="nofollow"</code> when you don’t want to vouch for a link. Qualifying a link does not guarantee rankings or overall policy compliance. Links can still help readers discover a useful resource; do not sell them as ranking guarantees.</p>
<h2 id="check">Keep an eye on what’s live</h2>
<p>Links disappear. Pages get redesigned, posts get deleted, and partners forget. Check your important links every week or two, and ask politely when one goes missing. Search Console’s <strong>Links</strong> report shows which sites link to you, though it updates slowly.</p>
<p>Be patient. A handful of relevant, honest links over a few months is worth more than hundreds of questionable ones overnight.</p>


<p className="po-sources">Further reading: <a href="https://developers.google.com/search/docs/essentials/spam-policies#link-spam">Google link-spam policy</a> and <a href="https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links">outbound link guidance</a>.</p>
</>; }
const BODIES = {
"does-chatgpt-recommend-you": DoesChatgptRecommendYou,
"page-two-refresh": PageTwoRefresh,
"rank-a-new-website": RankANewWebsite,
"reddit-without-getting-banned": RedditWithoutGettingBanned,
"safe-backlinks-new-sites": SafeBacklinksNewSites
} satisfies Record<BlogSlug, () => React.JSX.Element>;
export function ArticleBody({ slug }: { slug: BlogSlug }) { const Body = BODIES[slug]; return <Body />; }
