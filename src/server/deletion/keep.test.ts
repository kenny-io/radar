// Which stored files the wipe of a business must keep (decision A): the images inside its published articles.
import { describe, expect, it } from 'vitest';
import { publishedImageKeys } from './keep';

const BID = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';
const local = (name: string, bid = BID) => `/api/files/${bid}/articles/${name}`;
const keys = (...rows: unknown[]) => [...publishedImageKeys(BID, rows.map(data => ({ data })))].sort();

describe('the keep set of a wipe', () => {
  it('keeps the cover and every body image of each published article', () => {
    expect(keys(
      { img: { url: local('cover-1.png'), real: { url: local('real-1.png') } }, bodyImages: [{ url: local('body-1a.png') }, { url: local('body-1b.png'), alt: 'x' }] },
      { img: { url: local('cover-2.png') } },
    )).toEqual([`${BID}/articles/body-1a.png`, `${BID}/articles/body-1b.png`, `${BID}/articles/cover-1.png`, `${BID}/articles/cover-2.png`]);
  });
  it('keeps nothing for a missing or null field, an article with no images, or no rows at all', () => {
    expect(keys()).toEqual([]);
    expect(keys({}, { img: null, bodyImages: null }, { img: {}, bodyImages: [] }, { img: { url: null } }, { img: { url: '' } }, { body: [{ t: 'p', text: local('in-text.png') }] })).toEqual([]);
  });
  it('ignores a reference that is not a file of this business: it adds nothing and is not an error', () => {
    expect(keys({ img: { url: local('theirs.png', OTHER) }, bodyImages: [{ url: 'https://images.example.com/a.png' }, { url: 'not a url' }, { url: `/api/files/${BID}/../${OTHER}/x.png` }, { url: `/api/files/${BID}` }, { url: local('mine.png') }] }))
      .toEqual([`${BID}/articles/mine.png`]);
  });
  it('only ever returns keys under the business’s own prefix', () => {
    const hostile = ['..', `../${OTHER}/x.png`, `${OTHER}/x.png`, `/api/files/${OTHER}/${BID}/x.png`, `https://cdn.test/${OTHER}/a/${BID}/b.png`, `/api/files/${BID}/a/%2e%2e/b.png`, `https://cdn.test/${BID}/a/..%2f..%2f${OTHER}/b.png`];
    for (const k of publishedImageKeys(BID, [{ data: { img: { url: hostile[0] }, bodyImages: hostile.map(url => ({ url })) } }])) expect(k.startsWith(BID + '/')).toBe(true);
  });
  it.each([
    ['the article is not an object', 'text'], ['the article is null', null], ['the article is a list', []],
    ['the cover is not an object', { img: 'cover.png' }], ['the cover is a list', { img: [] }], ['the cover address is not text', { img: { url: 42 } }],
    ['the body images are not a list', { bodyImages: { 0: { url: local('a.png') } } }], ['the body images are text', { bodyImages: local('a.png') }],
    ['a body image has no address', { bodyImages: [{ url: local('a.png') }, { alt: 'x' }] }], ['a body image is null', { bodyImages: [null] }], ['a body image address is not text', { bodyImages: [{ url: 7 }] }],
  ])('throws, so nothing is wiped, when %s', (_what, data) => {
    expect(() => publishedImageKeys(BID, [{ data: { img: { url: local('ok.png') } } }, { data }])).toThrow(/nothing is wiped/);
  });
});
