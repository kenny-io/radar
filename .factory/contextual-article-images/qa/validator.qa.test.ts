// T4 QA: attack cleanImageDirections and the fallback with QA's own inputs. Pure, no database, no provider.
// Each case prints what happened to every slot; the assertions hold only what the brief requires (never throws,
// a draft never fails because of this step). False rejections and false accepts are listed in qa.md from this output.
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { cleanImageDirections, resolveImageDirections, directionsKey, type DirectionsAnswer } from '@/server/services/drafting/imageDirections';
import { fallbackImageDirections, planArticleBodyImages } from '@/lib/articleImages';
import { ai } from '@/server/ai';
import type { Block, Profile } from '@/lib/types';

const OUT = (process.env.QA_EVIDENCE_DIR || '.factory/contextual-article-images/qa/evidence') + '/validator.txt'; // QA_EVIDENCE_DIR: the recheck writes beside the first round's files
const lines: string[] = [];
const log = (s: string) => { lines.push(s); };

const title = 'Wasl 611 Reviews: Tenant Ratings and What to Check First';
const body: Block[] = [
  ['p', 'Wasl 611 is a gated staff accommodation community of three buildings in Al Warsan, Dubai, with 131 ensuite rooms. Tenants rate it for the shared kitchens and the staff bus.'],
  ['h2', 'What tenants say about the rooms'],
  ['p', 'Rooms are ensuite and furnished with two single beds and a wardrobe. Several reviews mention the air conditioning and the laundry room on the ground floor.'],
  ['h2', 'Getting to work from Al Warsan'],
  ['p', 'A staff bus leaves from the main gate each morning. The nearest metro station is about 15 minutes away by road.'],
  ['h2', 'What to check before you sign'],
  ['p', 'Check the deposit terms, the notice period and who pays for utilities. Visit the shared kitchen and the laundry room in person.'],
  ['h2', 'Is Wasl 611 right for your team'],
  ['p', 'It suits employers who need many rooms in one place. Compare it with other staff accommodation in Dubai before deciding.'],
];
const plans = planArticleBodyImages(body, 2200);
const ctx = { title, body, plans };
const good = (over: Partial<DirectionsAnswer> = {}): DirectionsAnswer => ({
  subject: 'Wasl 611', subjectKind: 'building',
  cover: { direction: 'The exterior of Wasl 611, a gated staff accommodation community of three buildings in Al Warsan, Dubai, seen from outside the entrance gate in daylight.', alt: 'Illustration of Wasl 611 staff accommodation in Al Warsan, Dubai' },
  sections: plans.map((p, i) => ({ i, direction: [
    'An ensuite room furnished with two single beds and a wardrobe, seen from the doorway, with an air conditioning unit on the wall.',
    'A staff bus waiting at the main gate of a residential community in the early morning, with workers boarding.',
    'A shared kitchen with counters and cooking hobs, with a person inspecting the cupboards during a visit.',
  ][i], alt: `Illustration of ${p.heading}` })),
  ...over,
});
const show = (name: string, raw: any, c = ctx) => {
  let out: ReturnType<typeof cleanImageDirections> | undefined; let threw = '';
  try { out = cleanImageDirections(raw, c); } catch (e: any) { threw = `${e?.name}: ${e?.message}`; }
  log(`\n### ${name}`);
  if (threw) { log(`THREW ${threw}`); return { threw, out: undefined }; }
  log(`subject: ${JSON.stringify(out!.subject)}`);
  log(`replaced: ${JSON.stringify(out!.replaced)}`);
  log(`cover: ${out!.cover.prompt}  || alt: ${out!.cover.alt}`);
  out!.sections.forEach((s, i) => log(`section ${i}: ${s.prompt}  || alt: ${s.alt}`));
  return { threw, out };
};
const coverOnly = (direction: string, over: Partial<DirectionsAnswer> = {}) => good({ cover: { direction, alt: 'Illustration of Wasl 611' }, ...over });
const why = (name: string, direction: string, over: Partial<DirectionsAnswer> = {}, c = ctx) => {
  const r = show(name, coverOnly(direction, over), c);
  return r.out?.replaced.find(x => x.slot === 'cover')?.why ?? (r.threw ? 'THREW' : null);
};

