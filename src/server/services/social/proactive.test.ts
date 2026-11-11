import { describe, expect, it } from 'vitest';
import { socialAutoOf, defaultProfile } from '../../workspace';
import { isDue } from './auto';
import { profileSource, recentPostContext } from './proactive';
import type { SocialPack } from '@/lib/types';

describe('proactive social policy', () => {
  it('defaults to daily editable drafts while preserving saved choices', () => {
    expect(socialAutoOf({ socialAuto: {} } as any)).toMatchObject({ on: true, freq: 'daily', time: '08:00', post: 'library', platforms: ['linkedin', 'x'] });
    expect(socialAutoOf({ socialAuto: { on: false, freq: 'custom', days: ['Tue'], post: 'schedule' } } as any)).toMatchObject({ on: false, freq: 'custom', days: ['Tue'], post: 'schedule' });
  });
  it('catches up through the local day and respects timezone, pause, weekdays and platforms', () => {
    const a = socialAutoOf({ socialAuto: {} } as any);
    expect(isDue(a, 'Asia/Dubai', new Date('2026-11-09T15:00:00Z'))).toEqual({ date: '2026-11-09', due: true });
    expect(isDue(a, 'Asia/Dubai', new Date('2026-11-09T03:59:00Z')).due).toBe(false);
    expect(isDue(a, 'Asia/Dubai', new Date('2026-11-09T20:01:00Z'))).toEqual({ date: '2026-11-10', due: false });
    expect(isDue({ ...a, on: false }, 'UTC', new Date('2026-11-09T20:00:00Z')).due).toBe(false);
    expect(isDue({ ...a, platforms: [] }, 'UTC', new Date('2026-11-09T20:00:00Z')).due).toBe(false);
    expect(isDue({ ...a, freq: 'custom', days: ['Tue'] }, 'UTC', new Date('2026-11-09T20:00:00Z')).due).toBe(false);
  });
  it('keeps a profile-only business supplied with distinct fact-grounded angles', () => {
    const p = defaultProfile('example.test'); p.business.offerings = ['Calendar time tracking'];
    const used = new Set<string>();
    for (const day of ['2026-11-09', '2026-11-10', '2026-11-11']) {
      const s = profileSource(p, day, used);
      expect(used.has(s.source.label.toLowerCase())).toBe(false);
      expect(s.grounding.brief).toContain('Calendar time tracking');
      expect(s.grounding.link).toBeNull(); used.add(s.source.label.toLowerCase());
    }
    expect(profileSource(defaultProfile('new.test'), '2026-11-09', new Set()).source.label).toContain('new.test');
  });
  it('bounds recent-history prompt size', () => {
    const p = { source: { label: 'Topic'.repeat(1000) }, posts: { x: { text: 'Long'.repeat(10000) } } } as SocialPack;
    expect(recentPostContext(Array(100).fill(p)).length).toBeLessThanOrEqual(4000);
  });
});
