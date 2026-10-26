// Constants shared by client and server. Copy is verbatim from the prototype (the copy deck).
import type { CalendarSettings, ConnType, EntryStatus, Platform, BriefPlatform, BriefAccount, AiEngine } from './types';

/* ── AI models (Settings → AI models is the ONLY place these names render) ── */
export const AI_MODELS = [
  { p: 'Anthropic', list: [
    { id: 'claude-fable-5.1', l: 'Claude Fable 5.1', d: 'Anthropic’s most capable model. Slowest and highest cost.' },
    { id: 'claude-opus-5.5', l: 'Claude Opus 5.5', d: 'Deep reasoning and careful judgment on tone.' },
    { id: 'claude-sonnet-5.5', l: 'Claude Sonnet 5.5', d: 'Fast and capable for everyday writing.' },
    { id: 'claude-haiku-5.5', l: 'Claude Haiku 5.5', d: 'Fastest and lowest cost.' }] },
  { p: 'OpenAI', list: [
    { id: 'gpt-6-astra', l: 'GPT-6 Astra', d: 'OpenAI’s most capable model. Highest cost.' },
    { id: 'gpt-6.1-sol', l: 'GPT-6.1 Sol', d: 'Near-Astra quality on complex work, at lower cost.' },
    { id: 'gpt-6-sol', l: 'GPT-6 Sol', d: 'Strong on complex, multi-step analysis at lower cost.' },
    { id: 'gpt-6-luna', l: 'GPT-6 Luna', d: 'Built for quick, high-volume tasks.' }] },
  { p: 'SpaceX', list: [
    { id: 'grok-4.7', l: 'Grok 4.7', d: 'SpaceX’s newest flagship for knowledge work.' },
    { id: 'grok-4.6', l: 'Grok 4.6', d: 'Previous Grok flagship. Lower cost.' }] },
] as const;
export const AI_TASKS = [
  { k: 'writing', l: 'Ideas and writing', d: 'Post ideas, social posts and articles.' },
  { k: 'research', l: 'Web research', d: 'Daily Brief scans of Reddit, X, LinkedIn and more.' },
] as const;
export const AI_DEFAULT = { writing: 'gpt-6-sol', research: 'claude-opus-5.5' };
export function aiFind(id: string) {
  for (const g of AI_MODELS) { const m = g.list.find(x => x.id === id); if (m) return { ...m, p: g.p }; }
  return null;
}
export const modelName = (id: string) => (aiFind(id) || { l: id }).l;

