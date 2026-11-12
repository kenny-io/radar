// Synthetic article and prose for the gate and fidelity tests. Nothing here is customer content: the place, the people
// and every number are invented, and the filler prose is generated from a fixed word list with a seeded generator.
import type { Block } from '@/lib/types';
import type { PublishPayload } from '../../types';
import { blocksToHtml, blocksToMarkdown } from '../../render';

/** A hand-written article with the punctuation that format conversion has to survive: an em dash (U+2014), curly quotes
 *  and apostrophes, an ampersand, an angle bracket, an accented word, thousands separators and Markdown-special characters. */
export const ARTICLE: Block[] = [
  ['p', 'Larkfield Commons sits ten minutes from the ferry terminal, and most people who tour it ask the same question first: is the quieter north block worth the higher rent? This review covers what we measured over six weeks — noise, transit, upkeep and the true monthly cost.'],
  ['p', 'We did not rely on the listing copy. Two of our writers stayed in a one-bedroom unit, logged every maintenance request, and compared the building’s published fees with what tenants actually paid during the same period.'],
  ['h2', 'What living at Larkfield Commons is like'],
  ['p', 'The lobby is staffed from seven in the morning until eleven at night, and parcels are signed for at the desk rather than left in the corridor. Residents told us the lifts are the weak point: one of the three was out of service for nine of the forty-two days we stayed.'],
  ['p', 'Inside the flats the finish is plain but durable. Kitchens have induction hobs and a full-size oven, storage is generous for the floor area, and every unit we saw had a small balcony that fits two chairs & a folding table.'],
  ['h3', 'Noise & light'],
  ['p', 'We recorded sound levels at three points each evening. The north block stayed under 40 decibels after nine, which is about as quiet as a library, while the south block averaged 52 on market nights because the stalls stay open late.'],
  ['ul', [
    'North block: quiet after 9 pm, with double glazing on every window',
    'South block: livelier, facing the café terrace and the weekend market',
    'Corner units: the brightest rooms, but expect warmer afternoons in July and August',
  ]],
  ['h2', 'Costs you should plan for'],
  ['p', 'Advertised rent is only part of the bill. The service charge is fixed for twelve months, but chilled water is metered per flat, and tenants on the upper floors paid noticeably more in summer than the brochure’s “typical” figure suggests.'],
  ['ul', [
    'Studio: from 1,150 per month',
    'One bedroom: from 1,480 per month',
    'Two bedroom: from 2,050 per month',
    'Covered parking: 95 per month for each bay',
  ]],
  ['p', 'Budget for a deposit equal to five weeks of rent, a one-time access card fee of 60, and contents insurance, which the lease requires but the agent rarely mentions. If the total is < 30% of your take-home pay, the building is comfortably affordable.'],
  ['h2', 'Transit, schools and daily errands'],
  ['p', 'The ferry runs every twenty minutes at peak times and the crossing takes eleven. Bus route 14 stops outside the south gate and reaches the central station in about a quarter of an hour, although the last departure on weekdays is at 23:10.'],
  ['p', 'Two primary schools are within walking distance, and the nearer one publishes its catchment map every spring. For groceries there is a mid-size supermarket on the ground floor of the neighbouring tower, plus a covered market on Saturdays that sells produce from farms upriver.'],
  ['h2', 'Who should rent here'],
  ['p', 'Larkfield Commons suits people who value a short commute and a managed building over character. Couples and remote workers were the happiest residents we met; families liked the schools but wanted a third bedroom that the building does not offer.'],
  ['p', 'If you are sensitive to noise, ask for the north block and visit on a Saturday evening before you sign. If you drive daily, confirm a parking bay in writing, because the waiting list was eleven names long when we checked.'],
  ['h2', 'Frequently asked questions'],
  ['h3', 'Is the deposit refundable?'],
  ['p', 'Yes. The deposit is returned within thirty days of the final inspection, less any documented repairs, and the managing agent must send an itemised statement with photographs for every deduction.'],
  ['h3', 'Can I keep a pet?'],
  ['p', 'One cat or one dog under 15 kilograms is allowed with written consent and a refundable pet deposit. Tenants in the south block reported no trouble getting approval, though the process took close to three weeks.'],
];

/** Reworded versions of three paragraphs of ARTICLE, keyed by block index: the same facts in other words, as a model that
 *  "improves" prose would write them. The gate has to refuse these. */
export const PARAPHRASED: Record<number, string> = {
  3: 'Staff are on the front desk between 7am and 11pm, where deliveries get signed in instead of being dumped in hallways. According to residents, the elevators are the main problem, since one of three was broken for nine days out of the forty-two we were there.',
  9: 'The rent you see advertised does not tell the whole story. While the service charge stays the same all year, each apartment has its own chilled water meter, so people living higher up ended up with much bigger summer bills than the brochure implies.',
  16: 'This building is a good match for anyone who cares more about an easy commute and professional management than charm. The most satisfied tenants we spoke to were couples and people working from home, whereas families praised the schools yet wished for a third bedroom.',
};