describe('cleanImageDirections under attack', () => {
  it('a good answer about a named building is kept whole, subject and number included', () => {
    const { out } = show('good answer, named building with a number in its name', good());
    expect(out!.replaced).toEqual([]);
    expect(out!.subject).toEqual({ name: 'Wasl 611', kind: 'building' });
    expect(out!.cover.prompt).toContain('Wasl 611');
    expect(out!.cover.alt).toContain('Wasl 611');
  });

  it('directions that ask for writing, quote wording, or are symbolic', () => {
    const rejected: Record<string, string | null> = {
      'sign reading': why('text: a sign reading', 'The entrance gate of Wasl 611 with a sign reading Welcome home above the barrier.'),
      'quoted wording': why('text: quoted wording', 'The entrance gate of Wasl 611 with a board showing “Rooms available” next to the barrier.'),
      'straight quotes': why('text: straight quotes', 'The entrance gate of Wasl 611 with a poster showing "Rooms available" beside the barrier.'),
      'caption': why('text: caption', 'The exterior of Wasl 611 with a caption under the picture naming the community.'),
      'chart': why('text: chart', 'A bar chart of tenant ratings for Wasl 611 next to the building entrance.'),
      'infographic': why('text: infographic', 'An infographic of the three buildings of Wasl 611 in Al Warsan, Dubai.'),
      'metaphor': why('symbolic: metaphor', 'A visual metaphor for tenant trust: a key resting on an open hand in front of a building.'),
      'abstract': why('symbolic: abstract', 'Abstract shapes suggesting three buildings and a gate in Al Warsan, Dubai.'),
      'symbolising': why('symbolic: symbolising', 'A set of scales symbolising the choice between two staff accommodation buildings.'),
    };
    log('\nREJECTED (expected a reason for each): ' + JSON.stringify(rejected));
    for (const [k, v] of Object.entries(rejected)) expect(v, k).not.toBeNull();
  });

  it('QA probes: wording requests the pattern does not catch (false accepts)', () => {
    const accepted: Record<string, string | null> = {
      'the word SALE painted': why('miss: the word X painted on', 'A shop window near Wasl 611 with the word SALE painted across the glass in large type.'),
      'sign that shows the name': why('miss: sign showing the name', 'The entrance gate of Wasl 611 with a large sign showing the name of the community above it.'),
      'written on a whiteboard': why('miss: written on a whiteboard', 'A whiteboard in the Wasl 611 office with the house rules written on it in marker pen.'),
      'single-quoted wording': why('miss: single quotes', 'The entrance gate of Wasl 611 with a board that shows ‘Rooms available’ beside the barrier.'),
      'price list poster': why('miss: price list poster', 'A poster listing room prices pinned to the notice board in the lobby of Wasl 611.'),
      'icon collage': why('miss: icons and collage', 'A collage of icons for beds, buses and kitchens arranged around the Wasl 611 building.'),
      'split screen': why('miss: split screen', 'A split screen comparing a tidy room and an untidy room inside Wasl 611 staff accommodation.'),
    };
    log('\nFALSE-ACCEPT PROBES (null = accepted by the validator): ' + JSON.stringify(accepted));
  });

  it('QA probes: ordinary good directions that must not be rejected (false rejections)', () => {
    const kept: Record<string, string | null> = {
      'number-named building': why('ok: Wasl 611 named', 'The exterior of Wasl 611 in Al Warsan, Dubai, seen from the street outside the main gate.'),
      'the word sign': why('ok: a road sign without wording', 'The main gate of Wasl 611 with a blank road sign and a barrier, seen from the street.'),
      'the word number': why('ok: the word number', 'A large number of staff waiting for the bus outside the main gate of Wasl 611 in the morning.'),
      'signs, reading': why('ok: signs then reading', 'A quiet lounge in Wasl 611 with blank signs, reading chairs and a low table by the window.'),
      'person reading text messages': why('ok?: words reading', 'A tenant sitting on a single bed in Wasl 611, with few words, reading a paperback in the afternoon.'),
      'number in article 131': why('ok: 131 ensuite rooms', 'A corridor inside Wasl 611 lined with doors to some of its 131 ensuite rooms.'),
      'number in article 15': why('ok: 15 minutes', 'A staff bus on the road from Al Warsan towards a metro station about 15 minutes away.'),
      'label as a noun for a thing': why('rejected?: luggage label', 'A suitcase with a blank luggage label standing by a single bed in a Wasl 611 room.'),
      'logo-free building': why('rejected?: says no logo', 'The plain exterior of Wasl 611 with no logo on the facade, seen from the car park.'),
      'chart house': why('rejected?: a place called Chart House', 'The exterior of Chart House, a low-rise residential building, seen from across the street.'),
      'graph paper': why('rejected?: graph paper', 'A desk with a sheet of blank graph paper, a ruler and a set of keys for a rented room.'),
      'headline act': why('rejected?: headline', 'A stage at a street festival in Al Warsan where the headline act is setting up drums.'),
      'abstract of title': why('rejected?: the word abstract in a literal sense', 'A gallery wall in Dubai hung with abstract paintings, seen by two visitors from behind.'),
      'conceptual': why('rejected?: conceptual', 'An architect presenting a conceptual model of three buildings on a table to a client.'),
      'inches': why('rejected?: inch marks', 'A 27" monitor and a 32" television on a desk in a furnished room in Wasl 611.'),
    };
    log('\nFALSE-REJECTION PROBES (null = kept): ' + JSON.stringify(kept, null, 0));
    // The named subject with a number in its name must survive: a validator that rejects it defeats the feature.
    expect(kept['number-named building']).toBeNull();
    expect(kept['the word sign']).toBeNull();
    expect(kept['the word number']).toBeNull();
    expect(kept['number in article 131']).toBeNull();
    expect(kept['number in article 15']).toBeNull();
  });

  it('numbers: only those the article states', () => {
    const r: Record<string, string | null> = {
      'invented 33': why('number: 33 low-rise blocks (not in article)', 'The exterior of Wasl 611, a community of 33 low-rise blocks in Al Warsan, Dubai.'),
      'invented 12-storey': why('number: 12-storey', 'The exterior of Wasl 611, a 12-storey tower in Al Warsan, Dubai, at dusk.'),
      '611 with comma': why('number: 611, then comma', 'The gate of Wasl 611, with three buildings behind it in Al Warsan, Dubai.'),
      '611 with full stop': why('number: 611 at sentence end', 'Three residential buildings behind a gate in Al Warsan, Dubai. This is Wasl 611.'),
      'substring 61': why('number: 61 is a substring of 611', 'The exterior of a residential community with 61 parked cars in Al Warsan, Dubai.'),
      'substring 1': why('number: 1 alone', 'A single bed in 1 corner of an ensuite room with a wardrobe opposite.'),
      '1,310 vs 131': why('number: 1,310', 'A wide view over 1,310 rooftops in Al Warsan, Dubai, from a balcony.'),
      'ordinal 1st': why('number: 1st floor', 'The laundry room on the 1st floor of a residential building in Al Warsan.'),
      'spelled out': why('number: spelled out (not checked)', 'The exterior of Wasl 611, a community of thirty-three low-rise blocks in Al Warsan, Dubai.'),
      'arabic-indic digits': why('number: Arabic-Indic digits (not checked)', 'The exterior of Wasl 611, a community of ٣٣ low-rise blocks in Al Warsan, Dubai.'),
    };
    log('\nNUMBER PROBES: ' + JSON.stringify(r));
    expect(r['invented 33']).toBe('number not in the article');
    expect(r['invented 12-storey']).toBe('number not in the article');
    expect(r['611 with comma']).toBeNull();
    expect(r['611 with full stop']).toBeNull();
    expect(r['substring 61']).toBe('number not in the article');
  });

  it('near-duplicates, and sections that share only the subject', () => {
    const dup = good();
    dup.sections[0].direction = 'The exterior of Wasl 611, a gated staff accommodation community of three buildings in Al Warsan, Dubai, seen from the entrance gate in daylight.';
    dup.sections[1].direction = dup.sections[2].direction;
    const { out } = show('near-duplicate of the cover, and two identical sections', dup);
    expect(out!.replaced.map(r => r.slot)).toEqual(['section 0', 'section 2']);
    const shared = good();
    shared.sections = plans.map((p, i) => ({ i, alt: `Illustration of ${p.heading}`, direction: [
      'An ensuite room inside Wasl 611 staff accommodation in Al Warsan, Dubai, with two single beds and a wardrobe.',
      'The staff bus outside the main gate of Wasl 611 staff accommodation in Al Warsan, Dubai, in the morning.',
      'The shared kitchen inside Wasl 611 staff accommodation in Al Warsan, Dubai, with counters and cooking hobs.',
    ][i] }));
    const r = show('three different scenes that all name the subject and place', shared);
    log('  -> replaced for sharing the subject: ' + JSON.stringify(r.out!.replaced));
  });

  it('section numbers: wrong, repeated, missing, fractional', () => {
    const base = good();
    const wrong = { ...base, sections: [{ i: 7, direction: base.sections[0].direction, alt: 'Illustration of a room' }, { i: -1, direction: base.sections[1].direction, alt: 'Illustration of a bus' }] };
    const a = show('section numbers out of range', wrong);
    expect(a.out!.sections).toHaveLength(plans.length);
    expect(a.out!.replaced.every(r => r.why === 'missing')).toBe(true);
    const repeated = { ...base, sections: [{ ...base.sections[0], i: 0 }, { ...base.sections[1], i: 0 }, { ...base.sections[1], i: 1 }] };
    const b = show('section number repeated (first one wins)', repeated);
    expect(b.out!.sections[0].prompt).toBe(base.sections[0].direction);
    const fractional = { ...base, sections: [{ ...base.sections[0], i: 0.5 as any }, { ...base.sections[1], i: '1' as any }] };
    expect(show('section numbers 0.5 and "1"', fractional).threw).toBe('');
  });

  it('empty, partial and malformed answers never throw', () => {
    const cases: [string, any][] = [
      ['all empty strings', { subject: '', subjectKind: 'none', cover: { direction: '', alt: '' }, sections: [] }],
      ['no cover', { subject: '', subjectKind: 'none', sections: [] }],
      ['no sections key', { subject: 'Wasl 611', subjectKind: 'building', cover: { direction: 'x', alt: '' } }],
      ['empty object', {}],
      ['cover without alt', { subject: '', subjectKind: 'none', cover: { direction: 'The exterior of a residential building behind a gate in Al Warsan, Dubai.' }, sections: [] }],
      ['section without alt or direction', { subject: '', subjectKind: 'none', cover: { direction: '', alt: '' }, sections: [{ i: 0 }] }],
      ['numbers where strings belong', { subject: 611, subjectKind: 'building', cover: { direction: 12345678901234567890123456789, alt: 5 }, sections: [{ i: 0, direction: 9, alt: 9 }] }],
    ];
    const threw: string[] = [];
    for (const [name, raw] of cases) { const r = show('malformed: ' + name, raw); if (r.threw) threw.push(`${name}: ${r.threw}`); else expect(r.out!.sections).toHaveLength(plans.length); }
    for (const [name, raw] of [['null', null], ['undefined', undefined], ['a string', 'no'], ['section null', { cover: { direction: '', alt: '' }, sections: [null] }]] as [string, any][]) { const r = show('malformed (not an object): ' + name, raw); if (r.threw) threw.push(`${name}: ${r.threw}`); }
    log('\nINPUTS ON WHICH cleanImageDirections ITSELF THROWS (resolveImageDirections must absorb these): ' + JSON.stringify(threw));
  });

  it('subject: one the article does not name is dropped; one it names is kept and added to the cover', () => {
    const invented = show('subject not in the article', good({ subject: 'Burj Khalifa', subjectKind: 'building' }));
    expect(invented.out!.subject).toBeNull();
    const none = show('subject given with kind none', good({ subject: 'Wasl 611', subjectKind: 'none' }));
    expect(none.out!.subject).toBeNull();
    const cased = show('subject in another case and with doubled spaces', good({ subject: 'WASL   611', subjectKind: 'building' }));
    expect(cased.out!.subject?.name).toBe('WASL 611');
    const unnamed = show('cover that omits the subject, alt that omits it', good({ cover: { direction: 'A gated staff accommodation community of three buildings in Al Warsan, Dubai, seen from the street.', alt: 'Illustration of a staff accommodation community' } }));
    expect(unnamed.out!.cover.prompt).toMatch(/The subject shown is Wasl 611\.$/);
    expect(unnamed.out!.cover.alt).toBe('Illustration of Wasl 611');
    // A subject whose own name trips the wording pattern.
    const t2 = 'Chart House Reviews: What Tenants Say'; const b2: Block[] = [['p', 'Chart House is a low-rise residential building near the marina.'], ['h2', 'Rooms'], ['p', 'Rooms are furnished and bright, with a balcony.'], ['h2', 'Transport'], ['p', 'A bus stop is outside the entrance.']];
    const p2 = planArticleBodyImages(b2, 900);
    const ch = show('subject named Chart House (name contains a refused word)', { subject: 'Chart House', subjectKind: 'building', cover: { direction: 'The exterior of Chart House, a low-rise residential building near the marina, seen from the street.', alt: 'Illustration of Chart House' }, sections: p2.map((p, i) => ({ i, direction: ['A furnished bright room with a balcony door standing open.', 'A bus stop outside the entrance of a low-rise residential building.'][i], alt: 'Illustration of ' + p.heading })) }, { title: t2, body: b2, plans: p2 });
    log('  -> Chart House cover replaced: ' + JSON.stringify(ch.out!.replaced));
    // Apostrophe style differs between the model's answer and the article.
    const t3 = 'Queen’s Wharf Tower: A Renter’s Guide'; const b3: Block[] = [['p', 'Queen’s Wharf Tower is a residential high-rise beside the river.'], ['h2', 'Flats'], ['p', 'Flats have open kitchens.']];
    const p3 = planArticleBodyImages(b3, 900);
    const ap = show('subject with a straight apostrophe where the article uses a curly one', { subject: "Queen's Wharf Tower", subjectKind: 'building', cover: { direction: "The exterior of Queen's Wharf Tower, a residential high-rise beside the river, seen from the far bank.", alt: "Illustration of Queen's Wharf Tower" }, sections: p3.map((p, i) => ({ i, direction: 'A flat with an open kitchen and a dining table near the window.', alt: 'Illustration of ' + p.heading })) }, { title: t3, body: b3, plans: p3 });
    log('  -> subject kept when only the apostrophe differs: ' + JSON.stringify(ap.out!.subject));
  });

  it('very long strings and a non-English article', () => {
    const long = 'The exterior of Wasl 611 in Al Warsan, Dubai, seen from the gate. ' + 'A wide quiet street with parked cars and a low wall. '.repeat(40_000);
    const t0 = Date.now();
    const r = show('2 MB direction', coverOnly('x'.repeat(10) + long, { cover: { direction: long, alt: 'A'.repeat(500_000) } }));
    const ms = Date.now() - t0; lines.splice(lines.length - 1 - plans.length, 1 + plans.length); // do not write 2 MB to the evidence file
    log(`  2 MB direction: ${ms} ms, threw=${JSON.stringify(r.threw)}, cover kept at ${r.out?.cover.prompt.length} chars, alt cut to ${r.out?.cover.alt.length} chars`);
    expect(r.threw).toBe(''); expect(ms).toBeLessThan(5000);
    expect(r.out!.cover.alt.length).toBeLessThanOrEqual(200);
    const evil = '“' + 'a'.repeat(200_000); const t1 = Date.now(); show('unterminated quote of 200k characters', coverOnly(evil)); lines.splice(lines.length - 1 - plans.length - 3, 4 + plans.length);
    log(`  unterminated 200k quote: ${Date.now() - t1} ms`);
    expect(Date.now() - t1).toBeLessThan(5000);

    const tAr = 'مراجعات وصل 611: تقييمات المستأجرين وما يجب التحقق منه أولاً';
    const bAr: Block[] = [['p', 'وصل 611 مجمع سكني للموظفين مسوّر يتكون من ثلاثة مبانٍ في الورسان، دبي.'], ['h2', 'ماذا يقول المستأجرون عن الغرف'], ['p', 'الغرف مفروشة بسريرين مفردين وخزانة ملابس.'], ['h2', 'الوصول إلى العمل'], ['p', 'تغادر حافلة الموظفين من البوابة الرئيسية كل صباح.']];
    const pAr = planArticleBodyImages(bAr, 900);
    const ar = show('Arabic article, English directions, Arabic alt, subject as the article writes it', { subject: 'وصل 611', subjectKind: 'building', cover: { direction: 'The exterior of a gated staff accommodation community of three buildings in Al Warsan, Dubai, seen from outside the gate.', alt: 'رسم توضيحي لمجمع وصل 611 السكني' }, sections: pAr.map((p, i) => ({ i, direction: ['A furnished room with two single beds and a wardrobe, seen from the doorway.', 'A staff bus leaving a main gate in the morning light.'][i], alt: 'رسم توضيحي: ' + p.heading })) }, { title: tAr, body: bAr, plans: pAr });
    expect(ar.threw).toBe('');
    expect(ar.out!.subject?.name).toBe('وصل 611');
    log('  -> Arabic: replaced ' + JSON.stringify(ar.out!.replaced));
    const fbAr = fallbackImageDirections(tAr, bAr, pAr);
    log('  -> Arabic fallback cover: ' + fbAr.cover.prompt + ' || ' + fbAr.cover.alt);
    const zh: Block[] = [['p', '这是一栋位于迪拜的员工宿舍楼，共有三栋建筑。'], ['h2', '房间'], ['p', '房间配有两张单人床和一个衣柜。'], ['h2', '交通'], ['p', '员工班车每天早上从大门出发。']];
    const pZh = planArticleBodyImages(zh, 900);
    const same = show('Chinese article: two identical Chinese directions (does the duplicate check see them?)', { subject: '', subjectKind: 'none', cover: { direction: '迪拜一栋员工宿舍楼的外观，从大门外看过去，白天，三栋建筑并排而立，门口有保安亭。', alt: '员工宿舍楼插图' }, sections: pZh.map((p, i) => ({ i, direction: '迪拜一栋员工宿舍楼的外观，从大门外看过去，白天，三栋建筑并排而立，门口有保安亭。', alt: '插图：' + p.heading })) }, { title: '迪拜员工宿舍评价', body: zh, plans: pZh });
    log('  -> identical non-Latin directions replaced as duplicates: ' + JSON.stringify(same.out!.replaced));
  });

  it('the dev stub’s answer for the reported title passes untouched', async () => {
    await import('@/server/services/drafting/stubs');
    const stub = ((globalThis as any).__radarStubs as Map<string, (i: any, c: any) => any>).get('article.imageDirections')!;
    for (const t of [title, 'How to Design a Logo: “Simple” Rules', 'Abstract Art for Offices', '10 Charts Every Landlord Needs']) {
      const answer = stub({}, { title: t, kw: 'kw', plans });
      const r = show(`dev stub answer, title: ${t}`, answer, { title: t, body, plans });
      log('  -> stub slots replaced: ' + JSON.stringify(r.out!.replaced));
    }
  });
});

