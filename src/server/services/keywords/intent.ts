// Keyword intent (02-system.md §5): LLM classification with the heuristic fallback /best|vs|alternative|software|app|template|tool/ → Commercial.
import { z } from 'zod';
import { ai } from '../../ai';
import { registerStub } from '../../ai/adapters/stub';
import { kwIntentHeuristic } from '@/lib/constants';
import type { Intent } from '@/lib/types';

const IntentSchema = z.object({ items: z.array(z.object({ kw: z.string(), intent: z.enum(['Commercial', 'Informational']) })) });

export async function classifyIntent(bid: string, kws: string[], context = ''): Promise<Record<string, Intent>> {
  const out: Record<string, Intent> = {};
  kws.forEach(k => { out[k] = kwIntentHeuristic(k); });
  if (!kws.length) return out;
  try {
    const r = await ai.run('writing', { purpose: 'keywords.intent', schema: IntentSchema, schemaName: 'intents', stubContext: { kws },
      prompt: `${context ? context + '\n\n' : ''}Classify each search keyword's intent. "Commercial" = the searcher is evaluating or looking to buy a product, service, tool or template. "Informational" = the searcher wants to learn or understand something.\n\n${kws.map(k => '- ' + k).join('\n')}` }, { businessId: bid, retries: 1 });
    for (const it of r.json!.items) { const k = it.kw.trim().toLowerCase(); if (k in out) out[k] = it.intent; }
  } catch { /* heuristic fallback */ }
  return out;
}

registerStub('keywords.intent', (_i, c) => ({ items: (c.kws as string[]).map(kw => ({ kw, intent: kwIntentHeuristic(kw) })) }));