// ---------------------------------------------------------------------------------------------------------------------
// Generated filler: peer records, padding, and long articles for threshold cases.

export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = ('harbour lantern meadow quarry timber orchard cobble ferry granite willow copper saffron linen marble thistle ember juniper canal '
  + 'bakery terrace cellar attic garden stairwell courtyard avenue district tenant landlord lease deposit invoice survey inspector repair plumber '
  + 'window balcony corridor kitchen laundry storage parking bicycle commute timetable platform station market grocer school clinic library '
  + 'quiet bright narrow spacious modern older renovated draughty sunny shaded central remote steady seasonal typical reliable modest generous '
  + 'measure compare record review visit inspect renew negotiate budget arrange confirm expect notice prefer consider recommend avoid include '
  + 'morning evening weekend summer winter monthly yearly often rarely usually slowly quickly nearly roughly certainly').split(' ');
const GLUE = ['the', 'a', 'of', 'and', 'with', 'for', 'near', 'that', 'this', 'when', 'while', 'after', 'before', 'in', 'on', 'to'];
const pick = <T>(random: () => number, list: readonly T[]) => list[Math.floor(random() * list.length)];

export function sentence(random: () => number): string {
  const length = 9 + Math.floor(random() * 9);
  const words: string[] = [];
  for (let i = 0; i < length; i++) words.push(i % 3 === 1 ? pick(random, GLUE) : pick(random, WORDS));
  const text = words.join(' ');
  return text[0].toUpperCase() + text.slice(1) + '.';
}
export function paragraph(random: () => number, sentences = 3 + Math.floor(random() * 2)): string {
  return Array.from({ length: sentences }, () => sentence(random)).join(' ');
}
export function phrase(random: () => number, words = 3 + Math.floor(random() * 3)): string {
  const text = Array.from({ length: words }, (_, i) => (i === 1 ? pick(random, GLUE) : pick(random, WORDS))).join(' ');
  return text[0].toUpperCase() + text.slice(1);
}
/** A generated article with `sections` sections: an h2, two or three paragraphs and, in every other section, a list. */
export function generatedArticle(seed: number, sections: number): Block[] {
  const random = seeded(seed);
  const blocks: Block[] = [['p', paragraph(random)]];
  for (let s = 0; s < sections; s++) {
    blocks.push(['h2', phrase(random)]);
    for (let p = 0; p < 2 + (s % 2); p++) blocks.push(['p', paragraph(random)]);
    if (s % 2 === 0) blocks.push(['ul', Array.from({ length: 3 }, () => sentence(random).slice(0, -1))]);
  }
  return blocks;
}

// ---------------------------------------------------------------------------------------------------------------------
// Payload

export const SOURCES = [
  { title: 'Regional tenancy deposit rules', url: 'https://housing.example.org/guides/deposit-rules?edition=2026&lang=en' },
  { title: 'Ferry timetable, winter season', url: 'https://transit.example.net/ferry/timetable' },
];
export const VIDEOS = [{ id: 'Qm3xT7kLp9A', title: 'A walk through a riverside rental', channel: 'Example Rentals', url: 'https://www.youtube.com/watch?v=Qm3xT7kLp9A' }];
export const BODY_IMAGE = { id: 'img-1', after: { heading: 'Costs you should plan for', occurrence: 0, block: 8 }, url: 'https://files.radar.example/b_demo/body/costs-chart.png', alt: 'Monthly cost breakdown', prompt: '', seed: 1 };

/** Built with the real renderers, exactly as publisher.ts builds a payload. */
export function payloadFor(blocks: Block[] = ARTICLE, overrides: Partial<PublishPayload> = {}): PublishPayload {
  const sources = overrides.sources ?? SOURCES;
  const videos = overrides.videos ?? VIDEOS;
  const bodyImages = overrides.bodyImages ?? [BODY_IMAGE];
  const options = { sources: sources.map(source => ({ ...source, use: 'cited' })), videos, bodyImages };
  return {
    entryId: 'e_fixture01', title: 'Larkfield Commons review: costs, noise and who it suits', slug: 'larkfield-commons-review',
    html: blocksToHtml(blocks, options), markdown: blocksToMarkdown(blocks, options), blocks, bodyImages,
    meta: 'An independent six-week review of Larkfield Commons covering rent, fees, noise and transport.', seoTitle: 'Larkfield Commons Review',
    keyword: 'larkfield commons review', date: '2026-11-12', image: null, canonical: null, mode: 'new', refreshUrl: null, sources, videos, author: 'Example Rentals',
    ...overrides,
  };
}
