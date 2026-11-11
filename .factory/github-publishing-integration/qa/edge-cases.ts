import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { planAppPost } from '../../../src/server/services/publishing/connectors/nextjs-integration';
import type { PublishPayload } from '../../../src/server/services/publishing/types';
const temp = process.env.QA_TEMP!;
const meta = JSON.parse(await fs.readFile(`${temp}/plan.json`, 'utf8'));
const base = new Map<string,string>([
  ['src/lib/blog.ts', await fs.readFile(`${temp}/source/src/lib/blog.ts`, 'utf8')],
  ['src/app/blog/page.tsx', await fs.readFile(`${temp}/source/src/app/blog/page.tsx`, 'utf8')],
]);
const exemplar = 'documentation-maintenance-tools';
for (const file of ['page.tsx','body.tsx','content.mdx','opengraph-image.tsx']) base.set(`src/app/blog/${exemplar}/${file}`, await fs.readFile(`${temp}/source/src/app/blog/${exemplar}/${file}`, 'utf8'));
const snapshot = (map: Map<string,string>) => ({ entries:[...map.keys()].map(path => ({path,type:'blob',sha:'fixture'})), read:async(path:string) => {assert(map.has(path), path);return map.get(path)!;} });
const p = meta.payload as PublishPayload;
const checks: string[]=[];
const first = await planAppPost('src/app/blog',p,snapshot(base));
const next = new Map(base);for(const f of first.files)next.set(f.path,f.content);
const retry = await planAppPost('src/app/blog',p,snapshot(next),p.slug);
assert.equal(retry.slug,p.slug);assert.equal((retry.files.find(f=>f.path==='src/lib/blog.ts')!.content.match(new RegExp('slug: "'+p.slug+'"','g'))||[]).length,1);checks.push('Retry keeps one registration and same slug');
assert.deepEqual(retry.files.map(f=>f.path),[`${'src/app/blog'}/${p.slug}/content.mdx`,'src/lib/blog.ts']);checks.push('Retry does not overwrite generated route wrappers');
const refreshed = await planAppPost('src/app/blog',{...p,title:'Refreshed title',date:'2026-11-06',mode:'refresh',slug:'different-title-slug',refreshUrl:`https://fixture.example/blog/${p.slug}/?utm=qa`},snapshot(next));
assert.equal(refreshed.slug,p.slug);assert.match(refreshed.files.find(f=>f.path==='src/lib/blog.ts')!.content,/title: "Refreshed title"/);assert.match(refreshed.files.find(f=>f.path==='src/lib/blog.ts')!.content,/date: "2026-11-05"/);checks.push('Refresh preserves route identity and original publication date');
const collision = new Map(base);collision.set(`src/app/blog/${p.slug}/content.mdx`,'unregistered route');collision.set(`src/app/blog/${p.slug}-2.md`,'flat file');
assert.equal((await planAppPost('src/app/blog',p,snapshot(collision))).slug,p.slug+'-3');checks.push('New post avoids unregistered route folder and flat-file collisions');
const unsupported = new Map(base);unsupported.delete('src/lib/blog.ts');
await assert.rejects(planAppPost('src/app/blog',p,snapshot(unsupported)),(e:any)=>e.http===422&&e.kind==='config');checks.push('Missing registry fails configuration');
const missingOg = new Map(base);missingOg.delete(`src/app/blog/${exemplar}/opengraph-image.tsx`);
await assert.rejects(planAppPost('src/app/blog',p,snapshot(missingOg)),(e:any)=>e.http===422&&e.kind==='config');checks.push('Template advertising absent OG companion fails configuration');
const defects=[];
for(const [name,mutate] of [
  ['Inherited required BlogPost fields',(s:string)=>s.replace('export interface BlogPost {','interface RequiredPublication { publicationId: string; }\nexport interface BlogPost extends RequiredPublication {')],
  ['Spread overriding a literal registry slug',(s:string)=>s.replace('export const blogPosts: BlogPost[] = [','const overrides = {slug: "different-runtime-slug"};\nexport const blogPosts: BlogPost[] = [').replace('slug: "documentation-maintenance-tools",','slug: "documentation-maintenance-tools", ...overrides,')],
] as const) {
  const probe = new Map(base);probe.set('src/lib/blog.ts',mutate(probe.get('src/lib/blog.ts')!));
  try {const output=await planAppPost('src/app/blog',p,snapshot(probe));defects.push({name,actual:'Accepted and generated '+output.files.length+' files',expected:'Configuration error before writes'});}catch(e:any){assert.equal(e.http,422);assert.equal(e.kind,'config');checks.push(name+' safely rejected');}
}
const result={checks,defects,destinationRevision:meta.destinationRevision};await fs.writeFile('.factory/github-publishing-integration/qa/edge-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
