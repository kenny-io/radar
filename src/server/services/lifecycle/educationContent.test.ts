import { describe, expect, it } from 'vitest';
import { EDUCATION_LESSONS, educationProgress, renderEducationLesson, type EducationContext } from './educationContent';

const context: EducationContext = { businessName: 'Paper & Pixel', offering: 'design tools', audience: 'independent studios', gscConnected: false, access: 'workspace' };
describe('weekly feature lesson copy', () => {
  it('makes each feature actionable with two steps and an observable progress check', () => {
    expect(EDUCATION_LESSONS).toHaveLength(5);
    for (const lesson of EDUCATION_LESSONS) {
      const copy = renderEducationLesson(lesson, context);
      expect(copy.steps).toHaveLength(2);
      expect(copy.subject).toContain('Paper & Pixel');
      expect(copy.ctaLabel).toBeTruthy();
      expect(educationProgress(lesson)).toMatch(/^Here’s how I’d track it:/);
    }
  });
  it('keeps learning available across access states without pretending workflows have run', () => {
    for (const access of ['start_trial', 'restart', 'setup'] as const) {
      for (const lesson of EDUCATION_LESSONS) {
        const copy = renderEducationLesson(lesson, { ...context, access });
        expect(copy.paragraphs.some(p => p.toLowerCase().includes(access === 'start_trial' ? 'start your radar trial' : access === 'restart' ? 'resume your subscription access first' : 'checking the business profile'))).toBe(true);
        expect(copy.ctaLabel).toBe(access === 'start_trial' ? 'Start my Radar trial' : access === 'restart' ? 'Reopen my Radar account' : 'Continue setting up Radar');
      }
    }
  });
  it('has truthful empty-profile fallbacks and controls subject header characters', () => {
    const empty = { gscConnected: false, access: 'workspace' } as const;
    for (const lesson of EDUCATION_LESSONS) {
      const generic = renderEducationLesson(lesson, empty);
      expect(JSON.stringify(generic)).not.toMatch(/undefined|null|Business Name/);
      const copy = renderEducationLesson(lesson, { ...context, businessName: 'Acme\r\nBcc: injected@example.com\u0000' });
      expect(copy.subject).not.toMatch(/[\r\n\u0000]/);
    }
  });
  it('does not ask a disconnected account to inspect nonexistent Search Console measurements', () => {
    expect(renderEducationLesson('organic_search', context).steps[1]).toContain('Connect Google Search Console');
    expect(renderEducationLesson('organic_search', { ...context, gscConnected: true }).steps[1]).toContain('Queries and Pages tables in Performance');
  });
});
