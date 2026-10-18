// Selection rewrite (02-system.md §7): the selected text plus a little surrounding context, with the mode.
// Only the selection is returned (the editor replaces it in place). New statistics are never introduced.
import { z } from 'zod';
import { ai, profileContext } from '../../ai';
import { RadarError, GENERIC_AI_ERROR } from '../../errors';
import { normNum, statNumbers } from '@/features/article/blocks';
import type { Profile } from '@/lib/types';
import './stubs';

export type RewriteMode = 'rewrite' | 'shorter' | 'simpler' | 'expand';
const HOW: Record<RewriteMode, string> = {
  rewrite: 'Rewrite the selected text with fresh wording. Keep the meaning and roughly the same length.',
  shorter: 'Make the selected text noticeably shorter (about half). Keep the main point.',
  simpler: 'Rewrite the selected text in plainer words and shorter sentences. Keep the meaning.',
  expand: 'Expand the selected text with one or two sentences of genuinely useful detail that follows from the context. Do not add statistics, numbers, quotes, names or claims you cannot support.',
};
const Out = z.object({ text: z.string().min(1) });

export async function rewriteSelection(bid: string, profile: Profile, i: { mode: RewriteMode; selection: string; before: string; after: string; title: string; allowedNumbers?: string[] }): Promise<string> {
  const sel = i.selection;
  const lead = sel.match(/^\s*/)![0], trail = sel.match(/\s*$/)![0];
  const core = sel.trim();
  const allowed = new Set([...statNumbers(core), ...statNumbers(i.before), ...statNumbers(i.after), ...(i.allowedNumbers || [])].map(normNum));
  const ok = (t: string) => statNumbers(t).every(n => allowed.has(normNum(n)));
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await ai.run('writing', {
      purpose: 'article.rewrite', schema: Out, schemaName: 'rewrite', maxTokens: 800, temperature: attempt ? 0.3 : 0.7,
      system: `You are Radar, editing an article for this business in its brand voice. ${HOW[i.mode]} Return only the replacement for the selected text — no quotes, no commentary, no markdown. Match the surrounding grammar so it reads naturally in place.${attempt ? ' Do not include any numbers that are not in the original text.' : ''}`,
      prompt: `${profileContext(profile)}\n\nArticle: “${i.title}”\n\nText before the selection:\n…${i.before.slice(-400)}\n\nSELECTED TEXT:\n${core}\n\nText after the selection:\n${i.after.slice(0, 400)}…`,
      stubContext: { mode: i.mode, text: core, profile },
    }, { businessId: bid });
    const t = out.json!.text.trim().replace(/^["“]|["”]$/g, '');
    if (t && ok(t)) return lead + t + trail;
  }
  throw new RadarError(GENERIC_AI_ERROR, 502, 'ai_failed');
}
