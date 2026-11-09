import {describe,it,expect} from 'vitest';
import {sourcesList,blocksToHtml,blocksToMarkdown} from '@/server/services/publishing/render';
import {buildPayload} from '@/server/services/publishing/publisher';
const sources:any[]=[
 {title:'Internal Search Console — keep private',url:'Google Search Console',use:'Internal research',notes:['Retain internally']},
 {title:'Public guide',url:'https://docs.example.test/guide?q=one&version=2#examples',use:'Reference'},
 {title:'Deleted source',url:'https://removed.example.test',use:'',removed:true},
 {title:'Credentials',url:'https://user:password@example.test/ref',use:''},
 {title:'Relative source',url:'/internal/metrics',use:''},
 {title:'Script source',url:'javascript:alert(1)',use:''},
 {title:'Plain hostname',url:'docs.example.test/guide',use:''},
 {title:'Uppercase scheme',url:'HTTP://docs.example.test/plain',use:''},
];
const body:any=[['p','Original prose — punctuation and evidence stay unchanged.'],['h2','Next step'],['ul',['Read & compare','Do not mutate [internal] research.']]];
const frozen=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;};
describe('Independent public citation boundary',()=>{
 it('keeps public HTTP(S) citations in source order and excludes internal,relative,removed,credentialed links',()=>{
  const snapshot=JSON.stringify(sources);const result=sourcesList(frozen(structuredClone(sources)));expect(result.map(s=>s.title)).toEqual(['Public guide','Uppercase scheme']);expect(JSON.stringify(sources)).toBe(snapshot);expect(result[0].url).toBe(sources[1].url);
 });
 it.each(['Google Search Console','#','', '   ', '/reference','../source','?query=internal','//docs.example.test/a','javascript:alert(1)','data:text/plain,private','file:///internal.txt','mailto:team@example.test','ftp://example.test/source','https://','https://user@example.test','https://:pass@example.test','http://[invalid'])('omits unusable citation %s without an orphan heading',url=>{
  const options={sources:[{title:'Internal source — do not publish',url,use:''}]};expect(blocksToHtml(body,options)).toBe(blocksToHtml(body));expect(blocksToMarkdown(body,options)).toBe(blocksToMarkdown(body));
 });
 it('HTML and Markdown keep article punctuation/body while removing only invalid citation output',()=>{
  const options={sources:frozen(structuredClone(sources))};const b=frozen(structuredClone(body));const old=JSON.stringify({body:b,sources:options.sources});const html=blocksToHtml(b,options),md=blocksToMarkdown(b,options);expect(html).toContain('Original prose — punctuation and evidence stay unchanged.');expect(md).toContain('Original prose — punctuation and evidence stay unchanged.');for(const forbidden of ['Internal Search Console','Credentials','password','Relative source','Script source','Plain hostname','Deleted source']){expect(html).not.toContain(forbidden);expect(md).not.toContain(forbidden);}expect(html).toContain('Public guide');expect(md).toContain('1. [Public guide]');expect(md).toContain('2. [Uppercase scheme]');expect(JSON.stringify({body:b,sources:options.sources})).toBe(old);
 });
 it('actual publishing payload exposes the same filtered citations and preserves frozen stored article bytes',async()=>{
  const art:any=frozen({entryId:'qa',generated:true,body:structuredClone(body),sources:structuredClone(sources),seo:{slug:'qa',title:'QA',meta:'QA'},img:{url:'https://images.example.test/cover.png'},videos:[],videoMeta:[],claims:[]});
  const biz:any={id:'qa',domain:'qa.test',profile:{business:{name:'QA'},brand:{primary:'#123456',secondary:'#654321'}}};
  const entry:any={id:'qa',title:'QA',kw:'qa',date:'2026-11-10',mode:'new'};const before=JSON.stringify(art);const payload=await buildPayload(biz,entry,art);expect(payload.sources).toEqual(sourcesList(sources).map(({title,url})=>({title,url})));expect(payload.html).toContain('Original prose — punctuation and evidence stay unchanged.');expect(payload.markdown).toContain('Original prose — punctuation and evidence stay unchanged.');expect(payload.html).not.toContain('Internal Search Console');expect(payload.markdown).not.toContain('Internal Search Console');expect(JSON.stringify(art)).toBe(before);expect(payload.blocks).toEqual(body);
 });
});
