'use client';
import { useEffect, useState } from 'react';

export function TableOfContents({ sections }: { sections: readonly { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      let current = sections[0]?.id;
      for (const section of sections) if ((document.getElementById(section.id)?.getBoundingClientRect().top ?? Infinity) < 160) current = section.id;
      setActive(current);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update(); addEventListener('scroll', schedule, { passive: true }); addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(frame); removeEventListener('scroll', schedule); removeEventListener('resize', schedule); };
  }, [sections]);
  return <aside className="po-toc" aria-label="On this page"><p>On this page</p><ol>{sections.map(section => <li key={section.id}><a href={`#${section.id}`} className={active === section.id ? 'on' : undefined} aria-current={active === section.id ? 'location' : undefined}>{section.label}</a></li>)}</ol></aside>;
}
