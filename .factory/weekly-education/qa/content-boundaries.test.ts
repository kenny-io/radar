import { describe, it, expect } from 'vitest';
import { load } from 'cheerio';
import { renderLifecycle, LIFECYCLE_TYPES } from '@/server/services/lifecycle/templates';
import { EDUCATION_LESSONS, renderEducationLesson, educationProgress } from '@/server/services/lifecycle/educationContent';
const origin='https://radar.example.test', unsubscribeUrl=origin+'/email-preferences?token=qa-only';
describe('independent lesson content and trust boundaries',()=>{
 it('uses exact feature order, exactly two numbered actions, progress and allowlisted first-party target',()=>{
  expect([...EDUCATION_LESSONS]).toEqual(['ai_visibility','daily_brief','backlinks','organic_search','social_marketing']);
  for(const access of ['workspace','start_trial','restart','setup'] as const)for(const lesson of EDUCATION_LESSONS){
   const mail=renderLifecycle('weekly_education',{name:'Alex',education:{version:1,lesson,context:{gscConnected:false,access}}},{appUrl:origin,unsubscribeUrl});
   const $=load(mail.html);expect($('h1')).toHaveLength(1);expect($('ol li')).toHaveLength(2);
   expect($.text()).toContain(educationProgress(lesson));expect(mail.text).toContain('1. ');expect(mail.text).toContain('2. ');
   const target=$('a').first().attr('href')!;
   expect(new URL(target).origin).toBe(origin);expect(new URL(target).pathname).toBe(access==='workspace'?'/email/learn':access==='setup'?'/onboarding':'/start-trial');if(access==='workspace')expect(new URL(target).searchParams.get('lesson')).toBe(lesson);
   expect(mail.text).not.toContain('topicthat');expect(mail.text).not.toMatch(/undefined|null/);
  }
 });
 it('escapes profile/name text instead of creating markup or extra destination links',()=>{
  const evil='<img src=x onerror=alert(1)> & "bad"';
  for(const lesson of EDUCATION_LESSONS){
   const mail=renderLifecycle('weekly_education',{name:evil,education:{version:1,lesson,businessId:'11111111-1111-4111-8111-111111111111',context:{businessName:evil,offering:evil,audience:evil,keyword:evil,gscConnected:false,access:'workspace'}}},{appUrl:origin,unsubscribeUrl});
   const $=load(mail.html);expect($('img')).toHaveLength(1);expect($('[onerror]')).toHaveLength(0);expect($('script')).toHaveLength(0);
   expect($.text()).toContain(evil);expect(mail.subject).not.toMatch(/[\r\n\u0000]/);
   expect($('a').toArray().every(a=>/^(https:\/\/radar\.example\.test|mailto:)/.test($(a).attr('href')||''))).toBe(true);
  }
 });
 it('rejects unknown lesson, access, version and business identifiers',()=>{
  const valid={version:1,lesson:'ai_visibility',context:{gscConnected:false,access:'workspace'}};
  for(const patch of [{lesson:'billing'},{version:2},{businessId:'../../foreign'},{context:{gscConnected:false,access:'admin'}}])expect(()=>renderLifecycle('weekly_education',{education:{...valid,...patch} as any},{appUrl:origin,unsubscribeUrl})).toThrow();
 });
 it('empty and control-character inputs have readable fallbacks without performance guarantees',()=>{
  for(const lesson of EDUCATION_LESSONS){
   const copy=renderEducationLesson(lesson,{businessName:'\r\n\u0000',gscConnected:false,access:'setup'});
   expect(copy.subject).not.toMatch(/[\r\n\u0000]/);expect(copy.steps).toHaveLength(2);expect(copy.ctaLabel).toContain('setting up');
   expect(JSON.stringify(copy)).not.toMatch(/guarantee(?:d)? (?:rank|recommend|growth)|automatically post/i);
  }
 });
 it('every lifecycle template exposes a visible first-party Email preferences button and correct scope',()=>{
  for(const type of LIFECYCLE_TYPES){
   const data:any={resetUrl:origin+'/reset-password#token=qa-only',trialEnd:'2026-12-01T12:00:00Z',periodEnd:'2026-12-01T12:00:00Z',amountCents:5000,education:{version:1,lesson:'ai_visibility',context:{gscConnected:false,access:'workspace'}},workSections:[{eventId:'11111111-1111-4111-8111-111111111111',businessId:'22222222-2222-4222-8222-222222222222',businessName:'QA',kind:'brief_reply',ref:'2026-11-10',count:1}]};
   const mail=renderLifecycle(type,data,{appUrl:origin,unsubscribeUrl});const $=load(mail.html);const a=$('a').filter((_,a)=>$(a).text()==='Email preferences');expect(a).toHaveLength(1);expect(a.attr('style')).toContain('display:inline-block');expect(mail.text).toContain('Email preferences:');expect(new URL(a.attr('href')!).origin).toBe(origin);
   if(['weekly_education','work_update','founder_note'].includes(type))expect(a.attr('href')).toBe(unsubscribeUrl);else expect(new URL(a.attr('href')!).pathname).toMatch(/^\/(settings|email-preferences)$/);
  }
 });

});
