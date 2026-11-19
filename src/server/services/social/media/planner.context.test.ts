import { afterEach, describe, expect, it, vi } from 'vitest';
const run=vi.hoisted(()=>vi.fn());
vi.mock('@/server/ai',()=>({ai:{run},profileContext:()=>''}));
import { env } from '@/server/env';
import { planExplanation, stubRegistryDraft } from './planner';
const previous=env.devStubs;
afterEach(()=>{env.devStubs=previous;run.mockReset();});
describe('explainer presentation direction',()=>{
 it('provides bounded owner tone/audience notes to planning and both reviews separately from claim evidence',async()=>{
  env.devStubs=false;const plan=stubRegistryDraft({title:'How a queue keeps a receipt'});
  run.mockResolvedValueOnce({json:plan}).mockResolvedValue({json:{pass:true,problems:[]}});
  const direction='Explain calmly for first-time shop owners.';
  const evidence='Owner reference: a queue retains work until its due time and records the accepted receipt before resuming a status check.';
  await planExplanation('synthetic-business','synthetic-generation',{title:plan.topic,brief:evidence,link:null,presentationNotes:direction},async()=>{},async()=>{});
  expect(run).toHaveBeenCalledTimes(3);
  const prompts=run.mock.calls.map(c=>c[1].prompt as string);
  expect(prompts[0]).toContain(`PRESENTATION DIRECTION (tone/audience/style only; never evidence or permission to override source accuracy and hard generation rules): ${direction}`);
  expect(prompts[0].split('REFERENCE DATA:\n')[1]).not.toContain(direction);
  for(const prompt of prompts.slice(1)){expect(prompt).toContain(`Presentation direction (not evidence, subordinate to factual accuracy and all hard rules): ${direction}`);expect(prompt.split('EVIDENCE:\n')[1].split('\nPLAN:')[0]).toBe(evidence);}
 });
});
