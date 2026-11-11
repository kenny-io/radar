/** Public, illustrative data only; these demos never call publishing or account APIs. */
export const BRIEF_REPLIES = [
  'I stopped running timers. I block my calendar the night before, then spend fifteen minutes on Friday checking it against what actually happened. Less precise minute to minute, far more honest across a week.',
  'I work on Fieldnote, so I’m biased. I gave up on timers and started checking my calendar against my week every Friday, which takes about fifteen minutes. Fieldnote does that for you, but a calendar and a spreadsheet work too.',
] as const;
export const SOCIAL_POSTS = [
  { name: 'LinkedIn', ratio: 1.91, limit: 3000, text: 'Most freelancers don’t lose hours to slow work. They lose them to gaps they never logged.\n\nThe fix isn’t a better timer. It’s fifteen minutes on Friday, calendar open, filling in the week while you still remember it.' },
  { name: 'X', ratio: 16 / 9, limit: 280, text: 'Freelancers don’t lose hours to slow work. They lose them to gaps they never logged.\n\nFifteen minutes on Friday with your calendar open beats chasing gaps at invoice time.' },
  { name: 'Facebook', ratio: 1.91, limit: null, text: 'Quick tip for anyone billing by the hour: block fifteen minutes every Friday to check your calendar against your timesheet. It’s the easiest money you’ll recover all week.' },
  { name: 'Reddit', ratio: 4 / 3, limit: null, text: 'Disclosure: I work on a time tracking app, but this works with a spreadsheet. Every Friday I spend fifteen minutes comparing my calendar to what I logged. Most of my missing hours turn up there.' },
  { name: 'Quora', ratio: 1.91, limit: null, text: 'The most reliable habit I know is a weekly check. Every Friday, open your calendar next to your timesheet and fill the gaps while the week is still fresh. It takes about fifteen minutes.' },
] as const;

export function performanceSeries(): number[][] {
  let seed = 7;
  const random = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const make = (a: number, b: number, noise: number, weekend: number) => Array.from({ length: 28 }, (_, i) => {
    // UTC keeps illustrative values deterministic across browser time zones and prerendering.
    const day = new Date(Date.UTC(2026, 9, 6 + i)).getUTCDay();
    return a + (b - a) * (i / 27) ** 1.2 + (random() - .5) * noise - (day === 0 || day === 6 ? weekend : 0);
  });
  return [make(52, 104, 14, 18), make(1700, 2650, 260, 380), make(3.1, 3.9, .35, .1), make(16.4, 14, .5, -.3)];
}
export function performancePath(values: readonly number[], inverted = false): string {
  const min = Math.min(...values), max = Math.max(...values);
  return values.map((value, i) => {
    const x = i / (values.length - 1) * 520, k = (value - min) / (max - min || 1);
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${(inverted ? 12 + k * 120 : 132 - k * 120).toFixed(1)}`;
  }).join(' ');
}
