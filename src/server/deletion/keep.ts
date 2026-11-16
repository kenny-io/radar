// What the wipe of a deleted business must leave in storage (delete-business architecture §4.5, decision A): the image
// files inside articles Radar already put on the business's site, so those posts keep working. Pure: the rows are read
// by the wipe, in its transaction and under the row lock, before the articles are deleted.
import { keptKey } from '../services/storage';

const unreadable = (what: string) => new Error(`A published article cannot be read (${what}); nothing is wiped`);

/** Keys of the images inside published articles: the cover (`data.img.url`) and the body images
 *  (`data.bodyImages[].url`). An absent or null field keeps nothing, and so does an address that is not a file of this
 *  business (keptKey → null). It throws when a row is not what Radar writes: the wipe then removes nothing and tries
 *  again on its next run, because Radar cannot tell which files a live article needs. */
export function publishedImageKeys(bid: string, rows: { data: unknown }[]): Set<string> {
  const keys = new Set<string>();
  const add = (url: string) => { const key = keptKey(bid, url); if (key) keys.add(key); };
  for (const { data } of rows) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw unreadable('data');
    const { img, bodyImages } = data as { img?: unknown; bodyImages?: unknown };
    if (img != null) {
      if (typeof img !== 'object' || Array.isArray(img)) throw unreadable('img');
      const url = (img as { url?: unknown }).url;
      if (url != null && typeof url !== 'string') throw unreadable('img.url');
      if (url) add(url);
    }
    if (bodyImages != null) {
      if (!Array.isArray(bodyImages)) throw unreadable('bodyImages');
      for (const image of bodyImages) {
        const url = image && typeof image === 'object' ? (image as { url?: unknown }).url : undefined;
        if (typeof url !== 'string') throw unreadable('bodyImages[].url');
        add(url);
      }
    }
  }
  return keys;
}