describe('resolveImageDirections never throws and never fails a draft', () => {
  const profile = { domain: 'lived.test', business: { name: 'Lived', industry: 'Property reviews' }, brand: { language: 'English', markets: ['UAE'], primary: '#111111', secondary: '#eeeeee' } } as unknown as Profile;
  const e = { title, kw: 'wasl 611 reviews', type: 'Guide' } as any;
  const a = { body, brief: { angle: '', outline: [], words: 2200 as const }, img: { style: 'illustration' as const, seed: 1, prompt: 'Calm, editorial image about wasl 611 reviews', alt: '', url: null } };
  const answers: [string, () => Promise<any>][] = [
    ['rejects with an Error', async () => { throw new Error('provider down'); }],
    ['rejects with a string', async () => { throw 'nope'; }],
    ['rejects with undefined', async () => { throw undefined; }],
    ['json is null', async () => ({ json: null })],
    ['json is undefined', async () => ({ json: undefined })],
    ['json is a string', async () => ({ json: 'not an object' })],
    ['json is an empty object', async () => ({ json: {} })],
    ['json has sections: [null]', async () => ({ json: { cover: { direction: '', alt: '' }, sections: [null] } })],
    ['resolves to undefined', async () => undefined],
    ['json is an array', async () => ({ json: [] })],
    ['every slot unusable', async () => ({ json: { subject: 'Wasl 611', subjectKind: 'building', cover: { direction: 'A chart.', alt: '' }, sections: [] } })],
  ];
  for (const [name, answer] of answers) it(`falls back when ai.run ${name}`, async () => {
    const spy = vi.spyOn(ai, 'run').mockImplementation(answer as any);
    const quiet = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
    try {
      const d = await resolveImageDirections('bid', profile, e, a as any, { budgetMs: 2000 });
      log(`\nresolve: ai.run ${name} -> source=${d.source}, cover=${d.cover.prompt.slice(0, 90)}…`);
      expect(d.source).toBe('fallback');
      expect(d.key).toBe(directionsKey(title, body, 2200));
      expect(d.sections).toHaveLength(plans.length);
      expect(d.cover.prompt).toContain('Wasl 611');
    } finally { spy.mockRestore(); quiet.forEach(q => q.mockRestore()); }
  });
  it('falls back when ai.run throws synchronously, and when it never answers', async () => {
    const quiet = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
    const sync = vi.spyOn(ai, 'run').mockImplementation((() => { throw new TypeError('sync'); }) as any);
    expect((await resolveImageDirections('bid', profile, e, a as any)).source).toBe('fallback');
    sync.mockRestore();
    const never = vi.spyOn(ai, 'run').mockImplementation((() => new Promise(() => {})) as any);
    const t0 = Date.now();
    const d = await resolveImageDirections('bid', profile, e, a as any, { budgetMs: 300 });
    log(`\nresolve: ai.run never answers -> source=${d.source} after ${Date.now() - t0} ms (budget 300)`);
    expect(d.source).toBe('fallback'); expect(Date.now() - t0).toBeLessThan(2000);
    never.mockRestore(); quiet.forEach(q => q.mockRestore());
  });
  it('an article with no body, no headings, or a huge body', async () => {
    const quiet = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
    const spy = vi.spyOn(ai, 'run').mockImplementation((async () => { throw new Error('down'); }) as any);
    for (const [name, b] of [['empty body', []], ['one paragraph', [['p', 'Only one paragraph here about Wasl 611.']]], ['headings only', [['h2', 'A'], ['h2', 'B']]], ['huge', Array.from({ length: 4000 }, (_, i) => (i % 5 ? ['p', 'Sentence about rooms. '.repeat(40)] : ['h2', 'Section ' + i]))]] as [string, Block[]][]) {
      const d = await resolveImageDirections('bid', profile, e, { ...a, body: b } as any, { budgetMs: 2000 });
      log(`\nresolve: ${name} -> source=${d.source}, sections=${d.sections.length}, cover=${d.cover.prompt.slice(0, 120)}`);
      expect(d.source).toBe('fallback');
    }
    spy.mockRestore(); quiet.forEach(q => q.mockRestore());
    fs.mkdirSync('.factory/contextual-article-images/qa/evidence', { recursive: true });
    fs.writeFileSync(OUT, lines.join('\n') + '\n');
  });
});