/* ── Calendar ── */
export const STATUS_MAP: Record<EntryStatus, [tone: string, label: string]> = {
  proposed: ['mute', 'Proposed'], approved: ['ink', 'Scheduled'], drafting: ['signal', 'Drafting…'], draft: ['warn', 'Draft'],
  review: ['signal', 'Ready for review'], scheduled: ['ok', 'Queued to publish'], publishing: ['signal', 'Publishing…'], published: ['ok', 'Published'], failed: ['bad', 'Failed'],
};
export const DOT_COLOR: Record<EntryStatus, string> = { proposed: 'var(--line)', approved: 'var(--ink)', drafting: 'var(--signal)', draft: 'var(--warn)', review: 'var(--signal)', scheduled: 'var(--ok)', publishing: 'var(--signal)', published: 'var(--ok)', failed: 'var(--bad)' };
export const ENTRY_TYPES = ['How-to', 'Guide', 'Comparison', 'Listicle', 'Explainer', 'Template'] as const;
export const MARKETS = ['United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'France'];
export function cadenceLabel(s: Pick<CalendarSettings, 'cadence' | 'perWeek'>) {
  return s.cadence === 'daily' ? '1 article daily' : s.cadence === 'weekdays' ? 'Weekdays' : s.perWeek + ' per week';
}
export function tzShort(tz: string) {
  return ({ 'America/New_York': 'ET', 'America/Los_Angeles': 'PT', 'Europe/London': 'UK time', 'America/Chicago': 'CT' } as Record<string, string>)[tz] || tz;
}
/** Full IANA list (divergence #8 — the prototype listed 4). The prototype's 4 lead the list. */
export function timezones(): string[] {
  const lead = ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London'];
  let all: string[] = [];
  try { all = (Intl as any).supportedValuesOf('timeZone') as string[]; } catch { all = []; }
  return [...lead, ...all.filter(z => !lead.includes(z))];
}

/* ── Keywords ── */
export const KW_SRC_L: Record<string, string> = { site: 'From your website', gsc: 'From Search Console', competitor: 'Competitor gap', user: 'Added by you' };
export const COMMERCIAL_RE = /best|vs|alternative|software|app|template|tool/;
export const kwIntentHeuristic = (kw: string) => (COMMERCIAL_RE.test(kw) ? 'Commercial' : 'Informational') as 'Commercial' | 'Informational';

/* ── Business Profile fields (Inferred vs Edited is tracked per 'group.field') ── */
export const PROFILE_FIELDS = {
  business: ['name', 'industry', 'description', 'positioning', 'offerings', 'differentiators'],
  audience: ['segments', 'buyers', 'needs', 'competitors'],
  keywords: ['list'],
  brand: ['logo', 'primary', 'secondary', 'voice', 'language', 'markets'],
} as const;
export type ProfileGroupKey = keyof typeof PROFILE_FIELDS;
/** Fields in a group the user hasn't edited yet ("N to check"). */
export const inferredLeft = (edited: Record<string, true> | null | undefined, g: ProfileGroupKey) => PROFILE_FIELDS[g].filter(k => !(edited || {})[g + '.' + k]).length;

/* ── Blog connectors (radar-publish.jsx) ── */
/** authFirst: sign in before anything else; the picker and the fields appear once authorized (GitHub picks its repository). */
export interface PlatformDef { k: ConnType; l: string; d?: string; mono: string; fields?: [key: string, label: string, placeholder: string, type?: string, hint?: string][]; oauth?: boolean; oauthLabel?: string; authFirst?: boolean; pick?: string; secret?: boolean; help?: string }
export const PLATFORMS: PlatformDef[] = ([
  { k: 'wordpress', l: 'WordPress', d: 'Self-hosted', mono: 'W', fields: [['url', 'Site URL', 'https://yoursite.com'], ['user', 'Username', ''], ['pass', 'Application password', '', 'password']], help: 'Create one under Users → Profile → Application Passwords.' },
  { k: 'ghost', l: 'Ghost', mono: 'G', fields: [['url', 'Site URL', 'https://yoursite.ghost.io'], ['key', 'Admin API key', '', 'password']], help: 'Settings → Integrations → Add custom integration.' },
  { k: 'webflow', l: 'Webflow', mono: 'Wf', oauth: true, pick: 'CMS collection' },
  { k: 'notion', l: 'Notion', mono: 'N', oauth: true, pick: 'Database' },
  { k: 'wix', l: 'Wix', mono: 'Wx', oauth: true, pick: 'Site' },
  { k: 'shopify', l: 'Shopify', mono: 'S', fields: [['store', 'Store domain', 'yourstore.myshopify.com']], oauth: true, pick: 'Blog' },
  { k: 'wpcom', l: 'WordPress.com', mono: 'W.', oauth: true, pick: 'Site' },
  { k: 'webhook', l: 'Webhook', mono: '{ }', fields: [['hook', 'Endpoint URL', 'https://api.yoursite.com/radar']], secret: true, help: 'Radar sends each article as signed JSON.' },
  { k: 'framer', l: 'Framer', mono: 'F', fields: [['url', 'Project URL', 'https://framer.com/projects/…'], ['key', 'API token', '', 'password']], pick: 'CMS collection' },
  { k: 'nextjs', l: 'GitHub', d: 'Pull request', mono: 'GH', fields: [['path', 'Content folder', 'content/posts', 'text', 'Where your posts live in the repository.']], oauth: true, oauthLabel: 'GitHub', authFirst: true, pick: 'Repository', help: 'Radar opens a pull request with each article as MDX.' },
] as PlatformDef[]).sort((a, b) => a.l.localeCompare(b.l));
export const platOf = (k?: string | null) => PLATFORMS.find(p => p.k === k) || PLATFORMS.find(p => p.k === 'wordpress')!;
export const platLabel = (k?: string | null) => platOf(k).l;
/**
 * The article banner's "{platform} returned {detail}" for a recorded publish failure. The publisher stores
 * `publishError.platform` as the label ("Ghost") and `message` as the full status line ("503 Service Unavailable",
 * "no response from host"), so neither is re-mapped or prefixed with the code again.
 */
export function publishFailParts(err: { http?: number; message?: string; platform?: string; hint?: string } | null | undefined, destType?: string | null) {
  const p = err?.platform || '';
  const platform = p ? (PLATFORMS.find(x => x.k === p)?.l || p) : destType ? platLabel(destType) : 'The platform';
  return { platform, detail: err?.message || (err?.http ? String(err.http) : 'an error'), ...(err?.hint ? { hint: err.hint } : {}) };
}
/** Fields that are secrets: stored encrypted, never sent back to the client. */
export const SECRET_FIELDS = ['pass', 'key'];

/* ── Social (radar-social.jsx) ── */
export const PLAT: { k: Platform; l: string; d: string; ratio: number }[] = [
  { k: 'linkedin', l: 'LinkedIn', d: 'Professional, a few short paragraphs', ratio: 1.91 },
  { k: 'x', l: 'X', d: 'Short and direct, up to 280 characters', ratio: 16 / 9 },
  { k: 'facebook', l: 'Facebook', d: 'Friendly and conversational', ratio: 1.91 },
  { k: 'reddit', l: 'Reddit', d: 'Community-first, disclosed, no hard sell', ratio: 4 / 3 },
  { k: 'quora', l: 'Quora', d: 'Written as a helpful answer', ratio: 1.91 },
];
export const plat = (k: string) => PLAT.find(p => p.k === k)!;
export const STYLES = [{ k: 'photography', l: 'Photography' }, { k: 'illustration', l: 'Illustration' }, { k: 'branded', l: 'Branded graphic' }, { k: 'infographic', l: 'Infographic' }, { k: 'custom', l: 'Custom direction' }] as const;
export const IMG_SIZES: Record<string, [number, number]> = { hero: [1200, 628], linkedin: [1200, 628], facebook: [1200, 628], quora: [1200, 628], x: [1200, 675], reddit: [1200, 900] };

/* ── Daily Brief ── */
export const BPLAT: Record<BriefPlatform, string> = { reddit: 'Reddit', x: 'X', linkedin: 'LinkedIn', hn: 'Hacker News', quora: 'Quora' };
export const PORDER: BriefPlatform[] = ['reddit', 'x', 'linkedin', 'hn', 'quora'];
export const BMENTION = [{ v: 'asked', l: 'Only when asked' }, { v: 'relevant', l: 'When relevant' }, { v: 'never', l: 'Never' }] as const;
export const BRIEF_DEFAULT = { platforms: ['reddit', 'x', 'linkedin', 'hn'] as BriefPlatform[], time: '06:00', mention: 'asked' as const, accounts: ['founder', 'company'] as BriefAccount[] };
/** Company drafts only go where brand accounts are welcome. Reddit, Hacker News and Quora stay founder-only. */
export const CO_PLATS: BriefPlatform[] = ['x', 'linkedin'];

/* ── AI Visibility ── */
export const AI_ENGINES: AiEngine[] = ['ChatGPT', 'Perplexity', 'Gemini', 'Claude', 'Grok'];

/* ── Languages (radar-extras.jsx) ── */
const LANG_CODES = 'af sq am ar hy as ay az bm eu be bn bho bs bg ca ceb ny zh-Hans zh-Hant co hr cs da dv doi nl eo et ee fil fi fr fy gl ka de el gn gu ht ha haw he hi hmn hu is ig ilo id ga it ja jv kn kk km rw gom ko kri ku ckb ky lo la lv ln lt lg lb mk mai mg ms ml mt mi mr mni lus mn my ne nb or om ps fa pl pa qu ro ru sm sa gd nso sr st sn sd si sk sl so es su sw sv tg ta tt te th ti ts tr tk ak uk ur ug uz vi cy xh yi yo zu ab ace ach aa alz av awa ban ba btx bci bew bik br bua yue ch ce chk cv crh fa-AF dz fo fj fon fur ff gaa gv hil iba kl kek kha kv kg ktu lij li lmo ltg luo mad mak ms-Arab mam mh mfe mwr min new nr nus oc os pam pag pap rom rn se sg sat sah scn shn szl ss tah tet tiv to tpi tn tum tyv ve wa war wo'.split(' ');
let _langs: string[] | null = null;
export function langs(): string[] {
  if (_langs) return _langs;
  let dn: Intl.DisplayNames | undefined;
  try { dn = new Intl.DisplayNames(['en'], { type: 'language' }); } catch { /* */ }
  const names = new Set<string>();
  LANG_CODES.forEach(c => { try { const n = dn ? dn.of(c) : c; if (n && n !== c) names.add(n.replace('Chinese, Simplified', 'Chinese (Simplified)')); } catch { /* */ } });
  ['English', 'Portuguese', 'Spanish', 'Chinese'].forEach(n => names.delete(n));
  _langs = ['English (US)', 'English (UK)', 'English (Australia)', 'Spanish', 'Spanish (Mexico)', 'Portuguese (BR)', 'Portuguese (PT)', ...[...names].sort()];
  return _langs;
}
