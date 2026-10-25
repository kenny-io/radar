// Inline icons from the marketing prototype.
/** The Radar mark as drawn inline in the prototype: fixed #ED6018 arm, so the app theme never recolors it. */
export function RadarMark({ s = 22 }: { s?: number }) {
  return <svg viewBox="0 0 24 24" width={s} height={s} aria-hidden="true"><g transform="translate(12 12)">{[0, 1, 2, 3, 4, 5, 6].map(i => { const card = i % 2 === 0; return <rect key={i} x="-1.3" y={card ? -10.2 : -11.3} width="2.6" height={card ? 7.6 : 4.8} fill={i === 1 ? '#ED6018' : 'currentColor'} transform={i ? `rotate(${i * 45})` : undefined} />; })}</g></svg>;
}
export const Arrow = () => <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"></path></svg>;
export const Check = () => <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"></path></svg>;

